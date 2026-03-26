/**
 * SurveyCleanupAgent
 *
 * Purpose: Clean up survey parse artifacts from step 08a output.
 * Takes a chunk of ParsedSurveyQuestion[] plus the full survey markdown
 * as source context, and returns a cleaned version.
 *
 * The orchestrator chunks the output set (which questions to clean) but
 * every call receives the full survey document for context. This lets the
 * model recover section headers, verify question text, and resolve
 * structural ambiguity against the original source.
 *
 * Input: ParsedSurveyQuestion[] + surveyMarkdown + callIndex
 * Output: SurveyCleanupOutput (cleaned questions array)
 *
 * Error fallback: returns null — orchestrator treats nulls as failed calls.
 */

import { generateText, Output, stepCountIs } from 'ai';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../lib/promptSanitization';
import {
  SurveyCleanupOutputSchema,
  type SurveyCleanupOutput,
} from '../schemas/surveyCleanupSchema';
import {
  getSurveyCleanupModel,
  getSurveyCleanupModelName,
  getSurveyCleanupModelTokenLimit,
  getSurveyCleanupReasoningEffort,
  getPromptVersions,
  getGenerationConfig,
  getGenerationSamplingParams,
} from '../lib/env';
import {
  createContextScratchpadTool,
} from './tools/scratchpad';
import { getSurveyCleanupPrompt } from '../prompts';
import { retryWithPolicyHandling } from '../lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '../lib/observability/AgentMetrics';
import { persistAgentErrorAuto } from '../lib/errors/ErrorPersistence';

import type { ParsedSurveyQuestion } from '../lib/v3/runtime/questionId/types';

// =============================================================================
// Types
// =============================================================================

export interface SurveyCleanupCallInput {
  /** Chunk of parsed questions to clean */
  parsedQuestions: ParsedSurveyQuestion[];
  /** Full survey markdown for source context (null if no survey doc) */
  surveyMarkdown: string | null;
  /** Call index (0, 1, 2) for scratchpad isolation and logging */
  callIndex: number;
  /** Output directory for error persistence */
  outputDir: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
}

// =============================================================================
// Prompt Builder
// =============================================================================

/**
 * Build the user prompt from parsed questions and optional survey markdown.
 *
 * When survey markdown is available, it is presented first as read-only source
 * context. The target questions follow in a separate block. The model cleans
 * only the target questions but can reference the full document.
 *
 * Strips rawText from question serialization to save tokens (immutable, and
 * now redundant since the full document is provided).
 */
function buildUserPrompt(
  questions: ParsedSurveyQuestion[],
  surveyMarkdown: string | null,
): string {
  const stripped = questions.map((q) => ({
    questionId: q.questionId,
    questionText: q.questionText,
    instructionText: q.instructionText,
    answerOptions: q.answerOptions.map((o) => ({ code: o.code, text: o.text })),
    scaleLabels: q.scaleLabels,
    questionType: q.questionType,
    format: q.format,
    sectionHeader: q.sectionHeader,
  }));

  const parts: string[] = [];

  if (surveyMarkdown) {
    parts.push(
      `<source_survey_document>`,
      surveyMarkdown,
      `</source_survey_document>`,
      ``,
      `The above is the FULL original survey document (converted to markdown). Use it as read-only reference to understand context, section boundaries, routing, instructions, and question structure. Do NOT extract new questions from it — only use it to inform your cleanup of the target questions below.`,
      ``,
    );
  }

  parts.push(
    `<target_questions>`,
    JSON.stringify(stripped, null, 2),
    `</target_questions>`,
    ``,
    `Clean up these ${questions.length} survey questions following your instructions. Return ALL questions in the same order.`,
  );

  return parts.join('\n');
}

// =============================================================================
// Single Call
// =============================================================================

/**
 * Run a single survey cleanup AI call.
 * Returns null on failure (orchestrator handles fallback).
 */
