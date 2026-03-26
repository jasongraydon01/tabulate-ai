/**
 * AIGateAgent
 *
 * Purpose: Review triaged questionid entries one at a time with full survey context.
 * Proposes targeted mutations to structural classifications before table generation.
 *
 * Inputs: Triaged entry, survey-parsed.json, survey metadata
 * Output: AIGateEntryResult (confirmed, corrected, or flagged_for_human)
 *
 * Runs once per flagged entry, parallelized with p-limit(3) in batch mode.
 */

import { generateText, Output, stepCountIs } from 'ai';
import pLimit from 'p-limit';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  AIGateEntryResultSchema,
  type AIGateEntryResult,
} from '../schemas/aiGateSchema';
import {
  getAIGateModel,
  getAIGateModelName,
  getAIGateModelTokenLimit,
  getAIGateReasoningEffort,
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
import { getAIGatePrompt } from '../prompts';
import { retryWithPolicyHandling } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability/AgentMetrics';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';

// =============================================================================
// Types
// =============================================================================

interface TriageReason {
  rule: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
}

interface SurveyMetadata {
  dataset: string;
  isMessageTestingSurvey: boolean;
  hasMaxDiff: boolean | null;
  hasAnchoredScores: boolean | null;
  isDemandSurvey: boolean;
  hasChoiceModelExercise: boolean | null;
  [key: string]: unknown;
}

export interface AIGateEntryInput {
  /** The full triaged entry (questionid enriched object) */
  entry: Record<string, unknown>;
  /** Triage reasons from step 10 */
  triageReasons: TriageReason[];
  /** Full parsed survey questions */
  surveyParsed: unknown[];
  /** Survey-level metadata */
  surveyMetadata: SurveyMetadata | null;
  /** Output directory for error persistence */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface AIGateBatchInput {
  /** All flagged entries with their triage reasons */
  flaggedEntries: Array<{
    entry: Record<string, unknown>;
    triageReasons: TriageReason[];
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

export interface AIGateBatchResult {
  results: AIGateEntryResult[];
  summary: {
    total: number;
    confirmed: number;
    corrected: number;
    flaggedForHuman: number;
    averageConfidence: number;
    totalMutations: number;
    durationMs: number;
  };
  scratchpadMarkdown: string;
}

// =============================================================================
// Single Entry Review
// =============================================================================

/**
 * Review a single triaged entry with full survey context.
 */
export async function reviewEntry(input: AIGateEntryInput): Promise<AIGateEntryResult> {
  const questionId = String(input.entry.questionId || 'unknown');
  const startTime = Date.now();

  // Check for cancellation
  if (input.abortSignal?.aborted) {
    throw new DOMException('AIGateAgent aborted', 'AbortError');
  }

  // Build system prompt
  const promptVersions = getPromptVersions();
  const systemInstructions = getAIGatePrompt(promptVersions.aiGatePromptVersion);

  const surveyContext = sanitizeForAzureContentFilter(
    JSON.stringify(input.surveyParsed, null, 2),
  );

  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${systemInstructions}

<survey_context>
${surveyContext}
</survey_context>`;

  // Build user prompt
  const userPrompt = buildUserPrompt(input.entry, input.triageReasons, input.surveyMetadata);

  // Create context-isolated scratchpad for this entry
  const scratchpad = createContextScratchpadTool('AIGateAgent', questionId);

  const genConfig = getGenerationConfig();

  try {
    const retryResult = await retryWithPolicyHandling(
      async () => {
        const { output, usage } = await generateText({
          model: getAIGateModel(),
          system: systemPrompt,
          prompt: userPrompt,
          tools: { scratchpad },
          maxRetries: 0,
          stopWhen: stepCountIs(15),
          maxOutputTokens: Math.min(getAIGateModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getAIGateModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getAIGateReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          output: Output.object({
            schema: AIGateEntryResultSchema,
          }),
          abortSignal: input.abortSignal,
        });

        if (!output) {
          throw new Error('Invalid output from AIGateAgent');
        }

        // Record metrics
        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'AIGateAgent',
          getAIGateModelName(),
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
            `[AIGateAgent:${questionId}] Retry ${attempt}/10: ${err.message.substring(0, 120)}`,
          );
        },
      },
    );

    // Handle abort
    if (retryResult.error === 'Operation was cancelled') {
      throw new DOMException('AIGateAgent aborted', 'AbortError');
    }

    if (!retryResult.success || !retryResult.result) {
      throw new Error(`AIGateAgent failed for ${questionId}: ${retryResult.error || 'Unknown error'}`);
    }

    return retryResult.result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // Persist error and return safe fallback
    try {
      await persistAgentErrorAuto({
        outputDir: input.outputDir,
        agentName: 'AIGateAgent',
        severity: 'warning',
        actionTaken: 'continued',
        itemId: questionId,
        error,
        meta: { triageReasons: input.triageReasons.map(r => r.rule) },
      });
    } catch {
      // ignore persistence errors
    }

    console.warn(
      `[AIGateAgent:${questionId}] Failed, passing through unchanged: ${error instanceof Error ? error.message.substring(0, 120) : 'Unknown error'}`,
    );

    return {
      questionId,
      reviewOutcome: 'confirmed',
      confidence: 0.5,
      mutations: [],
      reasoning: 'AI review failed; entry passed through unchanged.',
    };
  }
}

// =============================================================================
// Batch Review
// =============================================================================

/**
 * Review all flagged entries in parallel with p-limit concurrency control.
 */
export async function reviewFlaggedEntries(input: AIGateBatchInput): Promise<AIGateBatchResult> {
  const startTime = Date.now();
  const concurrency = input.concurrency ?? 3;

  console.log(
    `[AIGateAgent] Reviewing ${input.flaggedEntries.length} flagged entries (concurrency=${concurrency})`,
  );

  // Clean slate for scratchpads
  clearContextScratchpadsForAgent('AIGateAgent');

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

        return reviewEntry({
          entry: flagged.entry,
          triageReasons: flagged.triageReasons,
          surveyParsed: input.surveyParsed,
          surveyMetadata: input.surveyMetadata,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
        });
      }),
    ),
  );

  // Collect scratchpad entries
  const contextEntries = getAllContextScratchpadEntries('AIGateAgent');
  const allScratchpadEntries = contextEntries.flatMap((ctx) =>
    ctx.entries.map((e) => ({ ...e, contextId: ctx.contextId })),
  );
  const scratchpadMarkdown = formatScratchpadAsMarkdown('AIGateAgent', allScratchpadEntries);
  clearContextScratchpadsForAgent('AIGateAgent');

  // Compute summary
  const confirmed = results.filter((r) => r.reviewOutcome === 'confirmed').length;
  const corrected = results.filter((r) => r.reviewOutcome === 'corrected').length;
  const flaggedForHuman = results.filter((r) => r.reviewOutcome === 'flagged_for_human').length;
  const totalMutations = results.reduce((sum, r) => sum + r.mutations.length, 0);
  const averageConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  const durationMs = Date.now() - startTime;

  console.log(
    `[AIGateAgent] Done: ${confirmed} confirmed, ${corrected} corrected, ${flaggedForHuman} flagged ` +
      `(${totalMutations} mutations, avg conf=${averageConfidence.toFixed(2)}, ${durationMs}ms)`,
  );

  return {
    results,
    summary: {
      total: results.length,
      confirmed,
      corrected,
      flaggedForHuman,
      averageConfidence,
      totalMutations,
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
  surveyMetadata: SurveyMetadata | null,
): string {
  const sections: string[] = [];

  sections.push('<entry>');
  sections.push(sanitizeForAzureContentFilter(JSON.stringify(entry, null, 2)));
  sections.push('</entry>');
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
        },
        null,
        2,
      ),
    );
    sections.push('</survey_metadata>');
    sections.push('');
  }

  sections.push('Review this entry. Address each triage reason. Output your review result.');

  return sections.join('\n');
}
