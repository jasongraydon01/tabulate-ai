/**
 * SubtypeGateAgent
 *
 * Purpose: Review the analytical subtype of questions flagged during
 * enrichment triage. One decision per question: is the subtype correct
 * given the table plan and survey context?
 *
 * Inputs: Enrichment entry, table plan block, triage reasons, survey metadata
 * Output: SubtypeGateEntryResult (confirmed, corrected, or flagged_for_human)
 *
 * Runs once per flagged question, parallelized with p-limit(3) in batch mode.
 * Error fallback: 'confirmed' at confidence 0.5 (never change subtype on failure).
 */

import { generateText, Output, stepCountIs } from 'ai';
import pLimit from 'p-limit';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  SubtypeGateEntryResultSchema,
  type SubtypeGateEntryResult,
} from '../schemas/subtypeGateSchema';
import {
  getSubtypeGateModel,
  getSubtypeGateModelName,
  getSubtypeGateModelTokenLimit,
  getSubtypeGateReasoningEffort,
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
import { getSubtypeGatePrompt } from '../prompts';
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

interface TriageReason {
  rule: string;
  detail: string;
  severity: string;
}

export interface SubtypeGateEntryInput {
  /** The enrichment entry for this question */
  entry: Record<string, unknown>;
  /** Triage reasons that flagged this question */
  triageReasons: TriageReason[];
  /** The table plan block for this question (from 13b) */
  tablePlanBlock: Record<string, unknown>[];
  /** Survey-level metadata */
  surveyMetadata: SurveyMetadata | null;
  /** Output directory for error persistence */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface SubtypeGateBatchInput {
  /** One entry per flagged question */
  flaggedEntries: Array<{
    entry: Record<string, unknown>;
    triageReasons: TriageReason[];
    tablePlanBlock: Record<string, unknown>[];
    questionId: string;
  }>;
  /** Survey-level metadata */
  surveyMetadata: SurveyMetadata | null;
  /** Output directory for artifacts and errors */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Concurrency limit (default: 3) */
  concurrency?: number;
}

export interface SubtypeGateBatchResult {
  results: SubtypeGateEntryResult[];
  summary: {
    total: number;
    confirmed: number;
    corrected: number;
    flaggedForHuman: number;
    averageConfidence: number;
    durationMs: number;
  };
  scratchpadMarkdown: string;
}

// =============================================================================
// Single Entry Review
// =============================================================================

/**
 * Review a single question's analytical subtype.
 */
export async function reviewSubtypeClassification(input: SubtypeGateEntryInput): Promise<SubtypeGateEntryResult> {
  const questionId = String(input.entry.questionId || 'unknown');
  const startTime = Date.now();
  let failureMeta: Record<string, unknown> = {};

  // Check for cancellation
  if (input.abortSignal?.aborted) {
    throw new DOMException('SubtypeGateAgent aborted', 'AbortError');
  }

  // Build system prompt
  const promptVersions = getPromptVersions();
  const systemInstructions = getSubtypeGatePrompt(promptVersions.subtypeGatePromptVersion);

  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${systemInstructions}`;

  // Build user prompt
  const userPrompt = buildUserPrompt(input.entry, input.triageReasons, input.tablePlanBlock, input.surveyMetadata);

  // Create context-isolated scratchpad for this question
  const scratchpad = createContextScratchpadTool('SubtypeGateAgent', questionId);

  const genConfig = getGenerationConfig();

  try {
    const retryResult = await retryWithPolicyHandling(
      async () => {
        const { output, usage } = await generateText({
          model: getSubtypeGateModel(),
          system: systemPrompt,
          prompt: userPrompt,
          tools: { scratchpad },
          maxRetries: 0,
          stopWhen: stepCountIs(15),
          maxOutputTokens: Math.min(getSubtypeGateModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getSubtypeGateModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getSubtypeGateReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          output: Output.object({
            schema: SubtypeGateEntryResultSchema,
          }),
          abortSignal: input.abortSignal,
        });

        if (!output) {
          throw new Error('Invalid output from SubtypeGateAgent');
        }

        // Record metrics
        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'SubtypeGateAgent',
          getSubtypeGateModelName(),
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
            `[SubtypeGateAgent:${questionId}] Retry ${attempt}/10: ${err.message.substring(0, 120)}`,
          );
        },
      },
    );

    // Handle abort
    if (retryResult.error === 'Operation was cancelled') {
      throw new DOMException('SubtypeGateAgent aborted', 'AbortError');
    }

    if (!retryResult.success || !retryResult.result) {
      failureMeta = {
        attempts: retryResult.attempts,
        finalClassification: retryResult.finalClassification ?? 'unknown',
        wasPolicyError: retryResult.wasPolicyError,
      };
      throw new Error(`SubtypeGateAgent failed for ${questionId}: ${retryResult.error || 'Unknown error'}`);
    }

    return retryResult.result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // Persist error and return safe fallback — ALWAYS confirm on failure
    // (never change subtype on agent failure; wrong tables in QC are visible)
    try {
      await persistAgentErrorAuto({
        outputDir: input.outputDir,
        agentName: 'SubtypeGateAgent',
        severity: 'warning',
        actionTaken: 'continued',
        itemId: questionId,
        error,
        meta: {
          currentSubtype: String(input.entry.analyticalSubtype || 'unknown'),
          ...failureMeta,
        },
      });
    } catch {
      // ignore persistence errors
    }

    console.warn(
      `[SubtypeGateAgent:${questionId}] Failed, confirming subtype by default: ${error instanceof Error ? error.message.substring(0, 120) : 'Unknown error'}`,
    );

    return {
      questionId,
      reviewOutcome: 'confirmed',
      confidence: 0.5,
      mutations: [],
      reasoning: 'Subtype gate agent failed; subtype passed through confirmed by default.',
    };
  }
}

// =============================================================================
// Batch Review
// =============================================================================

/**
 * Review all flagged questions in parallel with p-limit concurrency control.
 */
export async function reviewSubtypeClassifications(input: SubtypeGateBatchInput): Promise<SubtypeGateBatchResult> {
  const startTime = Date.now();
  const concurrency = input.concurrency ?? 3;

  console.log(
    `[SubtypeGateAgent] Reviewing ${input.flaggedEntries.length} flagged questions (concurrency=${concurrency})`,
  );

  // Clean slate for scratchpads
  clearContextScratchpadsForAgent('SubtypeGateAgent');

  const limit = pLimit(concurrency);

  const results = await Promise.all(
    input.flaggedEntries.map((flagged) =>
      limit(async () => {
        // Check abort before starting
        if (input.abortSignal?.aborted) {
          return {
            questionId: flagged.questionId,
            reviewOutcome: 'confirmed' as const,
            confidence: 0.5,
            mutations: [],
            reasoning: 'Aborted before review.',
          };
        }

        return reviewSubtypeClassification({
          entry: flagged.entry,
          triageReasons: flagged.triageReasons,
          tablePlanBlock: flagged.tablePlanBlock,
          surveyMetadata: input.surveyMetadata,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
        });
      }),
    ),
  );

  // Collect scratchpad entries — filter to this agent to avoid contamination
  // from agents running in parallel (planning chain)
  const contextEntries = getAllContextScratchpadEntries('SubtypeGateAgent');
  const allScratchpadEntries = contextEntries.flatMap((ctx) =>
    ctx.entries.map((e) => ({ ...e, contextId: ctx.contextId })),
  );
  const scratchpadMarkdown = formatScratchpadAsMarkdown('SubtypeGateAgent', allScratchpadEntries);
  clearContextScratchpadsForAgent('SubtypeGateAgent');

  // Compute summary
  const confirmed = results.filter((r) => r.reviewOutcome === 'confirmed').length;
  const corrected = results.filter((r) => r.reviewOutcome === 'corrected').length;
  const flaggedForHuman = results.filter((r) => r.reviewOutcome === 'flagged_for_human').length;
  const averageConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  const durationMs = Date.now() - startTime;

  console.log(
    `[SubtypeGateAgent] Done: ${confirmed} confirmed, ${corrected} corrected, ${flaggedForHuman} flagged ` +
      `(avg conf=${averageConfidence.toFixed(2)}, ${durationMs}ms)`,
  );

  return {
    results,
    summary: {
      total: results.length,
      confirmed,
      corrected,
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
  triageReasons: TriageReason[],
  tablePlanBlock: Record<string, unknown>[],
  surveyMetadata: SurveyMetadata | null,
): string {
  const sections: string[] = [];

  sections.push('<entry>');
  sections.push(sanitizeForAzureContentFilter(JSON.stringify(entry, null, 2)));
  sections.push('</entry>');
  sections.push('');

  sections.push('<table_plan_block>');
  sections.push(sanitizeForAzureContentFilter(JSON.stringify(tablePlanBlock, null, 2)));
  sections.push('</table_plan_block>');
  sections.push('');

  sections.push('<triage_reasons>');
  sections.push(JSON.stringify(triageReasons, null, 2));
  sections.push('</triage_reasons>');
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
          isDemandSurvey: surveyMetadata.isDemandSurvey,
        },
        null,
        2,
      ),
    );
    sections.push('</survey_metadata>');
    sections.push('');
  }

  sections.push(
    'Review this question\'s analytical subtype classification. Determine whether the subtype is correct ' +
    'for the tables being planned. If incorrect, provide the correct subtype via mutation. ' +
    'Output your review result.',
  );

  return sections.join('\n');
}
