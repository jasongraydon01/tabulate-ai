/**
 * LoopSemanticsPolicyAgent
 *
 * Purpose: Classify each banner group as respondent-anchored or entity-anchored
 * on stacked loop data, and specify alias column implementation for entity-anchored groups.
 *
 * Inputs: Stacked frame context, banner groups + cuts, cut variable context
 * Output: LoopSemanticsPolicy (structured per-banner-group classification)
 *
 * Runs once per pipeline execution (not per table — one policy for the whole dataset).
 */

import { generateText, Output, stepCountIs } from 'ai';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  LoopSemanticsPolicySchema,
  type LoopSemanticsPolicy,
} from '../schemas/loopSemanticsPolicySchema';
import {
  getLoopSemanticsModel,
  getLoopSemanticsModelName,
  getLoopSemanticsModelTokenLimit,
  getLoopSemanticsReasoningEffort,
  getPromptVersions,
  getGenerationConfig,
  getGenerationSamplingParams,
} from '../lib/env';
import {
  createContextScratchpadTool,
  getAllContextScratchpadEntries,
  clearContextScratchpadsForAgent,
  formatScratchpadAsMarkdown,
} from './tools/scratchpad';
import { getLoopSemanticsPrompt } from '../prompts';
import { retryWithPolicyHandling } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability';
import type { LoopGroupMapping } from '../lib/validation/LoopCollapser';
import type { LoopSemanticsExcerptEntry, QuestionIdEntry } from '../lib/questionContext';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import fs from 'fs/promises';
import path from 'path';

// =============================================================================
// Types
// =============================================================================

export interface LoopSemanticsPolicyInput {
  /** Stacked frame context — what the loop structure is, enriched with family descriptions */
  loopSummary: {
    stackedFrameName: string;
    iterations: string[];
    variableCount: number;
    skeleton: string;
    /** Loop family base name (e.g., 'S9', 'Treat') */
    familyBase?: string;
    /** Question text from the first iteration — describes what this loop family measures */
    familyQuestionText?: string;
    /** Sample variable labels from this loop family */
    representativeLabels?: string[];
  }[];

  /** Banner groups from BannerAgent output */
  bannerGroups: {
    groupName: string;
    columns: { name: string; original: string }[];
  }[];

  /** Cut expressions from CrosstabAgent output */
  cuts: {
    name: string;
    groupName: string;
    rExpression: string;
  }[];

  /** Metadata for variables referenced by cuts — descriptions, value labels, types */
  datamapExcerpt: LoopSemanticsExcerptEntry[];

  /** Loop group mappings — used to validate sourcesByIteration against per-frame columns */
  loopMappings: LoopGroupMapping[];

