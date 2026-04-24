import { convertToModelMessages, stepCountIs, streamText, tool, type UIMessage } from "ai";
import { z } from "zod";

import {
  getSanitizedConversationMessagesForModel,
  getAnalysisUIMessageText,
} from "@/lib/analysis/messages";
import {
  getAnalysisModel,
  getAnalysisModelName,
  getAnalysisProviderOptions,
} from "@/lib/analysis/model";
import {
  ANALYSIS_ANTHROPIC_EPHEMERAL_CACHE_CONTROL_PROVIDER_OPTIONS,
  buildAnalysisSystemMessage,
} from "@/lib/analysis/promptPrefix";
import {
  attachRetrievedContextXml,
  confirmCitation,
  getQuestionContext,
  sanitizeGroundingToolOutput,
  getTableCard,
  listBannerCuts,
  searchRunCatalog,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";
import type { AnalysisTurnGroundingEvent } from "@/lib/analysis/claimCheck";
import type { AnalysisTraceRetryEvent } from "@/lib/analysis/trace";
import {
  isAnalysisCellSummary,
  type AnalysisCellSummary,
  type AnalysisSourceRef,
  type AnalysisTableCard,
} from "@/lib/analysis/types";
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
  const retryEvents: AnalysisTraceRetryEvent[] = [];
  const groundingEvents: AnalysisTurnGroundingEvent[] = [];
  let usage = {
    inputTokens: 0,
    outputTokens: 0,
    nonCachedInputTokens: 0,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
  };

  function captureGroundingEvent(params: {
    toolName: string;
    toolCallId?: string;
    result: unknown;
  }) {
    const sourceRefs = (() => {
      if (!params.result || typeof params.result !== "object") return [];
      const record = params.result as { sourceRefs?: AnalysisSourceRef[] };
      return Array.isArray(record.sourceRefs) ? record.sourceRefs : [];
    })();

    const tableCard = (() => {
      if (!params.result || typeof params.result !== "object") return undefined;
      const record = params.result as Partial<AnalysisTableCard>;
      if (record.status === "available" && typeof record.tableId === "string" && Array.isArray(record.rows)) {
        return params.result as AnalysisTableCard;
      }
      return undefined;
    })();

    const cellSummary: AnalysisCellSummary | undefined = (() => {
      if (!params.result || typeof params.result !== "object") return undefined;
      const record = params.result as Record<string, unknown>;
      if (record.status !== "confirmed") return undefined;
      return isAnalysisCellSummary(params.result) ? (params.result as AnalysisCellSummary) : undefined;
    })();

    if (sourceRefs.length === 0 && !tableCard && !cellSummary) return;

    groundingEvents.push({
      toolName: params.toolName,
      toolCallId: params.toolCallId ?? params.toolName,
      sourceRefs,
      ...(tableCard ? { tableCard } : {}),
      ...(cellSummary ? { cellSummary } : {}),
    });
  }

  async function executeGroundedTool<T>(
    toolName: string,
    resolve: () => Promise<T> | T,
    options?: { toolCallId?: string },
  ): Promise<T> {
    const sanitized = sanitizeGroundingToolOutput(await resolve());
    const result = attachRetrievedContextXml(toolName, sanitized);
    captureGroundingEvent({
      toolName,
      toolCallId: options?.toolCallId,
      result,
    });
    return result;
  }

  const retryResult = await retryWithPolicyHandling(
    async () =>
      streamText({
        model: getAnalysisModel(),
        system: buildAnalysisSystemMessage(groundingContext),
        messages: await convertToModelMessages(sanitizedMessages),
        stopWhen: stepCountIs(12),
        abortSignal,
        ...(getAnalysisProviderOptions() ? { providerOptions: getAnalysisProviderOptions() } : {}),
        tools: {
          searchRunCatalog: tool({
            description: "Search the current run's catalog of questions, tables, and banner cuts from grounded artifacts. Use this first when the user refers to a topic or concept rather than a specific ID.",
            inputSchema: z.object({
              query: z.string().min(1).max(200),
            }),
            execute: async ({ query }, options) => executeGroundedTool(
              "searchRunCatalog",
              () => searchRunCatalog(groundingContext, query),
              { toolCallId: options.toolCallId },
            ),
          }),
          fetchTable: tool({
            description: "Fetch a grounded table's data. This does NOT render a card on its own — to show the table inline in your reply, emit a render marker `[[render tableId=<id>]]` in your prose. Fetched tables that are not referenced by a marker stay invisible (used for context only).",
            inputSchema: z.object({
              tableId: z.string().min(1).max(200),
              rowFilter: z.string().min(1).max(200).nullable().optional(),
              cutFilter: z.string().min(1).max(200).nullable().optional(),
              valueMode: z.enum(["pct", "count", "n", "mean"]).optional(),
            }),
            execute: async ({ tableId, rowFilter, cutFilter, valueMode }, options) => executeGroundedTool(
              "fetchTable",
              () => getTableCard(groundingContext, {
                tableId,
                rowFilter,
                cutFilter,
                valueMode,
              }),
              { toolCallId: options.toolCallId },
            ),
          }),
          getQuestionContext: tool({
            description: "Return grounded metadata for a specific question: type, items, base summary, related tables, plus survey wording / answer options / scale labels / questionnaire snippet when a matching survey entry exists.",
            inputSchema: z.object({
              questionId: z.string().min(1).max(200),
            }),
            execute: async ({ questionId }, options) => executeGroundedTool(
              "getQuestionContext",
              () => getQuestionContext(groundingContext, questionId),
              { toolCallId: options.toolCallId },
            ),
          }),
          listBannerCuts: tool({
            description: "List available banner groups and the concrete cuts (with stat letters) available for each group. Use when the user asks what demographics or subgroups are available.",
            inputSchema: z.object({
              filter: z.string().min(1).max(200).nullable().optional(),
            }),
            execute: async ({ filter }, options) => executeGroundedTool(
              "listBannerCuts",
              () => listBannerCuts(groundingContext, filter),
              { toolCallId: options.toolCallId },
            ),
          }),
          confirmCitation: tool({
            description: "Confirm a specific cell before citing its number in prose. Returns the cell summary (displayValue, pct/count/n/mean, baseN, sig markers) plus a stable cellId. Required before emitting any `[[cite cellIds=...]]` marker for that cell IN THIS TURN. Hierarchy: fetch → (optionally) render → confirm → cite.",
            providerOptions: ANALYSIS_ANTHROPIC_EPHEMERAL_CACHE_CONTROL_PROVIDER_OPTIONS,
            inputSchema: z.object({
              tableId: z.string().min(1).max(200),
              rowKey: z.string().min(1).max(200),
              cutKey: z.string().min(1).max(400),
              valueMode: z.enum(["pct", "count", "n", "mean"]).optional(),
            }),
            execute: async ({ tableId, rowKey, cutKey, valueMode }, options) => executeGroundedTool(
              "confirmCitation",
              () => confirmCitation(groundingContext, {
                tableId,
                rowKey,
                cutKey,
                valueMode,
              }),
              { toolCallId: options.toolCallId },
            ),
          }),
        },
        onFinish: ({ totalUsage }) => {
          usage = {
            inputTokens: totalUsage.inputTokens ?? 0,
            outputTokens: totalUsage.outputTokens ?? 0,
            nonCachedInputTokens: totalUsage.inputTokenDetails?.noCacheTokens ?? 0,
            cachedInputTokens: totalUsage.inputTokenDetails?.cacheReadTokens ?? 0,
            cacheWriteInputTokens: totalUsage.inputTokenDetails?.cacheWriteTokens ?? 0,
          };
          recordAgentMetrics(
            "AnalysisAgent",
            getAnalysisModelName(),
            {
              input: usage.inputTokens,
              output: usage.outputTokens,
              inputNoCache: usage.nonCachedInputTokens,
              inputCacheRead: usage.cachedInputTokens,
              inputCacheWrite: usage.cacheWriteInputTokens,
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
        nonCachedInputTokens: usage.nonCachedInputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        cacheWriteInputTokens: usage.cacheWriteInputTokens,
        durationMs: Date.now() - startTime,
        estimatedCostUsd: calculateCostSync(getAnalysisModelName(), {
          input: usage.inputTokens,
          output: usage.outputTokens,
          inputNoCache: usage.nonCachedInputTokens,
          inputCacheRead: usage.cachedInputTokens,
          inputCacheWrite: usage.cacheWriteInputTokens,
        }).totalCost,
      },
      retryEvents: retryEvents.map((event) => ({ ...event })),
      retryAttempts: retryResult.attempts,
      finalClassification: retryResult.finalClassification ?? retryEvents.at(-1)?.lastClassification ?? null,
      terminalError: retryResult.success ? null : (retryResult.error ?? null),
    }),
    getGroundingCapture: () => groundingEvents.map((event) => ({
      ...event,
      sourceRefs: event.sourceRefs.map((ref) => ({ ...ref })),
      ...(event.tableCard ? { tableCard: { ...event.tableCard } } : {}),
    })),
  };
}
