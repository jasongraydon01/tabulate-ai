import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import {
  getAnalysisUIMessageText,
  getSanitizedConversationMessagesForModel,
} from "@/lib/analysis/messages";
import {
  getAnalysisModel,
  getAnalysisModelName,
  getAnalysisProviderOptions,
} from "@/lib/analysis/model";
import {
  getQuestionContext,
  getTableCard,
  listBannerCuts,
  searchRunCatalog,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";
import { recordAgentMetrics } from "@/lib/observability";
import { retryWithPolicyHandling } from "@/lib/retryWithPolicyHandling";

function buildAnalysisSystemPrompt(context: AnalysisGroundingContext): string {
  const groundedHeader = context.availability === "unavailable"
    ? [
        "Grounded run artifacts are not available in this session.",
        "Do not invent run-specific numbers, percentages, subgroup findings, or banner availability.",
        "You can still help with methodology, interpretation approach, and next analytical steps.",
      ]
    : [
        "You have grounded access to this run's validated artifacts through tools.",
        "For run-specific claims, use the tools first and then answer from their outputs.",
        "When a renderable table would help, call getTableCard so the user sees the evidence inline.",
        "When the user asks a fuzzy question, use searchRunCatalog first to resolve the likely table, question, or banner cut.",
      ];

  const artifactStatus = context.missingArtifacts.length > 0
    ? `Artifact gaps: ${context.missingArtifacts.join(", ")}.`
    : "All Slice 2 grounding artifacts are available.";

  return [
    "You are TabulateAI's analysis assistant for survey and crosstab work.",
    "Be concise, methodologically sound, and practical.",
    ...groundedHeader,
    artifactStatus,
    "Do not mention internal implementation details unless the user asks.",
    "Prefer plain-language summaries, but keep technical terminology precise.",
  ].join("\n");
}

export async function streamAnalysisResponse({
  messages,
  groundingContext,
  abortSignal,
}: {
  messages: UIMessage[];
  groundingContext: AnalysisGroundingContext;
  abortSignal?: AbortSignal;
}) {
  const startTime = Date.now();
  const sanitizedMessages = getSanitizedConversationMessagesForModel(messages);

  const retryResult = await retryWithPolicyHandling(
    async () =>
      streamText({
        model: getAnalysisModel(),
        system: buildAnalysisSystemPrompt(groundingContext),
        messages: await convertToModelMessages(sanitizedMessages),
        stopWhen: stepCountIs(6),
        abortSignal,
        ...(getAnalysisProviderOptions() ? { providerOptions: getAnalysisProviderOptions() } : {}),
        tools: {
          searchRunCatalog: tool({
            description: "Search the current run's catalog of questions, tables, and banner cuts from grounded artifacts.",
            inputSchema: z.object({
              query: z.string().min(1).max(200),
            }),
            execute: async ({ query }) => searchRunCatalog(groundingContext, query),
          }),
          getTableCard: tool({
            description: "Load a renderable table card for a specific run table from grounded results.",
            inputSchema: z.object({
              tableId: z.string().min(1).max(200),
              rowFilter: z.string().min(1).max(200).nullable().optional(),
              cutFilter: z.string().min(1).max(200).nullable().optional(),
              valueMode: z.enum(["pct", "count", "n", "mean"]).optional(),
            }),
            execute: async ({ tableId, rowFilter, cutFilter, valueMode }) => getTableCard(groundingContext, {
              tableId,
              rowFilter,
              cutFilter,
              valueMode,
            }),
          }),
          getQuestionContext: tool({
            description: "Return grounded metadata for a specific question from questionid-final artifacts.",
            inputSchema: z.object({
              questionId: z.string().min(1).max(200),
            }),
            execute: async ({ questionId }) => getQuestionContext(groundingContext, questionId),
          }),
          listBannerCuts: tool({
            description: "List available banner groups and cuts for this run.",
            inputSchema: z.object({
              filter: z.string().min(1).max(200).nullable().optional(),
            }),
            execute: async ({ filter }) => listBannerCuts(groundingContext, filter),
          }),
        },
        onFinish: ({ totalUsage }) => {
          recordAgentMetrics(
            "AnalysisAgent",
            getAnalysisModelName(),
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
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const latestText = latestUserMessage ? getAnalysisUIMessageText(latestUserMessage) : "";
    throw new Error(retryResult.error ?? `Failed to stream analysis response for: ${latestText || "analysis request"}`);
  }

  return retryResult.result;
}