  /** Output directory for saving artifacts */
  outputDir: string;

  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

// =============================================================================
// Input Builders (used by call sites to construct enriched inputs)
// =============================================================================

/**
 * Build enriched loop summary with family context from questionIdEntries.
 * Call sites use this instead of manually building the loopSummary array.
 */
export function buildEnrichedLoopSummary(
  loopMappings: LoopGroupMapping[],
  questionIdEntries?: QuestionIdEntry[],
): LoopSemanticsPolicyInput['loopSummary'] {
  // Build family → first-iteration question text lookup
  const familyTexts = new Map<string, string>();
  if (questionIdEntries) {
    for (const e of questionIdEntries) {
      if (!e.loop?.detected || !e.loop.familyBase) continue;
      if ((e.loop.iterationIndex ?? 0) !== 0) continue; // First iteration only
      const base = e.loop.familyBase;
      if (!familyTexts.has(base)) {
        familyTexts.set(base, e.questionText || e.questionId);
      }
    }
  }

  return loopMappings.map(m => {
    const familyBase = m.familyBase || '';

    // Get representative variable labels from the mapping (first 10)
    const representativeLabels = m.variables
      .slice(0, 10)
      .map(v => v.label)
      .filter(l => l && l.length > 0);

    return {
      stackedFrameName: m.stackedFrameName,
      iterations: m.iterations,
      variableCount: m.variables.length,
      skeleton: m.skeleton,
      familyBase,
      familyQuestionText: familyTexts.get(familyBase) || '',
      representativeLabels,
    };
  });
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Run the LoopSemanticsPolicyAgent to classify each banner group.
 */
export async function runLoopSemanticsPolicyAgent(
  input: LoopSemanticsPolicyInput,
): Promise<LoopSemanticsPolicy> {
  console.log(`[LoopSemanticsPolicyAgent] Classifying ${input.bannerGroups.length} banner groups`);
  const genConfig = getGenerationConfig();
  const startTime = Date.now();
  const maxAttempts = 10;

  // Check for cancellation
  if (input.abortSignal?.aborted) {
    const abortErr = new DOMException('LoopSemanticsPolicyAgent aborted', 'AbortError');
    // Persist for post-run diagnostics (best-effort)
    try {
      await persistAgentErrorAuto({
        outputDir: input.outputDir,
        agentName: 'LoopSemanticsPolicyAgent',
        severity: 'warning',
        actionTaken: 'aborted',
        error: abortErr,
        meta: { bannerGroups: input.bannerGroups.length, loops: input.loopSummary.length },
      });
    } catch {
      // ignore
    }
    throw abortErr;
  }

  // Build system prompt
  const promptVersions = getPromptVersions();
  const systemInstructions = getLoopSemanticsPrompt(promptVersions.loopSemanticsPromptVersion);

  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${systemInstructions}`;

  // Build user prompt with runtime data
  const baseUserPrompt = buildUserPrompt(input);

  // Build set of known columns for validation (from datamap excerpt only)
  // Agent will identify iteration-linked variables through cut structure + datamap reasoning
  const knownColumns = new Set(input.datamapExcerpt.map(e => e.column));

  // Clear scratchpad from any previous runs (only once at the start)
  clearContextScratchpadsForAgent('LoopSemanticsPolicy');

  const maxSemanticRetries = 2; // corrective retries for hallucinated variables

  // Wrap the AI call with retry logic for policy errors
  try {
    let result: LoopSemanticsPolicy | null = null;

    for (let semanticAttempt = 0; semanticAttempt <= maxSemanticRetries; semanticAttempt++) {
      // Build prompt — first attempt uses base, retries append correction
      let currentPrompt = baseUserPrompt;
      if (semanticAttempt > 0 && result) {
        const corrections = buildCorrectionPrompt(result, knownColumns);
        currentPrompt = baseUserPrompt + '\n\n' + corrections;
        console.log(
          `[LoopSemanticsPolicyAgent] Semantic retry ${semanticAttempt}/${maxSemanticRetries}: ` +
          `correcting hallucinated variables`,
        );
      }

      // Create fresh scratchpad for each attempt
      const scratchpad = createContextScratchpadTool('LoopSemanticsPolicy', `policy-attempt-${semanticAttempt}`);

      const retryResult = await retryWithPolicyHandling(
        async () => {
          const { output, usage } = await generateText({
            model: getLoopSemanticsModel(),
            system: systemPrompt,
            maxRetries: 0, // Centralized outer retries via retryWithPolicyHandling
            prompt: currentPrompt,
            tools: {
              scratchpad,
            },
            stopWhen: stepCountIs(15),
            maxOutputTokens: Math.min(getLoopSemanticsModelTokenLimit(), 100000),
            ...getGenerationSamplingParams(getLoopSemanticsModelName()),
            providerOptions: {
              openai: {
                reasoningEffort: getLoopSemanticsReasoningEffort(),
                parallelToolCalls: genConfig.parallelToolCalls,
              },
            },
            output: Output.object({
              schema: LoopSemanticsPolicySchema,
            }),
            abortSignal: input.abortSignal,
          });

          if (!output || !output.bannerGroups) {
            throw new Error('Invalid output from LoopSemanticsPolicyAgent');
          }

          // Record metrics
          const durationMs = Date.now() - startTime;
          recordAgentMetrics(
            'LoopSemanticsPolicyAgent',
            getLoopSemanticsModelName(),
            { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
            durationMs,
          );

          return output;
        },
        {
          abortSignal: input.abortSignal,
          maxAttempts,
          onRetry: (attempt, err) => {
            if (err instanceof DOMException && err.name === 'AbortError') {
              throw err;
            }
            console.warn(`[LoopSemanticsPolicyAgent] Retry ${attempt}/${maxAttempts}: ${err.message.substring(0, 120)}`);
          },
        },
      );

      // Handle abort
      if (retryResult.error === 'Operation was cancelled') {
        throw new DOMException('LoopSemanticsPolicyAgent aborted', 'AbortError');
      }

      if (!retryResult.success || !retryResult.result) {
        throw new Error(`LoopSemanticsPolicyAgent failed: ${retryResult.error || 'Unknown error'}`);
      }

      result = retryResult.result;

      // Validate sourcesByIteration variables exist in the datamap.
      // The agent can identify iteration-linked variables through semantic reasoning,
      // so we only check that the variables actually exist (not hallucinated).
      const hallucinations = findHallucinatedVariables(result, knownColumns);
      if (hallucinations.length === 0) {
        // Clean — no retries needed
        break;
      }

      if (semanticAttempt < maxSemanticRetries) {
        // Will retry — log what we found
        console.warn(
          `[LoopSemanticsPolicyAgent] Found ${hallucinations.length} hallucinated variable(s): ` +
          hallucinations.map(h => `"${h.variable}" in group "${h.groupName}"`).join(', '),
        );
      } else {
        // Final attempt still has hallucinations — strip them as last resort
        console.warn(
          `[LoopSemanticsPolicyAgent] Exhausted ${maxSemanticRetries} semantic retries, ` +
          `stripping ${hallucinations.length} remaining hallucinated variable(s)`,
        );
        for (const bg of result.bannerGroups) {
          if (bg.implementation.strategy !== 'alias_column') continue;
          const before = bg.implementation.sourcesByIteration.length;
          bg.implementation.sourcesByIteration = bg.implementation.sourcesByIteration.filter(
            s => knownColumns.has(s.variable),
          );
          const removed = before - bg.implementation.sourcesByIteration.length;
          if (removed > 0) {
            bg.confidence = Math.min(bg.confidence, 0.5);
            const warning = `${bg.groupName}: Stripped ${removed} variable(s) not found in datamap after ${maxSemanticRetries} correction retries`;
            bg.evidence.push(warning);
            result.warnings.push(warning);
          }
        }
      }
    }

    if (!result) {
      throw new Error('LoopSemanticsPolicyAgent produced no result');
    }

    // Save scratchpad trace
    const contextEntries = getAllContextScratchpadEntries('LoopSemanticsPolicy');
    const allScratchpadEntries = contextEntries.flatMap((ctx) =>
      ctx.entries.map((e) => ({ ...e, contextId: ctx.contextId }))
    );
    if (allScratchpadEntries.length > 0) {
      const loopPolicyDir = path.join(input.outputDir, 'agents', 'loop-semantics');
      await fs.mkdir(loopPolicyDir, { recursive: true });
      const scratchpadMd = formatScratchpadAsMarkdown('LoopSemanticsPolicyAgent', allScratchpadEntries);
      await fs.writeFile(
        path.join(loopPolicyDir, 'scratchpad-loop-semantics.md'),
        scratchpadMd,
        'utf-8',
      );
      clearContextScratchpadsForAgent('LoopSemanticsPolicy');
    }

    console.log(
      `[LoopSemanticsPolicyAgent] Done: ${result.bannerGroups.filter((g: { anchorType: string }) => g.anchorType === 'entity').length} entity-anchored, ` +
      `${result.bannerGroups.filter((g: { anchorType: string }) => g.anchorType === 'respondent').length} respondent-anchored ` +
      `(${Date.now() - startTime}ms)`,
    );

    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      // Persist aborts too (best-effort)
      try {
        await persistAgentErrorAuto({
          outputDir: input.outputDir,
          agentName: 'LoopSemanticsPolicyAgent',
          severity: 'warning',
          actionTaken: 'aborted',
          error,
          meta: { bannerGroups: input.bannerGroups.length, loops: input.loopSummary.length },
        });
      } catch {
        // ignore
      }
      throw error;
    }

    try {
      await persistAgentErrorAuto({
        outputDir: input.outputDir,
        agentName: 'LoopSemanticsPolicyAgent',
        severity: 'error',
        actionTaken: 'continued',
        error,
        meta: { bannerGroups: input.bannerGroups.length, loops: input.loopSummary.length },
      });
    } catch {
      // ignore
    }

    throw error;
  }
}

// =============================================================================
// Prompt Assembly
// =============================================================================

/**
 * Build the user prompt with runtime data from the pipeline.
 *
 * Three sections:
 * 1. <stacked_frame> — what the loop structure is, with family context
 * 2. <banner_cuts> — the cuts being classified
 * 3. <cut_variable_context> — metadata for variables referenced in cuts
 */
function buildUserPrompt(input: LoopSemanticsPolicyInput): string {
  const sections: string[] = [];

  sections.push('Classify each banner group as respondent-anchored or entity-anchored.\n');

  // Section 1: Stacked frame context
  sections.push('<stacked_frame>');
  sections.push(`This dataset has ${input.loopSummary.length} stacked loop frame(s).`);
  sections.push('Each row represents one loop entity, not one respondent.\n');

  for (const frame of input.loopSummary) {
    sections.push(`Frame: "${frame.stackedFrameName}"${frame.familyBase ? ` (family: ${frame.familyBase})` : ''}`);
    sections.push(`  Iterations: ${frame.iterations.length} (values: ${frame.iterations.map(i => `"${i}"`).join(', ')})`);
    sections.push(`  Recognized loop variables: ${frame.variableCount}`);

    if (frame.familyQuestionText) {
      sections.push(`  Loop question: ${sanitizeForAzureContentFilter(frame.familyQuestionText)}`);
    }

    if (frame.representativeLabels && frame.representativeLabels.length > 0) {
      sections.push('  Sample variable labels:');
      for (const label of frame.representativeLabels.slice(0, 8)) {
        sections.push(`    - ${sanitizeForAzureContentFilter(label)}`);
      }
    }

    // Show recognized variable base names
    const mapping = input.loopMappings.find(m => m.stackedFrameName === frame.stackedFrameName);
    if (mapping) {
      const baseNames = mapping.variables.map(v => v.baseName);
      if (baseNames.length > 0) {
        sections.push(`  Recognized variable bases: ${baseNames.slice(0, 15).join(', ')}${baseNames.length > 15 ? ` ... (${baseNames.length} total)` : ''}`);
      }
    }
    sections.push('');
  }

  sections.push('The banner cuts below may reference variables that are NOT in the recognized');
  sections.push('loop variable list above. That is expected — your job is to determine whether');
  sections.push('each CUT should be applied per-entity or per-respondent on this stacked frame.');
  sections.push('</stacked_frame>\n');

  // Section 2: Banner cuts (the groups and their R expressions)
  sections.push('<banner_cuts>');
  for (const group of input.bannerGroups) {
    sections.push(`\nGroup: "${group.groupName}"`);
    sections.push(`  Columns: ${group.columns.map(c => c.name).join(', ')}`);

    const groupCuts = input.cuts.filter(c => c.groupName === group.groupName);
    if (groupCuts.length > 0) {
      sections.push('  Cuts:');
      for (const cut of groupCuts) {
        sections.push(`    "${cut.name}" = ${cut.rExpression}`);
      }
    }
  }
  sections.push('</banner_cuts>\n');

  // Section 3: Variable context for cut variables
  sections.push('<cut_variable_context>');
  sections.push('Metadata for variables referenced in the banner cuts above:\n');
  for (const entry of input.datamapExcerpt) {
    let line = `  ${entry.column}: ${sanitizeForAzureContentFilter(entry.description)} [${entry.normalizedType}]`;
    if ('questionId' in entry && entry.questionId) {
      line += ` (question: ${entry.questionId})`;
    }
    sections.push(line);
    if ('analyticalSubtype' in entry && entry.analyticalSubtype) {
      sections.push(`    Subtype: ${entry.analyticalSubtype}`);
    }
    if ('loop' in entry && entry.loop) {
      sections.push(`    Loop: family="${entry.loop.familyBase}" iteration=${entry.loop.iterationIndex}/${entry.loop.iterationCount}`);
    }
    if (entry.answerOptions) {
      sections.push(`    Options: ${sanitizeForAzureContentFilter(entry.answerOptions.substring(0, 200))}`);
    }
  }
  sections.push('</cut_variable_context>\n');

  sections.push('Output your classification for every banner group listed above.');
  sections.push('Set policyVersion to "1.0".');

  return sections.join('\n');
}

// =============================================================================
// Semantic Validation Helpers
// =============================================================================

interface HallucinatedVariable {
  groupName: string;
  variable: string;
  iteration: string;
}

/**
 * Find sourcesByIteration entries that reference variables that don't exist in the datamap.
 * Simple check: does the variable exist anywhere in the dataset?
 */
function findHallucinatedVariables(
  policy: LoopSemanticsPolicy,
  knownColumns: Set<string>,
): HallucinatedVariable[] {
  const hallucinations: HallucinatedVariable[] = [];
  for (const bg of policy.bannerGroups) {
    if (bg.implementation.strategy !== 'alias_column') continue;

    for (const s of bg.implementation.sourcesByIteration) {
      // Simple check: does the variable exist in the datamap?
      if (!knownColumns.has(s.variable)) {
        hallucinations.push({
          groupName: bg.groupName,
          variable: s.variable,
          iteration: s.iteration,
        });
      }
    }
  }
  return hallucinations;
}

/**
 * Build a corrective prompt appendix that tells the agent exactly which variables
 * it hallucinated, so it can fix its output.
 */
function buildCorrectionPrompt(
  previousResult: LoopSemanticsPolicy,
  knownColumns: Set<string>,
): string {
  const sections: string[] = [];
  sections.push('<correction>');
  sections.push('IMPORTANT: Your previous output contained variables in sourcesByIteration that DO NOT EXIST in the datamap.');
  sections.push('A sourcesByIteration variable must be a real column from the dataset, listed in cut_variable_context.');
  sections.push('The following variables were invalid:\n');

  for (const bg of previousResult.bannerGroups) {
    if (bg.implementation.strategy !== 'alias_column') continue;
    const bad = bg.implementation.sourcesByIteration.filter(s => !knownColumns.has(s.variable));
    if (bad.length === 0) continue;

    const good = bg.implementation.sourcesByIteration.filter(s => knownColumns.has(s.variable));
    sections.push(`Group "${bg.groupName}":`);
    sections.push(`  INVALID variables (not in datamap): ${bad.map(s => `${s.variable} (iteration ${s.iteration})`).join(', ')}`);
    if (good.length > 0) {
      sections.push(`  VALID variables (exist in datamap): ${good.map(s => `${s.variable} (iteration ${s.iteration})`).join(', ')}`);
    }
    sections.push('');
  }

  sections.push('Please re-classify all banner groups with ONLY variables that exist in datamap_excerpt.');
  sections.push('If no valid iteration-linked variables exist for a group, reclassify it as respondent-anchored.');
  sections.push('</correction>');

  return sections.join('\n');
}


// buildDatamapExcerpt removed — use buildLoopSemanticsExcerpt from @/lib/questionContext instead