export async function runSurveyCleanupCall(
  input: SurveyCleanupCallInput,
): Promise<SurveyCleanupOutput | null> {
  const { parsedQuestions, surveyMarkdown, callIndex, outputDir, abortSignal } = input;
  const identifier = `call-${callIndex}`;
  const startTime = Date.now();

  // Check for cancellation
  if (abortSignal?.aborted) {
    throw new DOMException('SurveyCleanupAgent aborted', 'AbortError');
  }

  // Token estimate warning (includes both survey markdown and target questions)
  const strippedJson = JSON.stringify(parsedQuestions.map((q) => ({
    questionId: q.questionId,
    questionText: q.questionText,
    instructionText: q.instructionText,
    answerOptions: q.answerOptions.map((o) => ({ code: o.code, text: o.text })),
    scaleLabels: q.scaleLabels,
    questionType: q.questionType,
    format: q.format,
    sectionHeader: q.sectionHeader,
  })));
  const markdownLength = surveyMarkdown?.length ?? 0;
  const estimatedTokens = (strippedJson.length + markdownLength) / 4;
  const tokenLimit = getSurveyCleanupModelTokenLimit();
  if (estimatedTokens > tokenLimit * 0.6) {
    console.warn(
      `[SurveyCleanup:${identifier}] Estimated input tokens (~${Math.round(estimatedTokens)}) ` +
        `exceed 60% of model limit (${tokenLimit}). ` +
        `Survey markdown: ~${Math.round(markdownLength / 4)} tokens, ` +
        `questions: ~${Math.round(strippedJson.length / 4)} tokens.`,
    );
  }

  // Build prompts
  const promptVersions = getPromptVersions();
  const systemInstructions = getSurveyCleanupPrompt(promptVersions.surveyCleanupPromptVersion);
  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}\n\n${systemInstructions}`;
  const userPrompt = sanitizeForAzureContentFilter(buildUserPrompt(parsedQuestions, surveyMarkdown));

  // Create context-isolated scratchpad
  const scratchpad = createContextScratchpadTool('SurveyCleanupAgent', identifier);
  const genConfig = getGenerationConfig();

  try {
    const retryResult = await retryWithPolicyHandling(
      async () => {
        const { output, usage } = await generateText({
          model: getSurveyCleanupModel(),
          system: systemPrompt,
          prompt: userPrompt,
          tools: { scratchpad },
          maxRetries: 0,
          stopWhen: stepCountIs(15),
          maxOutputTokens: Math.min(getSurveyCleanupModelTokenLimit(), 100000),
          ...getGenerationSamplingParams(getSurveyCleanupModelName()),
          providerOptions: {
            openai: {
              reasoningEffort: getSurveyCleanupReasoningEffort(),
              parallelToolCalls: genConfig.parallelToolCalls,
            },
          },
          output: Output.object({
            schema: SurveyCleanupOutputSchema,
          }),
          abortSignal,
        });

        if (!output) {
          throw new Error(`Invalid output from SurveyCleanupAgent (${identifier})`);
        }

        // Always record metrics
        const durationMs = Date.now() - startTime;
        recordAgentMetrics(
          'SurveyCleanupAgent',
          getSurveyCleanupModelName(),
          { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
          durationMs,
        );

        return output;
      },
      {
        abortSignal,
        maxAttempts: 10,
        onRetry: (attempt, err) => {
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw err;
          }
          console.warn(
            `[SurveyCleanup:${identifier}] Retry ${attempt}/10: ${err.message.substring(0, 120)}`,
          );
        },
      },
    );

    // Handle abort
    if (retryResult.error === 'Operation was cancelled') {
      throw new DOMException('SurveyCleanupAgent aborted', 'AbortError');
    }

    if (!retryResult.success || !retryResult.result) {
      console.warn(
        `[SurveyCleanup:${identifier}] Failed after retries: ${retryResult.error || 'Unknown error'}`,
      );
      return null;
    }

    return retryResult.result;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw error;
    }

    // Persist error
    try {
      await persistAgentErrorAuto({
        outputDir,
        agentName: 'SurveyCleanupAgent',
        severity: 'warning',
        actionTaken: 'continued',
        itemId: identifier,
        error,
        meta: { callIndex, questionCount: parsedQuestions.length },
      });
    } catch {
      // ignore persistence errors
    }

    console.warn(
      `[SurveyCleanup:${identifier}] Failed: ${error instanceof Error ? error.message.substring(0, 120) : 'Unknown error'}`,
    );

    return null;
  }
}
