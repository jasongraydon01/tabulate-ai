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
  getBannerPlanContext,
  getQuestionContext,
  getRunContext,
  getSurveyQuestion,
  getTableCard,
  listBannerCuts,
  searchRunCatalog,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";
import { createAnalysisScratchpadTool } from "@/lib/analysis/scratchpad";
import type { AnalysisTraceRetryEvent } from "@/lib/analysis/trace";
import { buildAnalysisInstructions } from "@/prompts/analysis";
import { calculateCostSync, recordAgentMetrics } from "@/lib/observability";
import { retryWithPolicyHandling } from "@/lib/retryWithPolicyHandling";

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
  const { tool: scratchpad, getEntries } = createAnalysisScratchpadTool();
  const retryEvents: AnalysisTraceRetryEvent[] = [];
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
  };

  const retryResult = await retryWithPolicyHandling(
    async () =>
      streamText({
        model: getAnalysisModel(),
        system: buildAnalysisInstructions({
          availability: groundingContext.availability,
          missingArtifacts: groundingContext.missingArtifacts,
          runContext: {
            projectName: groundingContext.projectContext.projectName,
            runStatus: groundingContext.projectContext.runStatus,
            tableCount: groundingContext.projectContext.tableCount,
            bannerGroupCount: groundingContext.projectContext.bannerGroupCount,
            totalCuts: groundingContext.projectContext.totalCuts,
            bannerGroupNames: groundingContext.projectContext.bannerGroupNames,
            bannerSource: groundingContext.projectContext.bannerSource,
            researchObjectives: groundingContext.projectContext.researchObjectives,
            bannerHints: groundingContext.projectContext.bannerHints,
            surveyAvailable: groundingContext.surveyQuestions.length > 0 || Boolean(groundingContext.surveyMarkdown),
            bannerPlanAvailable: groundingContext.bannerPlanGroups.length > 0,
          },
        }),
        messages: await convertToModelMessages(sanitizedMessages),
        stopWhen: stepCountIs(12),
        abortSignal,
        ...(getAnalysisProviderOptions() ? { providerOptions: getAnalysisProviderOptions() } : {}),
        tools: {
          scratchpad,
          searchRunCatalog: tool({
            description: "Search the current run's catalog of questions, tables, and banner cuts from grounded artifacts.",
            inputSchema: z.object({
              query: z.string().min(1).max(200),
            }),
            execute: async ({ query }) => searchRunCatalog(groundingContext, query),
          }),
          viewTable: tool({
            description: "Inspect a table's data without showing it to the user. Use this to check whether a table is the right one before rendering it. Returns the same data as getTableCard but does not render inline.",
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
          getTableCard: tool({
            description: "Render a table card inline for the user to see. Only call this when you have confirmed the table is the one the user needs.",
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
          getSurveyQuestion: tool({
            description: "Return grounded survey wording, answer options, question order, and nearby questionnaire context for a question or topic.",
            inputSchema: z.object({
              query: z.string().min(1).max(200),
            }),
            execute: async ({ query }) => getSurveyQuestion(groundingContext, query),
          }),
          listBannerCuts: tool({
            description: "List available banner groups and cuts for this run.",
            inputSchema: z.object({
              filter: z.string().min(1).max(200).nullable().optional(),
            }),
            execute: async ({ filter }) => listBannerCuts(groundingContext, filter),
          }),
          getBannerPlanContext: tool({
            description: "Return the grounded stage-20 banner plan, including original group structure and source context.",
            inputSchema: z.object({
              filter: z.string().min(1).max(200).nullable().optional(),
            }),
            execute: async ({ filter }) => getBannerPlanContext(groundingContext, filter),
          }),
          getRunContext: tool({
            description: "Return project-level and run-level analysis context, including project name, research objectives, banner summary, and high-level run stats.",
            inputSchema: z.object({}),
            execute: async () => getRunContext(groundingContext),
          }),
        },
        onFinish: ({ totalUsage }) => {
          usage = {
            inputTokens: totalUsage.inputTokens ?? 0,
            outputTokens: totalUsage.outputTokens ?? 0,
          };
          recordAgentMetrics(
            "AnalysisAgent",
            getAnalysisModelName(),
            {
              input: usage.inputTokens,
              output: usage.outputTokens,
            },
            Date.now() - startTime,
          );
        },
      }),
    {
      maxAttempts: 3,
      abortSignal,
      onRetryWithContext: (context, _error, nextDelayMs) => {
        retryEvents.push({
          attempt: context.attempt,
          maxAttempts: context.maxAttempts,
          nextDelayMs,
          lastClassification: context.lastClassification,
          lastErrorSummary: context.lastErrorSummary,
          shouldUsePolicySafeVariant: context.shouldUsePolicySafeVariant,
          possibleTruncation: context.possibleTruncation,
        });
      },
    },
  );

  if (!retryResult.success || !retryResult.result) {
    const latestUserMessage = [...messages].reverse().find((message) => message.role === "user");
    const latestText = latestUserMessage ? getAnalysisUIMessageText(latestUserMessage) : "";
    throw new Error(retryResult.error ?? `Failed to stream analysis response for: ${latestText || "analysis request"}`);
  }

  return {
    streamResult: retryResult.result,
    getTraceCapture: () => ({
      usage: {
        model: getAnalysisModelName(),
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        durationMs: Date.now() - startTime,
        estimatedCostUsd: calculateCostSync(getAnalysisModelName(), {
          input: usage.inputTokens,
          output: usage.outputTokens,
        }).totalCost,
      },
      scratchpadEntries: getEntries().map((entry) => ({ ...entry })),
      retryEvents: retryEvents.map((event) => ({ ...event })),
      retryAttempts: retryResult.attempts,
      finalClassification: retryResult.finalClassification ?? retryEvents.at(-1)?.lastClassification ?? null,
      terminalError: retryResult.success ? null : (retryResult.error ?? null),
    }),
  };
}
