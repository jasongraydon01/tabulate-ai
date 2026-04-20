import { Output, generateText, stepCountIs } from "ai";
import { z } from "zod";

import {
  getAnalysisTitleModel,
  getAnalysisTitleModelName,
  getAnalysisTitleProviderOptions,
} from "@/lib/analysis/model";
import { sanitizeAnalysisMessageContent } from "@/lib/analysis/messages";
import { recordAgentMetrics } from "@/lib/observability";
import { retryWithPolicyHandling } from "@/lib/retryWithPolicyHandling";

const GENERATED_ANALYSIS_TITLE_MAX_CHARS = 80;

const AnalysisGeneratedTitleSchema = z.object({
  title: z.string().min(1).max(GENERATED_ANALYSIS_TITLE_MAX_CHARS),
});

function trimTitleInput(value: string, maxChars = 2000): string {
  return sanitizeAnalysisMessageContent(value).slice(0, maxChars);
}

function normalizeGeneratedTitle(value: string): string {
  return value
    .replace(/[<>"]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.:;,\-–—\s]+$/g, "")
    .slice(0, GENERATED_ANALYSIS_TITLE_MAX_CHARS);
}

export function isDefaultAnalysisSessionTitle(title: string): boolean {
  return /^Analysis Session \d+$/.test(title.trim());
}

export async function generateAnalysisSessionTitle({
  userPrompt,
  assistantResponse,
  abortSignal,
}: {
  userPrompt: string;
  assistantResponse: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const startTime = Date.now();
  const normalizedUserPrompt = trimTitleInput(userPrompt);
  const normalizedAssistantResponse = trimTitleInput(assistantResponse);

  if (!normalizedUserPrompt || !normalizedAssistantResponse) {
    throw new Error("Both the user prompt and assistant response are required to generate an analysis title");
  }

  const retryResult = await retryWithPolicyHandling(
    async () => {
      const { output, usage } = await generateText({
        model: getAnalysisTitleModel(),
        system: [
          "Write one concise title for an analysis chat.",
          "Use both the user's question and the assistant's answer to infer the topic.",
          "Prefer a descriptive noun phrase, not a sentence.",
          "Keep it specific, clean, and concise: usually 3 to 8 words, maximum 80 characters.",
          "Do not use quotation marks, markdown, prefixes like Analysis of or Discussion about, or trailing punctuation.",
          "Return only the schema field.",
        ].join("\n"),
        prompt: [
          `<user-prompt>${normalizedUserPrompt}</user-prompt>`,
          `<assistant-response>${normalizedAssistantResponse}</assistant-response>`,
        ].join("\n"),
        maxRetries: 0,
        stopWhen: stepCountIs(4),
        ...(getAnalysisTitleProviderOptions()
          ? { providerOptions: getAnalysisTitleProviderOptions() }
          : {}),
        output: Output.object({
          schema: AnalysisGeneratedTitleSchema,
        }),
        abortSignal,
      });

      const title = normalizeGeneratedTitle(output.title);
      if (!title) {
        throw new Error("Generated analysis title was empty after normalization");
      }

      recordAgentMetrics(
        "AnalysisTitleAgent",
        getAnalysisTitleModelName(),
        {
          input: usage?.inputTokens || 0,
          output: usage?.outputTokens || 0,
        },
        Date.now() - startTime,
      );

      return title;
    },
    {
      abortSignal,
      maxAttempts: 2,
    },
  );

  if (!retryResult.success || !retryResult.result) {
    throw new Error(retryResult.error ?? "Failed to generate analysis title");
  }

  return retryResult.result;
}
