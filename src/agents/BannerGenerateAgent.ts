/**
 * BannerGenerateAgent
 *
 * Purpose: Generate banner cuts from a verbose datamap when no banner plan document exists.
 * Uses AI to design analytically valuable cross-tabulation groups from survey variable metadata.
 *
 * Inputs: verboseDataMap, optional researchObjectives/cutSuggestions/projectType
 * Output: AgentBannerGroup[] (identical shape to BannerAgent output)
 *
 * Follows LoopSemanticsPolicyAgent pattern: standalone async function, not a class.
 */

import { generateText, Output, stepCountIs } from 'ai';
import { z } from 'zod';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  getBannerGenerateModel,
  getBannerGenerateModelName,
  getBannerGenerateModelTokenLimit,
  getBannerGenerateReasoningEffort,
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
import { getBannerGeneratePrompt, buildBannerGenerateUserPromptForVersion } from '../prompts';
import { retryWithPolicyHandling } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability';
import type { AgentBannerGroup } from '../lib/contextBuilder';
import type { VerboseDataMap } from '../lib/processors/DataMapProcessor';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';
import { validateBannerGroups } from '../lib/tables/validateBannerGroups';
import fs from 'fs/promises';
import path from 'path';

// =============================================================================
// Types
// =============================================================================

