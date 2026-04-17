import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from "ai";

import { getReasoningModel, getReasoningModelName } from "@/lib/env";
import { getSanitizedConversationMessagesForModel } from "@/lib/analysis/messages";
import { recordAgentMetrics } from "@/lib/observability";
import { retryWithPolicyHandling } from "@/lib/retryWithPolicyHandling";

const ANALYSIS_SYSTEM_PROMPT = [
  "You are TabulateAI's analysis assistant for survey and crosstab work.",
  "Be helpful, concise, and methodologically sound.",
  "In this version you do not yet have direct grounded access to the run's output artifacts or tab tables.",
  "Do not invent run-specific numbers, percentages, significance claims, or subgroup findings.",
  "If the user asks for dataset-specific findings, explain that direct run evidence is not connected yet and offer to help frame the question, interpretation approach, or next analytical step.",
  "You can still help with interpretation strategy, analysis planning, terminology, likely follow-up questions, and how to inspect or explain results once evidence is available.",
].join("\n");

export async function streamAnalysisResponse({
  messages,
  abortSignal,
}: {
  messages: UIMessage[];
  abortSignal?: AbortSignal;
}) {
  const startTime = Date.now();
  const sanitizedMessages = getSanitizedConversationMessagesForModel(messages);

  const retryResult = await retryWithPolicyHandling(
    async () =>
      streamText({
        model: getReasoningModel(),
        system: ANALYSIS_SYSTEM_PROMPT,
        messages: await convertToModelMessages(sanitizedMessages),
        stopWhen: stepCountIs(1),
        abortSignal,
        onFinish: ({ totalUsage }) => {
          recordAgentMetrics(
            "AnalysisAgent",
            getReasoningModelName(),
            {
              input: totalUsage.inputTokens ?? 0,
              output: totalUsage.outputTokens ?? 0,
            },
            Date.now() - startTime,
          );
        },
      }),
    {
      maxAttempts: 3,
      abortSignal,
    },
  );

  if (!retryResult.success || !retryResult.result) {
    throw new Error(retryResult.error ?? "Failed to stream analysis response");
  }

  return retryResult.result;
}
