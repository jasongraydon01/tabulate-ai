/**
 * StructureGateAgent
 *
 * Purpose: Review the structural interpretation of questions in the table plan.
 * Evaluates grid decompositions, scale classification modes, and base policies.
 * Runs AFTER the subtype gate (13c₁) with the subtype already locked in.
 *
 * Inputs: Enrichment entry, table plan block, question diagnostic, triage signals, survey metadata
 * Output: StructureGateEntryResult (confirmed, corrected, or flagged_for_human)
 *
 * Runs once per flagged question, parallelized with p-limit(3) in batch mode.
 * Error fallback: 'confirmed' at confidence 0.5 (never change structure on failure).
 */

import { generateText, Output, stepCountIs } from 'ai';
import pLimit from 'p-limit';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  StructureGateEntryResultSchema,
  type StructureGateEntryResult,
  validateStructureGateCorrection,
} from '../schemas/structureGateSchema';
import {
  getStructureGateModel,
  getStructureGateModelName,
  getStructureGateModelTokenLimit,
  getStructureGateReasoningEffort,
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
import { getStructureGatePrompt } from '../prompts';
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

export interface StructureGateTriageSignal {
  signal: string;
  detail: string;
  evidence: Record<string, unknown>;
}

export interface StructureGateEntryInput {
  /** The enrichment entry for this question */
  entry: Record<string, unknown>;
  /** Triage signals computed deterministically for this question */
  triageSignals: StructureGateTriageSignal[];
  /** The table plan block for this question (from 13b/13c₁) */
  tablePlanBlock: Record<string, unknown>[];
  /** Question diagnostic from 13b */
  questionDiagnostic: Record<string, unknown> | null;
  /** Parsed survey question for this entry (from 08a), if available */
  surveyQuestion: Record<string, unknown> | null;
  /** Survey-level metadata */
  surveyMetadata: SurveyMetadata | null;
  /** Output directory for error persistence */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

export interface StructureGateBatchInput {
  /** One entry per flagged question */
  flaggedEntries: Array<{
    entry: Record<string, unknown>;
    triageSignals: StructureGateTriageSignal[];
    tablePlanBlock: Record<string, unknown>[];
    questionDiagnostic: Record<string, unknown> | null;
    surveyQuestion: Record<string, unknown> | null;
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

export interface StructureGateBatchResult {
  results: StructureGateEntryResult[];
  summary: {
    total: number;
    confirmed: number;
    corrected: number;
    flaggedForHuman: number;
    totalCorrections: number;
    averageConfidence: number;
    durationMs: number;
  };
  scratchpadMarkdown: string;
}

// =============================================================================
// Single Entry Review
// =============================================================================

/**
 * Review a single question's structural interpretation.
 */
export async function reviewStructureInterpretation(input: StructureGateEntryInput): Promise<StructureGateEntryResult> {
  const questionId = String(input.entry.questionId || 'unknown');
  const startTime = Date.now();

  // Check for cancellation
  if (input.abortSignal?.aborted) {
    throw new DOMException('StructureGateAgent aborted', 'AbortError');
  }

  // Build system prompt
  const promptVersions = getPromptVersions();
  const systemInstructions = getStructureGatePrompt(promptVersions.structureGatePromptVersion);

  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${systemInstructions}`;

  // Build user prompt
  const userPrompt = buildUserPrompt(
    input.entry,
    input.triageSignals,
    input.tablePlanBlock,
    input.questionDiagnostic,
    input.surveyQuestion,
    input.surveyMetadata,
  );

  // Create context-isolated scratchpad for this question
  const scratchpad = createContextScratchpadTool('StructureGateAgent', questionId);

  const genConfig = getGenerationConfig();

  try {
    const retryResult = await retryWithPolicyHandling(
      async () => {
        const { output, usage } = await generateText({
          model: getStructureGateModel(),
          system: systemPrompt,
          prompt: userPrompt,
          tools: { scratchpad },
          maxRetries: 0,
          stopWhen: stepCountIs(15),
          maxOutputTokens: Math.min(getStructureGateModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getStructureGateModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getStructureGateReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          output: Output.object({
            schema: StructureGateEntryResultSchema,
          }),
          abortSignal: input.abortSignal,
        });

        if (!output) {
          throw new Error('Invalid output from StructureGateAgent');
        }

        // Record metrics
        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'StructureGateAgent',
          getStructureGateModelName(),
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
            `[StructureGateAgent:${questionId}] Retry ${attempt}/10: ${err.message.substring(0, 120)}`,
          );
        },
      },
    );

    // Handle abort
    if (retryResult.error === 'Operation was cancelled') {
      throw new DOMException('StructureGateAgent aborted', 'AbortError');
    }

    if (!retryResult.success || !retryResult.result) {
      throw new Error(`StructureGateAgent failed for ${questionId}: ${retryResult.error || 'Unknown error'}`);
    }

    // Post-AI validation: check each correction's newValue
    const result = retryResult.result;
    if (result.corrections.length > 0) {
      const validCorrections = [];
      for (const correction of result.corrections) {
        const validation = validateStructureGateCorrection(correction);
        if (validation.valid) {
          validCorrections.push(correction);
        } else {
          console.warn(
            `[StructureGateAgent:${questionId}] Dropped invalid correction: ${validation.reason}`,
          );
        }
      }
      result.corrections = validCorrections;

      // If all corrections were dropped, downgrade to confirmed
      if (result.corrections.length === 0 && result.reviewOutcome === 'corrected') {
        result.reviewOutcome = 'confirmed';
        result.reasoning += ' [All corrections were invalid and dropped; downgraded to confirmed.]';
      }
    }

    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // Persist error and return safe fallback — ALWAYS confirm on failure
    try {
      await persistAgentErrorAuto({
        outputDir: input.outputDir,
        agentName: 'StructureGateAgent',
        severity: 'warning',
        actionTaken: 'continued',
        itemId: questionId,
        error,
        meta: { currentSubtype: String(input.entry.analyticalSubtype || 'unknown') },
      });
    } catch {
      // ignore persistence errors
    }

    console.warn(
      `[StructureGateAgent:${questionId}] Failed, confirming structure by default: ${error instanceof Error ? error.message.substring(0, 120) : 'Unknown error'}`,
    );

    return {
      questionId,
      reviewOutcome: 'confirmed',
      confidence: 0.5,
      corrections: [],
      reasoning: 'Structure gate agent failed; structure passed through confirmed by default.',
    };
  }
}

// =============================================================================
// Batch Review
// =============================================================================

/**
 * Review all flagged questions in parallel with p-limit concurrency control.
 */
export async function reviewStructureInterpretations(input: StructureGateBatchInput): Promise<StructureGateBatchResult> {
  const startTime = Date.now();
  const concurrency = input.concurrency ?? 3;

  console.log(
    `[StructureGateAgent] Reviewing ${input.flaggedEntries.length} flagged questions (concurrency=${concurrency})`,
  );

  // Clean slate for scratchpads
  clearContextScratchpadsForAgent('StructureGateAgent');

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
            corrections: [],
            reasoning: 'Aborted before review.',
          };
        }

        return reviewStructureInterpretation({
          entry: flagged.entry,
          triageSignals: flagged.triageSignals,
          tablePlanBlock: flagged.tablePlanBlock,
          questionDiagnostic: flagged.questionDiagnostic,
          surveyQuestion: flagged.surveyQuestion,
          surveyMetadata: input.surveyMetadata,
          outputDir: input.outputDir,
          abortSignal: input.abortSignal,
        });
      }),
    ),
  );

  // Collect scratchpad entries — filter to this agent to avoid contamination
  // from agents running in parallel (planning chain)
  const contextEntries = getAllContextScratchpadEntries('StructureGateAgent');
  const allScratchpadEntries = contextEntries.flatMap((ctx) =>
    ctx.entries.map((e) => ({ ...e, contextId: ctx.contextId })),
  );
  const scratchpadMarkdown = formatScratchpadAsMarkdown('StructureGateAgent', allScratchpadEntries);
  clearContextScratchpadsForAgent('StructureGateAgent');

  // Compute summary
  const confirmed = results.filter((r) => r.reviewOutcome === 'confirmed').length;
  const corrected = results.filter((r) => r.reviewOutcome === 'corrected').length;
  const flaggedForHuman = results.filter((r) => r.reviewOutcome === 'flagged_for_human').length;
  const totalCorrections = results.reduce((sum, r) => sum + r.corrections.length, 0);
  const averageConfidence =
    results.length > 0
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;

  const durationMs = Date.now() - startTime;

  console.log(
    `[StructureGateAgent] Done: ${confirmed} confirmed, ${corrected} corrected, ${flaggedForHuman} flagged ` +
      `(${totalCorrections} corrections, avg conf=${averageConfidence.toFixed(2)}, ${durationMs}ms)`,
  );

  return {
    results,
    summary: {
      total: results.length,
      confirmed,
      corrected,
      flaggedForHuman,
      totalCorrections,
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
  triageSignals: StructureGateTriageSignal[],
  tablePlanBlock: Record<string, unknown>[],
  questionDiagnostic: Record<string, unknown> | null,
  surveyQuestion: Record<string, unknown> | null,
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

  if (questionDiagnostic) {
    sections.push('<question_diagnostic>');
    sections.push(JSON.stringify(questionDiagnostic, null, 2));
    sections.push('</question_diagnostic>');
    sections.push('');
  }

  if (surveyQuestion) {
    sections.push('<survey_question>');
    sections.push(sanitizeForAzureContentFilter(JSON.stringify(surveyQuestion, null, 2)));
    sections.push('</survey_question>');
    sections.push('');
  }

  sections.push('<triage_signals>');
  sections.push(JSON.stringify(triageSignals, null, 2));
  sections.push('</triage_signals>');
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
    'Review this question\'s structural interpretation in the table plan. Determine whether ' +
    'grid decomposition, scale classification mode, and base policy are producing the right ' +
    'analytical output. If any structural decisions need correction, provide specific corrections. ' +
    'Output your review result.',
  );

  return sections.join('\n');
}
