/**
 * LoopGateAgent
 *
 * Purpose: Review one representative per loop family and determine whether
 * the detected loop is genuine respondent-level iteration or a false positive.
 * The decision propagates ONLY the loop field to all siblings — no other
 * structural classifications are touched here.
 *
 * Inputs: Loop family representative entry, survey-parsed.json, survey metadata
 * Output: LoopGateEntryResult (confirmed, cleared, or flagged_for_human)
 *
 * Runs once per loop family, parallelized with p-limit(3) in batch mode.
 * Error fallback: 'confirmed' (never auto-clear loops on agent failure).
 */

import { generateText, Output, stepCountIs } from 'ai';
import pLimit from 'p-limit';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  LoopGateEntryResultSchema,
  type LoopGateEntryResult,
} from '../schemas/loopGateSchema';
import {
  getLoopGateModel,
  getLoopGateModelName,
  getLoopGateModelTokenLimit,
  getLoopGateReasoningEffort,
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
import { getLoopGatePrompt } from '../prompts';
import { retryWithPolicyHandling } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability/AgentMetrics';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';

// =============================================================================
// Types
// =============================================================================

interface SurveyMetadata {
  dataset: string;
  isMessageTestingSurvey: boolean;
  hasMaxDiff: boolean | null;
  hasAnchoredScores: boolean | null;
  isDemandSurvey: boolean;
  hasChoiceModelExercise: boolean | null;
  [key: string]: unknown;
}

export interface LoopGateEntryInput {
  /** The representative entry for this loop family (lowest iterationIndex) */
  entry: Record<string, unknown>;
  /** The familyBase string for this loop family */
  familyBase: string;
  /** Number of siblings in the family (including representative) */
  siblingCount: number;
  /** Full parsed survey questions */
  surveyParsed: unknown[];
  /** Survey-level metadata */
  surveyMetadata: SurveyMetadata | null;
  /** Output directory for error persistence */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface LoopGateBatchInput {
  /** One representative entry per loop family */
  loopFamilyRepresentatives: Array<{
    entry: Record<string, unknown>;
    familyBase: string;
    siblingCount: number;
    questionId: string;
  }>;
  /** Full parsed survey questions */
  surveyParsed: unknown[];
  /** Survey-level metadata */
  surveyMetadata: SurveyMetadata | null;
  /** Output directory for artifacts and errors */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Concurrency limit (default: 3) */
  concurrency?: number;
}

export interface LoopGateBatchResult {
  results: LoopGateEntryResult[];
  summary: {
    total: number;
    confirmed: number;
    cleared: number;
    flaggedForHuman: number;
    averageConfidence: number;
    durationMs: number;
  };
  scratchpadMarkdown: string;
}

// =============================================================================
// Single Family Review
// =============================================================================

/**
 * Review a single loop family representative.
 */
export async function reviewLoopFamily(input: LoopGateEntryInput): Promise<LoopGateEntryResult> {
  const questionId = String(input.entry.questionId || 'unknown');
  const startTime = Date.now();

  // Check for cancellation
  if (input.abortSignal?.aborted) {
    throw new DOMException('LoopGateAgent aborted', 'AbortError');
  }

  // Build system prompt
  const promptVersions = getPromptVersions();
  const systemInstructions = getLoopGatePrompt(promptVersions.loopGatePromptVersion);

  const surveyContext = sanitizeForAzureContentFilter(
    JSON.stringify(input.surveyParsed, null, 2),
  );

  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${systemInstructions}

<survey_context>
${surveyContext}
</survey_context>`;

  // Build user prompt
  const userPrompt = buildUserPrompt(input.entry, input.familyBase, input.siblingCount, input.surveyMetadata);

  // Create context-isolated scratchpad for this family
  const scratchpad = createContextScratchpadTool('LoopGateAgent', questionId);

  const genConfig = getGenerationConfig();

  try {
    const retryResult = await retryWithPolicyHandling(
      async () => {
        const { output, usage } = await generateText({
          model: getLoopGateModel(),
          system: systemPrompt,
          prompt: userPrompt,
          tools: { scratchpad },
          maxRetries: 0,
          stopWhen: stepCountIs(15),
          maxOutputTokens: Math.min(getLoopGateModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getLoopGateModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getLoopGateReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          output: Output.object({
            schema: LoopGateEntryResultSchema,
          }),
          abortSignal: input.abortSignal,
        });

        if (!output) {
          throw new Error('Invalid output from LoopGateAgent');
        }

        // Record metrics
        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'LoopGateAgent',
          getLoopGateModelName(),
          { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
          durationMs,
        );

        return output;
      },
      {
        abortSignal: input.abortSignal,
        maxAttempts: 10,
        onRetry: (attempt, err) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          console.warn(
            `[LoopGateAgent:${questionId}] Retry ${attempt}/10: ${err.message.substring(0, 120)}`,
          );
        },
      },
    );

    // Handle abort
    if (retryResult.error === 'Operation was cancelled') {
      throw new DOMException('LoopGateAgent aborted', 'AbortError');
    }

    if (!retryResult.success || !retryResult.result) {
      throw new Error(`LoopGateAgent failed for ${questionId}: ${retryResult.error || 'Unknown error'}`);
    }

    return retryResult.result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // Persist error and return safe fallback — ALWAYS confirm on failure
    // (never auto-clear loops on agent failure; a stacked table in QC is visible)
    try {
      await persistAgentErrorAuto({
        outputDir: input.outputDir,
        agentName: 'LoopGateAgent',
        severity: 'warning',
        actionTaken: 'continued',
        itemId: questionId,
        error,
        meta: { familyBase: input.familyBase, siblingCount: input.siblingCount },
      });
    } catch {
      // ignore persistence errors
    }

    console.warn(
      `[LoopGateAgent:${questionId}] Failed, confirming loop by default: ${error instanceof Error ? error.message.substring(0, 120) : 'Unknown error'}`,
    );

    return {
      questionId,
      reviewOutcome: 'confirmed',
      confidence: 0.5,
      mutations: [],
      reasoning: 'Loop gate agent failed; loop passed through confirmed by default.',
    };
  }
}

// =============================================================================
// Batch Review
// =============================================================================

/**
 * Review all loop family representatives in parallel with p-limit concurrency control.
 */
export async function reviewLoopFamilies(input: LoopGateBatchInput): Promise<LoopGateBatchResult> {
  const startTime = Date.now();
  const concurrency = input.concurrency ?? 3;

  console.log(
    `[LoopGateAgent] Reviewing ${input.loopFamilyRepresentatives.length} loop families (concurrency=${concurrency})`,
  );

  // Clean slate for scratchpads
  clearContextScratchpadsForAgent('LoopGateAgent');

  const limit = pLimit(concurrency);

  const results = await Promise.all(
    input.loopFamilyRepresentatives.map((rep) =>
      limit(async () => {
        // Check abort before starting
        if (input.abortSignal?.aborted) {
          return {
            questionId: rep.questionId,
            reviewOutcome: 'confirmed' as const,
            confidence: 0.5,
            mutations: [],
            reasoning: 'Aborted before review.',
          };
        }

        return reviewLoopFamily({
          entry: rep.entry,
          familyBase: rep.familyBase,
          siblingCount: rep.siblingCount,
          surveyParsed: input.surveyParsed,
          surveyMetadata: input.surveyMetadata,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
        });
      }),
    ),
  );

  // Collect scratchpad entries
  const contextEntries = getAllContextScratchpadEntries('LoopGateAgent');
  const allScratchpadEntries = contextEntries.flatMap((ctx) =>
    ctx.entries.map((e) => ({ ...e, contextId: ctx.contextId })),
  );
  const scratchpadMarkdown = formatScratchpadAsMarkdown('LoopGateAgent', allScratchpadEntries);
  clearContextScratchpadsForAgent('LoopGateAgent');

  // Compute summary
  const confirmed = results.filter((r) => r.reviewOutcome === 'confirmed').length;
  const cleared = results.filter((r) => r.reviewOutcome === 'cleared').length;
  const flaggedForHuman = results.filter((r) => r.reviewOutcome === 'flagged_for_human').length;
  const averageConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  const durationMs = Date.now() - startTime;

  console.log(
    `[LoopGateAgent] Done: ${confirmed} confirmed, ${cleared} cleared, ${flaggedForHuman} flagged ` +
      `(avg conf=${averageConfidence.toFixed(2)}, ${durationMs}ms)`,
  );

  return {
    results,
    summary: {
      total: results.length,
      confirmed,
      cleared,
      flaggedForHuman,
      averageConfidence,
      durationMs,
    },
    scratchpadMarkdown,
  };
}

// =============================================================================
// Prompt Assembly
// =============================================================================

function buildUserPrompt(
  entry: Record<string, unknown>,
  familyBase: string,
  siblingCount: number,
  surveyMetadata: SurveyMetadata | null,
): string {
  const sections: string[] = [];

  sections.push('<loop_family>');
  sections.push(sanitizeForAzureContentFilter(JSON.stringify(entry, null, 2)));
  sections.push('</loop_family>');
  sections.push('');

  sections.push('<family_context>');
  sections.push(JSON.stringify({ familyBase, siblingCount }, null, 2));
  sections.push('</family_context>');
  sections.push('');

  if (surveyMetadata) {
    sections.push('<survey_metadata>');
    sections.push(
      JSON.stringify(
        {
          dataset: surveyMetadata.dataset,
          isMessageTestingSurvey: surveyMetadata.isMessageTestingSurvey,
          hasMaxDiff: surveyMetadata.hasMaxDiff,
          hasAnchoredScores: surveyMetadata.hasAnchoredScores,
        },
        null,
        2,
      ),
    );
    sections.push('</survey_metadata>');
    sections.push('');
  }

  sections.push(
    'Review this loop family representative. Determine whether the detected loop is genuine ' +
    'respondent-level iteration or a false positive. Your decision propagates to all siblings in the family. ' +
    'Output your review result.',
  );

  return sections.join('\n');
}
