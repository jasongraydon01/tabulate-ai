import { convertToModelMessages, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import {
  getSanitizedConversationMessagesForModel,
  getAnalysisUIMessageText,
} from "@/lib/analysis/messages";
import {
  AnalysisComputeProposalError,
  createAnalysisBannerExtensionProposal,
  formatAnalysisComputeProposalToolResult,
} from "@/lib/analysis/computeLane/proposalService";
import {
  createAnalysisTableRollupProposal,
} from "@/lib/analysis/computeLane/tableRollup";
import {
  createAnalysisSelectedTableCutProposal,
} from "@/lib/analysis/computeLane/selectedTableCut";
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
  buildFetchTableModelMarkdown,
  confirmCitation,
  fetchTable,
  getQuestionContext,
  sanitizeGroundingToolOutput,
  listBannerCuts,
  searchRunCatalog,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";
import type { AnalysisTurnGroundingEvent } from "@/lib/analysis/claimCheck";
import type { AnalysisTraceRetryEvent } from "@/lib/analysis/trace";
import type { AnalysisUIMessage } from "@/lib/analysis/ui";
import { normalizeAnalysisStructuredAssistantParts } from "@/lib/analysis/structuredParts";
import {
  isAnalysisCellSummary,
  type AnalysisCellSummary,
  type AnalysisSourceRef,
  type AnalysisTableCard,
} from "@/lib/analysis/types";
import { AnalysisStructuredAnswerSchema } from "@/schemas/analysisStructuredAnswerSchema";
import { calculateCostSync, recordAgentMetrics } from "@/lib/observability";
import { retryWithPolicyHandling } from "@/lib/retryWithPolicyHandling";
import type { Id } from "../../../convex/_generated/dataModel";

const confirmCitationInputSchema = z.object({
  tableId: z.string().min(1).max(200),
  rowLabel: z.string().min(1).max(400),
  columnLabel: z.string().min(1).max(400),
  rowRef: z.string().min(1).max(200).optional(),
  columnRef: z.string().min(1).max(400).optional(),
}).strict();

export async function streamAnalysisResponse({
  messages,
  groundingContext,
  computeProposalContext,
  abortSignal,
}: {
  messages: AnalysisUIMessage[];
  groundingContext: AnalysisGroundingContext;
  computeProposalContext?: {
    orgId: Id<"organizations">;
    projectId: Id<"projects">;
    parentRunId: Id<"runs">;
    sessionId: Id<"analysisSessions">;
    requestedBy: Id<"users">;
    originClientTurnId?: string;
    originUserMessageId?: Id<"analysisMessages">;
    parentRun: {
      _id: Id<"runs">;
      status: string;
      result?: unknown;
      expiredAt?: number;
      artifactsPurgedAt?: number;
    };
    project: {
      _id: Id<"projects">;
      name: string;
      config?: Record<string, unknown> | null;
      intake?: Record<string, unknown> | null;
    };
    session: {
      _id: Id<"analysisSessions">;
      runId: Id<"runs">;
      projectId: Id<"projects">;
    };
  };
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
            description: [
              "Browse or search the current run's catalog of questions, tables, and banner cuts.",
              "Two modes:",
              "- Listing mode: omit `query` to get a compact snapshot of everything in the run. Default `scope` is \"questions\" — returns every question with its id, type, and wording. Use this to orient yourself on open-ended asks (\"what's in this run?\", \"what did they ask about X?\"). Pass `scope: \"tables\"` or `\"cuts\"` for the equivalent table or banner-cut inventory; `scope: \"all\"` returns all three.",
              "- Search mode: pass a `query` (a topic, concept, or phrase) to get lexical-scored top matches across questions, tables, and cuts. Use this when the user names a specific topic and you want the best matches rather than the full list.",
              "Prefer listing mode for orientation; prefer search mode once you know what you're looking for.",
            ].join("\n"),
            inputSchema: z.object({
              query: z.string().min(1).max(200).optional(),
              scope: z.enum(["all", "questions", "tables", "cuts"]).optional(),
            }),
            execute: async ({ query, scope }, options) => executeGroundedTool(
              "searchRunCatalog",
              () => searchRunCatalog(groundingContext, query, scope),
              { toolCallId: options.toolCallId },
            ),
          }),
          fetchTable: tool({
            description: "Fetch a grounded table's data for analysis. By default this returns all rows with Total only. Ask for additional banner groups explicitly via cutGroups when you need subgroup evidence. This does NOT render a card on its own — if the table belongs in the final reply, reference it in your final submitAnswer call as a render part.",
            inputSchema: z.object({
              tableId: z.string().min(1).max(200),
              cutGroups: z.union([
                z.literal("*"),
                z.array(z.string().min(1).max(100)).min(1).max(20),
              ]).optional(),
            }).strict(),
            toModelOutput: ({ input, output }) => ({
              type: "text",
              value: buildFetchTableModelMarkdown(output, {
                requestedCutGroups: input.cutGroups,
              }),
            }),
            execute: async ({ tableId, cutGroups }, options) => executeGroundedTool(
              "fetchTable",
              () => fetchTable(groundingContext, {
                tableId,
                cutGroups,
              }),
              { toolCallId: options.toolCallId },
            ),
          }),
          getQuestionContext: tool({
            description: "Return grounded metadata for a specific question. Default output is compact; ask for more detail with include sections such as items, survey, relatedTables, loop, or linkage.",
            inputSchema: z.object({
              questionId: z.string().min(1).max(200),
              include: z.array(z.enum(["items", "survey", "relatedTables", "loop", "linkage"])).max(5).optional(),
            }),
            execute: async ({ questionId, include }, options) => executeGroundedTool(
              "getQuestionContext",
              () => getQuestionContext(groundingContext, questionId, include),
              { toolCallId: options.toolCallId },
            ),
          }),
          listBannerCuts: tool({
            description: "List available banner groups and the concrete cuts (with stat letters) available for each group. Default output omits raw expressions; ask for include=['expressions'] only when needed.",
            inputSchema: z.object({
              filter: z.string().min(1).max(200).nullable().optional(),
              include: z.array(z.enum(["expressions"])).max(1).optional(),
            }),
            execute: async ({ filter, include }, options) => executeGroundedTool(
              "listBannerCuts",
              () => listBannerCuts(groundingContext, filter, include),
              { toolCallId: options.toolCallId },
            ),
          }),
          confirmCitation: tool({
            description: "Confirm a specific cell before citing its number in the final reply. Returns the cell summary (displayValue, pct/count/n/mean, baseN, sig markers) plus a stable cellId. Required before referencing that cell in a cite part for THIS TURN. Hierarchy: fetch → decide whether to render → confirm → submitAnswer with cite parts.",
            providerOptions: ANALYSIS_ANTHROPIC_EPHEMERAL_CACHE_CONTROL_PROVIDER_OPTIONS,
            inputSchema: confirmCitationInputSchema,
            execute: async (input, options) => executeGroundedTool(
              "confirmCitation",
              () => confirmCitation(groundingContext, input),
              { toolCallId: options.toolCallId },
            ),
          }),
          proposeDerivedRun: tool({
            description: [
              "Create a persisted derived-run proposal for exactly one new banner group/cut set appended across the full crosstab table set.",
              "Use only when the user clearly wants the new cut or banner group added across the full tab set. Do not use for a single table, a few tables, edits to existing banner groups, multi-group redesigns, recoding raw data, or open-end coding.",
              "If the request could mean either full-set recompute or a table-specific derivation, ask a clarification via submitAnswer instead of calling this tool.",
              "The input must explicitly mark targetScope as full_crosstab_set and tableSpecificDerivationExcluded as true. If you cannot truthfully provide both, do not call this tool.",
              "The tool persists the proposal for the UI card, but does not queue compute. Confirmation remains button-driven.",
            ].join("\n"),
            inputSchema: z.object({
              requestText: z.string().min(1).max(1000),
              targetScope: z.literal("full_crosstab_set"),
              tableSpecificDerivationExcluded: z.literal(true),
            }).strict(),
            execute: async ({ requestText }) => {
              if (!computeProposalContext) {
                return {
                  status: "unavailable" as const,
                  message: "Derived-run proposals are not available in this chat context.",
                };
              }

              try {
                const result = await createAnalysisBannerExtensionProposal({
                  ...computeProposalContext,
                  requestText,
                  groundingContext,
                  transcriptMode: "none",
                  abortSignal,
                });
                return formatAnalysisComputeProposalToolResult(result);
              } catch (error) {
                if (error instanceof AnalysisComputeProposalError) {
                  return {
                    status: "unavailable" as const,
                    code: error.code,
                    message: error.code === "preflight_failed"
                      ? "TabulateAI could not prepare a derived-run proposal for this request."
                      : error.message,
                  };
                }
                return {
                  status: "unavailable" as const,
                  code: "preflight_failed",
                  message: "TabulateAI could not prepare a derived-run proposal for this request.",
                };
              }
            },
          }),
          proposeRowRollup: tool({
            description: [
              "Validate and create a persisted derived-table proposal that collapses existing rows on one selected table.",
              "Use only for table-scoped row roll-ups where the source table keeps the same analytical meaning and selected source rows become one or more new output rows.",
              "Do not use for adding cuts, adding a banner cut across the full crosstab set, removing unmentioned rows, raw data recoding, open-end coding, or non-roll-up derived tables.",
              "The backend validates table ids, row refs, row eligibility, roll-up mechanism, compatible compute, and significance support before creating any proposal card.",
              "If the tool returns rejected_candidate because ids or row refs are wrong, repair using fetchTable/searchRunCatalog and retry only when the fix is clear. If intent is missing, ask a concise clarification via submitAnswer.",
              "The tool persists a proposal only when validation passes. Confirmation remains button-driven.",
            ].join("\n"),
            inputSchema: z.object({
              requestText: z.string().min(1).max(1000),
              sourceTableId: z.string().min(1).max(200),
              outputRows: z.array(z.object({
                label: z.string().min(1).max(200),
                sourceRows: z.array(z.object({
                  rowKey: z.string().min(1).max(200),
                }).strict()).min(2).max(12),
              }).strict()).min(1).max(4),
            }).strict(),
            execute: async ({ requestText, sourceTableId, outputRows }) => {
              if (!computeProposalContext) {
                return {
                  status: "rejected_candidate" as const,
                  message: "Derived-table proposals are not available in this chat context.",
                  reasons: ["Derived-table proposals are not available in this chat context."],
                  repairHints: ["Answer normally or ask the user to open a completed run's analysis workspace."],
                  invalidTableIds: [],
                  invalidRowRefs: [],
                  ineligibleRows: [],
                  unsupportedCombinations: [],
                  blockedMechanisms: [],
                };
              }

              return createAnalysisTableRollupProposal({
                ...computeProposalContext,
                requestText,
                candidates: [{
                  tableId: sourceTableId,
                  outputRows,
                }],
                groundingContext,
              });
            },
          }),
          proposeSelectedTableCut: tool({
            description: [
              "Validate and create a persisted derived-table proposal that adds one new cut group to one selected table.",
              "Use only when the user clearly wants a new cut for a single selected source table. Do not use for full-crosstab banner additions, row roll-ups, multiple tables, multiple groups, raw data recoding, open-end coding, composites, intersections, KPI tables, or new table shapes.",
              "The model-facing input is sparse: requestText, sourceTableId, groupName, exact source variable, and cuts. Do not include table title, question id, question text, raw R, R2 keys, frozen specs, fingerprints, or internal expressions.",
              "The variable must be an exact SPSS/source variable from run context. If scope, source table, variable, or cut values are unclear, ask a concise clarification via submitAnswer instead of calling this tool.",
              "The backend validates the table, exact variable, cut resolvability, and compute support before creating any proposal card. Confirmation remains button-driven.",
            ].join("\n"),
            inputSchema: z.object({
              requestText: z.string().min(1).max(1000),
              sourceTableId: z.string().min(1).max(200),
              groupName: z.string().min(1).max(200),
              variable: z.string().min(1).max(200),
              cuts: z.array(z.object({
                name: z.string().min(1).max(200),
                original: z.string().min(1).max(300),
              }).strict()).min(1).max(20),
            }).strict(),
            execute: async ({ requestText, sourceTableId, groupName, variable, cuts }) => {
              if (!computeProposalContext) {
                return {
                  status: "rejected_candidate" as const,
                  message: "Selected-table cut proposals are not available in this chat context.",
                  reasons: ["Selected-table cut proposals are not available in this chat context."],
                  repairHints: ["Answer normally or ask the user to open a completed run's analysis workspace."],
                  invalidTableIds: [],
                  invalidVariables: [],
                  invalidCuts: [],
                };
              }

              return createAnalysisSelectedTableCutProposal({
                ...computeProposalContext,
                requestText,
                candidate: {
                  sourceTableId,
                  groupName,
                  variable,
                  cuts,
                },
                groundingContext,
                abortSignal,
              });
            },
          }),
          submitAnswer: tool({
            description: "Finalize the user-visible reply as structured assistant parts. This is the only valid answer-delivery contract for the turn: if you do not call submitAnswer, the turn fails; if you emit user-visible prose outside submitAnswer, the turn fails. Call this exactly once after all needed fetchTable and confirmCitation calls. Use text parts for prose, render parts for inline tables, and cite parts for the sentence-end citations that anchor quoted numbers. After calling submitAnswer, stop.",
            inputSchema: AnalysisStructuredAnswerSchema,
            execute: async ({ parts }) => ({
              parts: normalizeAnalysisStructuredAssistantParts(parts),
            }),
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