export interface BannerGenerateInput {
  /** Verbose datamap from DataMapProcessor */
  verboseDataMap: VerboseDataMap[];
  /** Optional research objectives to guide cut selection */
  researchObjectives?: string;
  /** Optional cut suggestions (treated as near-requirements) */
  cutSuggestions?: string;
  /** Optional project type hint */
  projectType?: string;
  /** Output directory for saving artifacts */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface BannerGenerateResult {
  /** Generated banner groups (same shape as BannerAgent output) */
  agent: AgentBannerGroup[];
  /** Model confidence in the generated banner */
  confidence: number;
  /** Brief reasoning summary */
  reasoning: string;
}

type CompactDataMapEntry = {
  column: string;
  description: string;
  normalizedType?: string;
  answerOptions: string;
  parentQuestion?: string;
  family?: string;
};

interface ValidationArtifact {
  promptVersion: string;
  initial: {
    total: number;
    valid: number;
    invalid: number;
    byCode: Record<string, number>;
  };
  retry: {
    attempted: boolean;
    total: number;
    valid: number;
    invalid: number;
    byCode: Record<string, number>;
  };
  droppedGroups: Array<{
    groupName: string;
    reason: string;
    code: string;
    unresolvedVariables: string[];
    parents: string[];
  }>;
  finalGroupCount: number;
  timestamp: string;
}

// =============================================================================
// Output Schema
// =============================================================================

const BannerGenerateOutputSchema = z.object({
  bannerGroups: z.array(z.object({
    groupName: z.string().describe('Descriptive name for this banner group'),
    columns: z.array(z.object({
      name: z.string().describe('Display label for this column'),
      original: z.string().describe('Filter expression referencing datamap variables (e.g., "Q3==1")'),
    })).describe('Columns in this banner group (3-12 recommended)'),
  })).describe('3-7 banner groups'),
  confidence: z.number().min(0).max(1).describe('Confidence in the quality of generated cuts (0-1)'),
  reasoning: z.string().describe('Brief summary of design rationale'),
});

type BannerGenerateModelOutput = z.infer<typeof BannerGenerateOutputSchema>;

const MODEL_MAX_ATTEMPTS = 10;

function buildCompactDataMap(
  verboseDataMap: VerboseDataMap[],
  promptVersion: string,
): CompactDataMapEntry[] {
  return verboseDataMap.map((v) => {
    const base: CompactDataMapEntry = {
      column: v.column,
      description: sanitizeForAzureContentFilter(v.description || ''),
      normalizedType: v.normalizedType,
      answerOptions: sanitizeForAzureContentFilter(v.answerOptions || ''),
    };

    if (promptVersion === 'alternative') {
      const parentQuestion = sanitizeForAzureContentFilter(v.parentQuestion || 'NA');
      const family = parentQuestion !== 'NA' ? parentQuestion : sanitizeForAzureContentFilter(v.column);
      return {
        ...base,
        parentQuestion,
        family,
      };
    }

    return base;
  });
}

function toAgentBanner(output: BannerGenerateModelOutput): AgentBannerGroup[] {
  return output.bannerGroups.map((group) => ({
    groupName: group.groupName,
    columns: group.columns.map((column) => ({
      name: column.name,
      original: column.original,
    })),
  }));
}

async function runBannerGenerateModelCall(args: {
  input: BannerGenerateInput;
  systemPrompt: string;
  userPrompt: string;
  runLabel: string;
}): Promise<BannerGenerateModelOutput> {
  const genConfig = getGenerationConfig();

  // Clear scratchpad from any previous runs
  clearContextScratchpadsForAgent('BannerGenerate');

  // Create context-isolated scratchpad
  const scratchpad = createContextScratchpadTool('BannerGenerate', args.runLabel);

  const retryResult = await retryWithPolicyHandling(
    async () => {
      const modelCallStart = Date.now();
      const { output, usage } = await generateText({
        model: getBannerGenerateModel(),
        system: args.systemPrompt,
        maxRetries: 0, // Centralized outer retries via retryWithPolicyHandling
        prompt: args.userPrompt,
        tools: {
          scratchpad,
        },
        stopWhen: stepCountIs(15),
        maxOutputTokens: Math.min(getBannerGenerateModelTokenLimit(), 100000),
        ...getGenerationSamplingParams(getBannerGenerateModelName()),
        providerOptions: {
          openai: {
            reasoningEffort: getBannerGenerateReasoningEffort(),
            parallelToolCalls: genConfig.parallelToolCalls,
          },
        },
        output: Output.object({
          schema: BannerGenerateOutputSchema,
        }),
        abortSignal: args.input.abortSignal,
      });

      if (!output || !output.bannerGroups || output.bannerGroups.length === 0) {
        throw new Error('BannerGenerateAgent produced empty output');
      }

      // Record metrics
      const durationMs = Date.now() - modelCallStart;
      recordAgentMetrics(
        'BannerGenerateAgent',
        getBannerGenerateModelName(),
        { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
        durationMs,
      );

      return output;
    },
    {
      abortSignal: args.input.abortSignal,
      maxAttempts: MODEL_MAX_ATTEMPTS,
      onRetry: (attempt, err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        console.warn(
          `[BannerGenerateAgent:${args.runLabel}] Retry ${attempt}/${MODEL_MAX_ATTEMPTS}: ${err.message.substring(0, 120)}`,
        );
      },
    },
  );

  // Handle abort
  if (retryResult.error === 'Operation was cancelled') {
    throw new DOMException('BannerGenerateAgent aborted', 'AbortError');
  }

  if (!retryResult.success || !retryResult.result) {
    throw new Error(`BannerGenerateAgent failed: ${retryResult.error || 'Unknown error'}`);
  }

  return retryResult.result;
}

function buildStandardUserPrompt(input: BannerGenerateInput, promptVersion: string): string {
  const compactDataMap = buildCompactDataMap(input.verboseDataMap, promptVersion);
  return buildBannerGenerateUserPromptForVersion(
    {
      verboseDataMap: compactDataMap,
      researchObjectives: input.researchObjectives,
      cutSuggestions: input.cutSuggestions,
      projectType: input.projectType,
    },
    promptVersion,
  );
}

function buildCorrectionPrompt(args: {
  promptVersion: string;
  compactDataMap: CompactDataMapEntry[];
  originalGroups: AgentBannerGroup[];
  validGroups: AgentBannerGroup[];
  invalidGroups: ReturnType<typeof validateBannerGroups>['invalid'];
}): string {
  const datamapLines = args.compactDataMap.map((entry) => {
    const typePart = entry.normalizedType ? ` [${entry.normalizedType}]` : '';
    const optionsPart = entry.answerOptions ? ` | Options: ${entry.answerOptions.substring(0, 200)}` : '';
    const parentPart = entry.parentQuestion ? ` | ParentQuestion: ${entry.parentQuestion}` : '';
    const familyPart = entry.family ? ` | Family: ${entry.family}` : '';
    return `${entry.column} | ${entry.description}${typePart}${optionsPart}${parentPart}${familyPart}`;
  });

  const invalidSummary = args.invalidGroups.map((issue) => ({
    groupIndex: issue.groupIndex,
    groupName: issue.groupName,
    code: issue.code,
    reason: issue.reason,
    parents: issue.parents,
    unresolvedVariables: issue.unresolvedVariables,
    group: issue.group,
  }));

  return [
    'You generated banner groups previously. Deterministic validation found issues.',
    '',
    'Fix ONLY the invalid groups, keep valid groups exactly unchanged, and return a complete final set of groups.',
    'Validation rules:',
    '- Each group must have at least 2 columns.',
    '- Every group must resolve to exactly one variable family (same parent family).',
    '- Every filter expression must reference resolvable datamap variables.',
    '',
    `<prompt_version>${args.promptVersion}</prompt_version>`,
    '<datamap>',
    ...datamapLines,
    '</datamap>',
    '',
    '<original_output>',
    JSON.stringify(args.originalGroups, null, 2),
    '</original_output>',
    '',
    '<valid_groups_keep_unchanged>',
    JSON.stringify(args.validGroups, null, 2),
    '</valid_groups_keep_unchanged>',
    '',
    '<invalid_groups_to_fix>',
    JSON.stringify(invalidSummary, null, 2),
    '</invalid_groups_to_fix>',
    '',
    'Output all groups (both unchanged valid groups and corrected replacements for invalid groups).',
    'Do not output commentary.',
  ].join('\n');
}

async function saveGeneratedBannerArtifact(args: {
  input: BannerGenerateInput;
  result: BannerGenerateResult;
  source: string;
  durationMs: number;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const bannerDir = path.join(args.input.outputDir, 'agents', 'banner');
  await fs.mkdir(bannerDir, { recursive: true });

  await fs.writeFile(
    path.join(bannerDir, 'banner-generated.json'),
    JSON.stringify(
      {
        source: args.source,
        confidence: args.result.confidence,
        reasoning: args.result.reasoning,
        bannerGroups: args.result.agent,
        metadata: {
          variableCount: args.input.verboseDataMap.length,
          researchObjectives: args.input.researchObjectives || null,
          cutSuggestions: args.input.cutSuggestions || null,
          projectType: args.input.projectType || null,
          model: getBannerGenerateModelName(),
          durationMs: args.durationMs,
          ...args.metadata,
        },
      },
      null,
      2,
    ),
    'utf-8',
  );
}

async function saveScratchpadTrace(outputDir: string, fileName: string): Promise<void> {
  const contextEntries = getAllContextScratchpadEntries('BannerGenerate');
  const allScratchpadEntries = contextEntries.flatMap((ctx) =>
    ctx.entries.map((entry) => ({ ...entry, contextId: ctx.contextId })),
  );
  if (allScratchpadEntries.length === 0) {
    clearContextScratchpadsForAgent('BannerGenerate');
    return;
  }

  const bannerDir = path.join(outputDir, 'agents', 'banner');
  await fs.mkdir(bannerDir, { recursive: true });
  const scratchpadMd = formatScratchpadAsMarkdown('BannerGenerateAgent', allScratchpadEntries);
  await fs.writeFile(path.join(bannerDir, fileName), scratchpadMd, 'utf-8');
  clearContextScratchpadsForAgent('BannerGenerate');
}

async function saveValidationArtifact(outputDir: string, artifact: ValidationArtifact): Promise<void> {
  const bannerDir = path.join(outputDir, 'agents', 'banner');
  await fs.mkdir(bannerDir, { recursive: true });
  await fs.writeFile(
    path.join(bannerDir, 'banner-generated-validation.json'),
    JSON.stringify(artifact, null, 2),
    'utf-8',
  );
}

function toCodeCounts(stats: ReturnType<typeof validateBannerGroups>['stats']['byCode']): Record<string, number> {
  return {
    MIN_COLUMNS: stats.MIN_COLUMNS,
    MIXED_PARENTS: stats.MIXED_PARENTS,
    UNRESOLVED_VARIABLES: stats.UNRESOLVED_VARIABLES,
    NO_VARIABLE_REFERENCES: stats.NO_VARIABLE_REFERENCES,
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Generate banner cuts from a verbose datamap using AI.
 * Called when no banner plan document is available.
 */
export async function generateBannerCuts(
  input: BannerGenerateInput,
): Promise<BannerGenerateResult> {
  console.log(`[BannerGenerateAgent] Generating banner cuts from ${input.verboseDataMap.length} variables`);
  const startTime = Date.now();

  // Check for cancellation
  if (input.abortSignal?.aborted) {
    const abortErr = new DOMException('BannerGenerateAgent aborted', 'AbortError');
    try {
      await persistAgentErrorAuto({
        outputDir: input.outputDir,
        agentName: 'BannerGenerateAgent',
        severity: 'warning',
        actionTaken: 'aborted',
        error: abortErr,
        meta: { variableCount: input.verboseDataMap.length },
      });
    } catch {
      // ignore
    }
    throw abortErr;
  }

  const promptVersion = getPromptVersions().bannerGeneratePromptVersion;
  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${getBannerGeneratePrompt(promptVersion)}`;
  const userPrompt = buildStandardUserPrompt(input, promptVersion);

  try {
    const modelResult = await runBannerGenerateModelCall({
      input,
      systemPrompt,
      userPrompt,
      runLabel: 'generate',
    });

    const result: BannerGenerateResult = {
      agent: toAgentBanner(modelResult),
      confidence: modelResult.confidence,
      reasoning: modelResult.reasoning,
    };

    await saveGeneratedBannerArtifact({
      input,
      result,
      source: 'BannerGenerateAgent',
      durationMs: Date.now() - startTime,
      metadata: {
        promptVersion,
      },
    });

    await saveScratchpadTrace(input.outputDir, 'scratchpad-banner-generate.md');

    const totalColumns = result.agent.reduce((sum, g) => sum + g.columns.length, 0);
    console.log(
      `[BannerGenerateAgent] Done: ${result.agent.length} groups, ${totalColumns} columns ` +
      `(confidence: ${result.confidence.toFixed(2)}, ${Date.now() - startTime}ms)`,
    );

    return result;
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    try {
      await persistAgentErrorAuto({
        outputDir: input.outputDir,
        agentName: 'BannerGenerateAgent',
        severity: isAbort ? 'warning' : 'error',
        actionTaken: isAbort ? 'aborted' : 'continued',
        error,
        meta: { variableCount: input.verboseDataMap.length },
      });
    } catch {
      // ignore
    }
    throw error;
  }
}

/**
 * Generate banner cuts and enforce deterministic validation with one correction retry.
 */
export async function generateBannerCutsWithValidation(
  input: BannerGenerateInput,
): Promise<BannerGenerateResult> {
  const startTime = Date.now();
  const promptVersion = getPromptVersions().bannerGeneratePromptVersion;

  const initialResult = await generateBannerCuts(input);
  const initialValidation = validateBannerGroups(initialResult.agent, input.verboseDataMap);

  let retryAttempted = false;
  let retryValidationStats = {
    total: 0,
    valid: 0,
    invalid: 0,
    byCode: {
      MIN_COLUMNS: 0,
      MIXED_PARENTS: 0,
      UNRESOLVED_VARIABLES: 0,
      NO_VARIABLE_REFERENCES: 0,
    },
  };
  let dropped = [] as ReturnType<typeof validateBannerGroups>['invalid'];

  if (initialValidation.invalid.length === 0) {
    await saveValidationArtifact(input.outputDir, {
      promptVersion,
      initial: {
        total: initialValidation.stats.total,
        valid: initialValidation.stats.valid,
        invalid: initialValidation.stats.invalid,
        byCode: toCodeCounts(initialValidation.stats.byCode),
      },
      retry: {
        attempted: false,
        total: 0,
        valid: 0,
        invalid: 0,
        byCode: toCodeCounts(retryValidationStats.byCode),
      },
      droppedGroups: [],
      finalGroupCount: initialResult.agent.length,
      timestamp: new Date().toISOString(),
    });
    return initialResult;
  }

  retryAttempted = true;
  console.warn(
    `[BannerGenerateAgent] Validation rejected ${initialValidation.invalid.length}/${initialValidation.stats.total} groups; attempting one correction retry`,
  );

  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${getBannerGeneratePrompt(promptVersion)}`;
  const correctionPrompt = buildCorrectionPrompt({
    promptVersion,
    compactDataMap: buildCompactDataMap(input.verboseDataMap, promptVersion),
    originalGroups: initialResult.agent,
    validGroups: initialValidation.valid,
    invalidGroups: initialValidation.invalid,
  });

  const correctedModelResult = await runBannerGenerateModelCall({
    input,
    systemPrompt,
    userPrompt: correctionPrompt,
    runLabel: 'correction',
  });
  const correctedResult: BannerGenerateResult = {
    agent: toAgentBanner(correctedModelResult),
    confidence: correctedModelResult.confidence,
    reasoning: correctedModelResult.reasoning,
  };

  await saveScratchpadTrace(input.outputDir, 'scratchpad-banner-generate-correction.md');

  const correctedValidation = validateBannerGroups(correctedResult.agent, input.verboseDataMap);
  retryValidationStats = correctedValidation.stats;
  dropped = correctedValidation.invalid;

  if (dropped.length > 0) {
    console.warn(`[BannerGenerateAgent] Correction retry still had ${dropped.length} invalid group(s); dropping them`);
    for (const issue of dropped) {
      try {
        await persistAgentErrorAuto({
          outputDir: input.outputDir,
          agentName: 'BannerGenerateAgent',
          severity: 'warning',
          classification: 'output_validation',
          actionTaken: 'skipped_item',
          itemId: issue.groupName,
          error: new Error(`Banner group dropped (${issue.code}): ${issue.reason}`),
          meta: {
            phase: 'banner_group_validation',
            groupName: issue.groupName,
            groupIndex: issue.groupIndex,
            code: issue.code,
            reason: issue.reason,
            parents: issue.parents,
            unresolvedVariables: issue.unresolvedVariables,
          },
        });
      } catch {
        // ignore
      }
    }
  }

  const finalGroups = correctedValidation.valid;
  if (finalGroups.length === 0) {
    const err = new Error('BannerGenerateAgent validation failed: 0 valid groups after correction retry');
    await persistAgentErrorAuto({
      outputDir: input.outputDir,
      agentName: 'BannerGenerateAgent',
      severity: 'error',
      classification: 'output_validation',
      actionTaken: 'continued',
      error: err,
      meta: {
        initialInvalidCount: initialValidation.invalid.length,
        retryInvalidCount: dropped.length,
      },
    });
    throw err;
  }

  const finalResult: BannerGenerateResult = {
    agent: finalGroups,
    confidence: correctedResult.confidence,
    reasoning: correctedResult.reasoning,
  };

  await saveGeneratedBannerArtifact({
    input,
    result: finalResult,
    source: 'BannerGenerateAgentWithValidation',
    durationMs: Date.now() - startTime,
    metadata: {
      promptVersion,
      validationApplied: true,
      initialInvalidCount: initialValidation.invalid.length,
      retryInvalidCount: dropped.length,
      droppedInvalidGroups: dropped.length,
    },
  });

  await saveValidationArtifact(input.outputDir, {
    promptVersion,
    initial: {
      total: initialValidation.stats.total,
      valid: initialValidation.stats.valid,
      invalid: initialValidation.stats.invalid,
      byCode: toCodeCounts(initialValidation.stats.byCode),
    },
    retry: {
      attempted: retryAttempted,
      total: retryValidationStats.total,
      valid: retryValidationStats.valid,
      invalid: retryValidationStats.invalid,
      byCode: toCodeCounts(retryValidationStats.byCode),
    },
    droppedGroups: dropped.map((issue) => ({
      groupName: issue.groupName,
      reason: issue.reason,
      code: issue.code,
      unresolvedVariables: issue.unresolvedVariables,
      parents: issue.parents,
    })),
    finalGroupCount: finalGroups.length,
    timestamp: new Date().toISOString(),
  });

  console.log(
    `[BannerGenerateAgent] Validation complete: ${finalGroups.length} groups retained, ${dropped.length} dropped after correction`,
  );

  return finalResult;
}

// =============================================================================
// V2 Entry Point — Question-Centric Input
// =============================================================================

export interface BannerGenerateInputV2 {
  /** Question-centric summaries (one per question, not per variable) */
  questionContext: import('../schemas/questionContextSchema').BannerQuestionSummary[];
  /** Optional research objectives to guide cut selection */
  researchObjectives?: string;
  /** Optional cut suggestions (treated as near-requirements) */
  cutSuggestions?: string;
  /** Optional project type hint */
  projectType?: string;
  /** Output directory for saving artifacts */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Generate banner cuts from question-centric input (V2 path).
 * Converts BannerQuestionSummary[] to the existing pipeline via
 * toBannerVerboseDataMap for validation, but uses question-centric
 * prompt rendering for the AI call.
 */
export async function generateBannerCutsWithValidationV2(
  input: BannerGenerateInputV2,
): Promise<BannerGenerateResult> {
  // Build the question-centric user prompt
  const { buildBannerGenerateUserPromptV3: buildV3Prompt } = await import('../prompts/bannerGenerate/production');
  const userPrompt = buildV3Prompt({
    questionContext: input.questionContext,
    researchObjectives: input.researchObjectives,
    cutSuggestions: input.cutSuggestions,
    projectType: input.projectType,
  });

  // System prompt — production prompt (V3 structural pattern)
  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${getBannerGeneratePrompt('production')}`;

  // Run model call via existing infrastructure
  const modelOutput = await runBannerGenerateModelCall({
    input: {
      // Shim: build VerboseDataMap for the parts that need it (validation, error persistence)
      verboseDataMap: [],  // Not used for prompt building in V2
      researchObjectives: input.researchObjectives,
      cutSuggestions: input.cutSuggestions,
      projectType: input.projectType,
      outputDir: input.outputDir,
      abortSignal: input.abortSignal,
    },
    systemPrompt,
    userPrompt,
    runLabel: 'v2-question-centric',
  });

  const agentGroups = toAgentBanner(modelOutput);

  // Build VerboseDataMap shim for validation (uses toBannerVerboseDataMap)
  const { toBannerVerboseDataMap } = await import('../lib/questionContext');
  const verboseShim = toBannerVerboseDataMap(input.questionContext);
  const validation = validateBannerGroups(agentGroups, verboseShim);

  // Drop invalid groups
  const invalidNames = new Set(validation.invalid.map((i) => i.groupName));
  const finalGroups = agentGroups.filter((g) => !invalidNames.has(g.groupName));

  if (finalGroups.length === 0 && agentGroups.length > 0) {
    console.warn('[BannerGenerateAgentV2] All groups failed validation — returning unfiltered');
    return { agent: agentGroups, confidence: modelOutput.confidence * 0.5, reasoning: modelOutput.reasoning };
  }

  return {
    agent: finalGroups.length > 0 ? finalGroups : agentGroups,
    confidence: modelOutput.confidence,
    reasoning: modelOutput.reasoning,
  };
}
