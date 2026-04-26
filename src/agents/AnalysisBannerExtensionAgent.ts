import { generateText, Output, stepCountIs } from 'ai';
import { z } from 'zod';

import {
  getBannerGenerateModel,
  getBannerGenerateModelName,
  getBannerGenerateModelTokenLimit,
  getBannerGenerateReasoningEffort,
  getGenerationConfig,
  getGenerationSamplingParams,
} from '@/lib/env';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '@/lib/promptSanitization';
import { retryWithPolicyHandling } from '@/lib/retryWithPolicyHandling';
import { recordAgentMetrics } from '@/lib/observability';
import type { BannerGroupType } from '@/schemas/bannerPlanSchema';
import type { QuestionContext } from '@/schemas/questionContextSchema';

const AnalysisBannerExtensionOutputSchema = z.object({
  groupName: z.string(),
  columns: z.array(z.object({
    name: z.string(),
    original: z.string(),
  })).min(1).max(20),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  needsClarification: z.boolean(),
  clarifyingQuestion: z.string(),
});

type AnalysisBannerExtensionOutput = z.infer<typeof AnalysisBannerExtensionOutputSchema>;

function buildQuestionExcerpt(questions: QuestionContext[]) {
  return questions.map((question) => ({
    questionId: question.questionId,
    questionText: question.questionText,
    normalizedType: question.normalizedType,
    analyticalSubtype: question.analyticalSubtype,
    items: question.items.map((item) => ({
      column: item.column,
      label: item.label,
      valueLabels: item.valueLabels,
    })),
  }));
}

function buildPrompt(params: {
  requestText: string;
  questions: QuestionContext[];
  existingGroupNames: string[];
  projectContext?: {
    projectName?: string | null;
    researchObjectives?: string | null;
    bannerHints?: string | null;
  };
}): string {
  const questionExcerpt = sanitizeForAzureContentFilter(
    JSON.stringify(buildQuestionExcerpt(params.questions), null, 2),
  );
  const existingGroups = sanitizeForAzureContentFilter(params.existingGroupNames.join(', '));
  const projectContext = sanitizeForAzureContentFilter(JSON.stringify(params.projectContext ?? {}, null, 2));
  const requestText = sanitizeForAzureContentFilter(params.requestText);

  return `${RESEARCH_DATA_PREAMBLE}
You draft exactly one appended banner group for TabulateAI analysis compute preflight.

Rules:
- Return one new banner group only.
- Do not edit or rename existing groups.
- Do not include existing groups in the output.
- Each column must include a short display name and an original filter expression.
- The original expression may use plain survey expression language, but it must be specific enough for crosstab validation.
- Prefer variables and values that are explicitly present in the question context.
- If the user request is too ambiguous, set needsClarification=true and provide a concise clarifyingQuestion.
- Use an empty string for clarifyingQuestion when no clarification is needed.

<project_context>
${projectContext}
</project_context>

<existing_banner_groups>
${existingGroups || 'None'}
</existing_banner_groups>

<user_request>
${requestText}
</user_request>

<question_context>
${questionExcerpt}
</question_context>`;
}

export async function draftAnalysisBannerExtensionGroup(params: {
  requestText: string;
  questions: QuestionContext[];
  existingGroupNames: string[];
  projectContext?: {
    projectName?: string | null;
    researchObjectives?: string | null;
    bannerHints?: string | null;
  };
  abortSignal?: AbortSignal;
}): Promise<{
  group: BannerGroupType;
  confidence: number;
  reasoning: string;
  needsClarification: boolean;
  clarifyingQuestion: string;
}> {
  const genConfig = getGenerationConfig();
  const start = Date.now();
  const retryResult = await retryWithPolicyHandling(
    async () => {
      const { output, usage } = await generateText({
        model: getBannerGenerateModel(),
        system: buildPrompt(params),
        prompt: 'Draft the single appended banner group now.',
        maxRetries: 0,
        stopWhen: stepCountIs(15),
        maxOutputTokens: Math.min(getBannerGenerateModelTokenLimit(), 100000),
        ...getGenerationSamplingParams(getBannerGenerateModelName()),
        providerOptions: {
          openai: {
            reasoningEffort: getBannerGenerateReasoningEffort(),
            parallelToolCalls: genConfig.parallelToolCalls,
          },
        },
        output: Output.object({ schema: AnalysisBannerExtensionOutputSchema }),
        abortSignal: params.abortSignal,
      });

      if (!output) {
        throw new Error('Analysis banner extension agent produced empty output.');
      }

      recordAgentMetrics(
        'AnalysisBannerExtensionAgent',
        getBannerGenerateModelName(),
        { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
        Date.now() - start,
      );

      return output;
    },
    {
      abortSignal: params.abortSignal,
      maxAttempts: 3,
    },
  );

  if (retryResult.error === 'Operation was cancelled') {
    throw new DOMException('AnalysisBannerExtensionAgent aborted', 'AbortError');
  }
  if (!retryResult.success || !retryResult.result) {
    throw new Error(`Analysis banner extension preflight failed: ${retryResult.error ?? 'Unknown error'}`);
  }

  const result: AnalysisBannerExtensionOutput = retryResult.result;
  return {
    group: {
      groupName: result.groupName,
      columns: result.columns.map((column) => ({
        name: column.name,
        original: column.original,
      })),
    },
    confidence: result.confidence,
    reasoning: result.reasoning,
    needsClarification: result.needsClarification,
    clarifyingQuestion: result.clarifyingQuestion,
  };
}
