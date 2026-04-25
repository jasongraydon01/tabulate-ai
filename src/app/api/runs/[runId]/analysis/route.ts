import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type FinishReason,
  type UIMessage,
  type UIMessageChunk,
  type UIMessageStreamWriter,
} from "ai";
import { NextRequest, NextResponse } from "next/server";

import { getApiErrorDetails } from "@/lib/api/errorDetails";
import { streamAnalysisResponse } from "@/lib/analysis/AnalysisAgent";
import {
  detectUncitedSpecificNumbers,
  resolveAssistantMessageTrust,
  type InjectedAnalysisTableCard,
} from "@/lib/analysis/claimCheck";
import {
  extractAnalysisCiteMarkers,
  stripAnalysisCiteAnchors,
  stripInvalidAnalysisCiteMarkers,
  validateAnalysisCiteMarkers,
} from "@/lib/analysis/citeAnchors";
import { buildDeterministicFollowUpSuggestions } from "@/lib/analysis/followups";
import { loadAnalysisGroundingContext } from "@/lib/analysis/grounding";
import {
  buildAnalysisEvidenceItems,
  getAnalysisUIMessageText,
  normalizePersistedAnalysisArtifactRecord,
  normalizePersistedAnalysisMessageRecord,
  persistedAnalysisMessagesToUIMessages,
  sanitizeAnalysisAssistantMessageContent,
  sanitizeAnalysisMessageContent,
} from "@/lib/analysis/messages";
import {
  stripAnalysisRenderAnchors,
  stripInvalidAnalysisRenderMarkers,
  validateAnalysisRenderMarkers,
} from "@/lib/analysis/renderAnchors";
import { attemptAnalysisMarkerRepair } from "@/lib/analysis/markerRepair";
import {
  buildPersistedAnalysisPartsWithStructuredAssistantParts,
  type PersistedAnalysisPart,
} from "@/lib/analysis/persistence";
import { buildAnalysisStructuredAssistantPartsFromText } from "@/lib/analysis/structuredParts";
import {
  writeAnalysisTurnErrorTrace,
  writeAnalysisTurnTrace,
} from "@/lib/analysis/trace";
import {
  generateAnalysisSessionTitle,
  isDefaultAnalysisSessionTitle,
} from "@/lib/analysis/title";
import { FETCH_TABLE_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import {
  type AnalysisStructuredAssistantPart,
  isAnalysisTableCard,
  type AnalysisGroundingRef,
  type AnalysisMessageMetadata,
} from "@/lib/analysis/types";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api, internal } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

function isAnalysisMessageCandidate(value: unknown): value is UIMessage[] {
  return Array.isArray(value);
}

type PersistedPartForCreate = PersistedAnalysisPart & {
  artifactId?: Id<"analysisArtifacts">;
};

interface PersistAssistantPartsResult {
  persistedParts: PersistedPartForCreate[];
  artifactIdsByToolCallId: Record<string, Id<"analysisArtifacts">>;
}

function summarizeAssistantResponseForTitle(parts: UIMessage["parts"]): string {
  const segments: string[] = [];

  for (const part of parts) {
    if (part.type === "text" && typeof part.text === "string") {
      const text = sanitizeAnalysisMessageContent(
        stripAnalysisCiteAnchors(stripAnalysisRenderAnchors(part.text)),
      );
      if (text) segments.push(text);
      continue;
    }

    if (part.type === FETCH_TABLE_TOOL_TYPE) {
      const label = typeof part.title === "string"
        ? sanitizeAnalysisMessageContent(part.title)
        : typeof part.output === "object"
          && part.output !== null
          && "title" in part.output
          && typeof part.output.title === "string"
          ? sanitizeAnalysisMessageContent(part.output.title)
          : "";
      if (label) {
        segments.push(`Table: ${label}`);
      }
    }
  }

  return segments.join(" ").trim().slice(0, 2000);
}


function filterUIStreamForTrustLayer(
  stream: ReadableStream<UIMessageChunk>,
): ReadableStream<UIMessageChunk> {
  return stream.pipeThrough(new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (
        chunk.type === "text-start"
        || chunk.type === "text-delta"
        || chunk.type === "text-end"
        || chunk.type === "finish"
        || chunk.type === "message-metadata"
      ) {
        return;
      }

      controller.enqueue(chunk);
    },
  }));
}

function emitTextPart(writer: UIMessageStreamWriter<UIMessage>, text: string) {
  if (!text) return;

  const textPartId = "analysis-final-text";
  writer.write({ type: "text-start", id: textPartId });

  const deltas = text
    .split(/(\n{2,})/)
    .map((segment) => segment)
    .filter((segment) => segment.length > 0);

  if (deltas.length === 0) {
    writer.write({ type: "text-delta", id: textPartId, delta: text });
  } else {
    for (const delta of deltas) {
      writer.write({ type: "text-delta", id: textPartId, delta });
    }
  }

  writer.write({ type: "text-end", id: textPartId });
}

function emitInjectedTableCards(
  writer: UIMessageStreamWriter<UIMessage>,
  injectedTableCards: InjectedAnalysisTableCard[],
) {
  for (const injected of injectedTableCards) {
    writer.write({
      type: "tool-input-available",
      toolCallId: injected.toolCallId,
      toolName: "fetchTable",
      input: {
        tableId: injected.card.tableId,
        cutGroups: injected.card.requestedCutGroups ?? null,
      },
    });
    writer.write({
      type: "tool-output-available",
      toolCallId: injected.toolCallId,
      output: injected.card,
    });
  }
}

function toStreamMetadata(
  groundingRefs: AnalysisGroundingRef[],
  followUpSuggestions: string[],
): AnalysisMessageMetadata | undefined {
  if (groundingRefs.length === 0 && followUpSuggestions.length === 0) return undefined;

  return {
    ...(groundingRefs.length > 0
      ? {
          hasGroundedClaims: true,
          evidence: buildAnalysisEvidenceItems(groundingRefs),
        }
      : {}),
    ...(followUpSuggestions.length > 0 ? { followUpSuggestions } : {}),
  };
}

// Convex validators on groundingRef optional fields are `v.optional(v.string())`
// — string OR undefined, never null. Build the persisted shape by omitting
// fields whose source value is null/undefined rather than passing null through.
function buildPersistedGroundingRef(
  ref: AnalysisGroundingRef,
  artifactId: Id<"analysisArtifacts"> | undefined,
  overrides?: { anchorId?: string; renderedInCurrentMessage?: boolean },
): Record<string, unknown> {
  const persisted: Record<string, unknown> = {
    claimId: ref.claimId,
    claimType: ref.claimType,
    evidenceKind: ref.evidenceKind,
    refType: ref.refType,
    refId: ref.refId,
    label: ref.label,
  };

  const resolvedAnchorId = overrides?.anchorId ?? ref.anchorId ?? undefined;
  if (resolvedAnchorId) persisted.anchorId = resolvedAnchorId;

  if (artifactId) {
    persisted.artifactId = artifactId;
  } else if (ref.artifactId) {
    persisted.artifactId = ref.artifactId as unknown as Id<"analysisArtifacts">;
  }

  if (ref.sourceTableId) persisted.sourceTableId = ref.sourceTableId;
  if (ref.sourceQuestionId) persisted.sourceQuestionId = ref.sourceQuestionId;
  if (ref.rowKey) persisted.rowKey = ref.rowKey;
  if (ref.cutKey) persisted.cutKey = ref.cutKey;

  const rendered = overrides?.renderedInCurrentMessage ?? ref.renderedInCurrentMessage;
  if (typeof rendered === "boolean") persisted.renderedInCurrentMessage = rendered;

  return persisted;
}

function applyArtifactIdsToGroundingRefsForPersistence(
  groundingRefs: AnalysisGroundingRef[],
  artifactIdsByToolCallId: Record<string, Id<"analysisArtifacts">>,
): Array<Record<string, unknown>> {
  return groundingRefs.map((ref) => {
    const artifactId = ref.anchorId ? artifactIdsByToolCallId[ref.anchorId] : undefined;
    if (!artifactId) {
      return buildPersistedGroundingRef(ref, undefined);
    }

    return buildPersistedGroundingRef(ref, artifactId, {
      anchorId: ref.anchorId ?? undefined,
      renderedInCurrentMessage: true,
    });
  });
}

function buildFinalAssistantParts(params: {
  originalParts: UIMessage["parts"];
  assistantText: string;
  injectedTableCards: InjectedAnalysisTableCard[];
}): UIMessage["parts"] {
  const nonTextParts = params.originalParts.filter((part) => part.type !== "text");
  const injectedParts = params.injectedTableCards.map<UIMessage["parts"][number]>((entry) => ({
    type: FETCH_TABLE_TOOL_TYPE,
    toolCallId: entry.toolCallId,
    state: "output-available",
    input: {
      tableId: entry.card.tableId,
      cutGroups: entry.card.requestedCutGroups ?? null,
    },
    output: entry.card,
  }));

  return [
    ...nonTextParts,
    ...injectedParts,
    ...(params.assistantText ? [{ type: "text", text: params.assistantText } satisfies UIMessage["parts"][number]] : []),
  ];
}

async function persistAssistantMessageParts(params: {
  parts: UIMessage["parts"];
  structuredAssistantParts: AnalysisStructuredAssistantPart[];
  sessionId: Id<"analysisSessions">;
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  createdBy: Id<"users">;
}): Promise<PersistAssistantPartsResult> {
  const pending = buildPersistedAnalysisPartsWithStructuredAssistantParts(
    params.parts,
    params.structuredAssistantParts,
  );
  const persistedParts: PersistedPartForCreate[] = [];
  const artifactIdsByToolCallId: Record<string, Id<"analysisArtifacts">> = {};

  for (const entry of pending) {
    if (entry.kind === "ready") {
      persistedParts.push(entry.part);
      continue;
    }

    const artifactId = await mutateInternal(internal.analysisArtifacts.create, {
      sessionId: params.sessionId,
      orgId: params.orgId,
      projectId: params.projectId,
      runId: params.runId,
      artifactType: "table_card",
      sourceClass: "from_tabs",
      title: entry.artifact.title,
      sourceTableIds: [entry.artifact.tableId],
      sourceQuestionIds: entry.artifact.questionId ? [entry.artifact.questionId] : [],
      payload: entry.artifact.payload,
      createdBy: params.createdBy,
    });

    if (entry.template.toolCallId) {
      artifactIdsByToolCallId[entry.template.toolCallId] = artifactId;
    }

    persistedParts.push({
      type: FETCH_TABLE_TOOL_TYPE,
      state: entry.template.state,
      artifactId,
      label: entry.template.label,
      ...(entry.template.input !== undefined ? { input: entry.template.input } : {}),
      ...(entry.template.toolCallId ? { toolCallId: entry.template.toolCallId } : {}),
    });
  }

  return {
    persistedParts,
    artifactIdsByToolCallId,
  };
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!runId || !CONVEX_ID_RE.test(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), "high", "runs/analysis/chat");
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => null) as {
      messages?: unknown;
      sessionId?: unknown;
    } | null;

    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId || !CONVEX_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }

    const submittedMessages = isAnalysisMessageCandidate(body?.messages) ? body?.messages : [];
    const latestUserMessage = [...submittedMessages].reverse().find((message) => message.role === "user");
    const latestUserText = latestUserMessage
      ? sanitizeAnalysisMessageContent(getAnalysisUIMessageText(latestUserMessage))
      : "";
    if (!latestUserText) {
      return NextResponse.json({ error: "A user message is required" }, { status: 400 });
    }

    const convex = getConvexClient();
    const [run, session, persistedMessages, persistedArtifacts] = await Promise.all([
      convex.query(api.runs.get, {
        runId: runId as Id<"runs">,
        orgId: auth.convexOrgId,
      }),
      convex.query(api.analysisSessions.getById, {
        orgId: auth.convexOrgId,
        sessionId: sessionId as Id<"analysisSessions">,
      }),
      convex.query(api.analysisMessages.listBySession, {
        orgId: auth.convexOrgId,
        sessionId: sessionId as Id<"analysisSessions">,
      }),
      convex.query(api.analysisArtifacts.listBySession, {
        orgId: auth.convexOrgId,
        sessionId: sessionId as Id<"analysisSessions">,
      }),
    ]);

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!session || String(session.runId) !== runId) {
      return NextResponse.json({ error: "Analysis session not found" }, { status: 404 });
    }

    const project = await convex.query(api.projects.get, {
      projectId: session.projectId,
      orgId: auth.convexOrgId,
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }

    const lastPersistedMessage = persistedMessages[persistedMessages.length - 1];
    const hasExistingAssistantMessage = persistedMessages.some((message) => message.role === "assistant");
    let conversationMessages = persistedAnalysisMessagesToUIMessages(
      persistedMessages.map((message) => normalizePersistedAnalysisMessageRecord(message)),
      persistedArtifacts.map((artifact) => normalizePersistedAnalysisArtifactRecord(artifact)),
    );

    if (
      !lastPersistedMessage
      || lastPersistedMessage.role !== "user"
      || lastPersistedMessage.content !== latestUserText
    ) {
      const userMessageId = await mutateInternal(internal.analysisMessages.create, {
        sessionId: session._id,
        orgId: auth.convexOrgId,
        role: "user",
        content: latestUserText,
      });

      conversationMessages = [
        ...conversationMessages,
        {
          id: String(userMessageId),
          role: "user",
          parts: [
            {
              type: "text",
              text: latestUserText,
            },
          ],
        },
      ];
    }

    const groundingContext = await loadAnalysisGroundingContext({
      runResultValue: run.result,
      projectName: project.name,
      runStatus: run.status,
      projectConfig: project.config,
      projectIntake: project.intake,
    });

    const {
      streamResult,
      getTraceCapture,
      getGroundingCapture,
    } = await streamAnalysisResponse({
      messages: conversationMessages,
      groundingContext,
      abortSignal: request.signal,
    });

    let errorTraceWritten = false;
    let settledFinalEvent = false;
    let resolveFinalEvent: ((event: {
      responseMessage: UIMessage;
      isAborted: boolean;
      finishReason?: FinishReason;
    } | null) => void) | null = null;
    const finalEventPromise = new Promise<{
      responseMessage: UIMessage;
      isAborted: boolean;
      finishReason?: FinishReason;
    } | null>((resolve) => {
      resolveFinalEvent = resolve;
    });

    const settleFinalEvent = (event: {
      responseMessage: UIMessage;
      isAborted: boolean;
      finishReason?: FinishReason;
    } | null) => {
      if (settledFinalEvent) return;
      settledFinalEvent = true;
      resolveFinalEvent?.(event);
    };

    const handleStreamError = (error: unknown) => {
      console.error("[Analysis Chat POST] Stream error:", error);
      if (!errorTraceWritten) {
        errorTraceWritten = true;
        const createdAt = new Date().toISOString();
        void writeAnalysisTurnErrorTrace({
          runResultValue: run.result,
          orgId: String(auth.convexOrgId),
          projectId: String(session.projectId),
          runId: String(session.runId),
          sessionId: String(session._id),
          sessionTitle: session.title,
          createdAt,
          latestUserPrompt: latestUserText,
          errorMessage: error instanceof Error ? error.message : String(error),
          traceCapture: getTraceCapture(),
        }).catch((traceError) => {
          console.warn("[Analysis Chat POST] Failed to write analysis error trace:", traceError);
        });
      }

      settleFinalEvent(null);
      return "Analysis response failed. Please try again.";
    };

    const uiMessageStream = streamResult.toUIMessageStream({
      originalMessages: conversationMessages,
      sendReasoning: true,
      sendFinish: false,
      onError: handleStreamError,
      onFinish: ({ responseMessage, isAborted, finishReason }) => {
        settleFinalEvent({
          responseMessage,
          isAborted,
          finishReason,
        });
      },
    });

    return createUIMessageStreamResponse({
      stream: createUIMessageStream<UIMessage>({
        originalMessages: conversationMessages,
        onError: handleStreamError,
        execute: async ({ writer }) => {
          writer.merge(filterUIStreamForTrustLayer(uiMessageStream));

          const finalEvent = await finalEventPromise;
          if (!finalEvent || finalEvent.isAborted) {
            return;
          }

          const rawAssistantText = sanitizeAnalysisAssistantMessageContent(
            getAnalysisUIMessageText(finalEvent.responseMessage),
          );
          const groundingCapture = getGroundingCapture();

          // Marker guardrails:
          //  - render: every `[[render tableId=X]]` must point at a table that
          //    exists in the run AND was fetched this turn.
          //  - cite: every cellId in `[[cite cellIds=...]]` must have been
          //    confirmed this turn via confirmCitation.
          // Invalid markers → one combined repair shot; still-invalid after
          // repair → strip them deterministically.
          const fetchedTableIds = finalEvent.responseMessage.parts.flatMap((part) => {
            if (part.type !== FETCH_TABLE_TOOL_TYPE) return [];
            if (part.state !== "output-available") return [];
            if (!isAnalysisTableCard(part.output)) return [];
            return [part.output.tableId];
          });
          const catalogTableIds = Object.keys(groundingContext.tables);

          const confirmedCellIds = groundingCapture
            .map((event) => event.cellSummary?.cellId)
            .filter((id): id is string => typeof id === "string");

          const initialAssistantText = rawAssistantText;
          const initialRenderIssues = validateAnalysisRenderMarkers({
            text: initialAssistantText,
            fetchedTableIds,
            catalogTableIds,
          });
          const initialCiteIssues = validateAnalysisCiteMarkers({
            text: initialAssistantText,
            confirmedCellIds,
          });

          let effectiveAssistantText = initialAssistantText;

          if (initialRenderIssues.length > 0 || initialCiteIssues.length > 0) {
            const repairedText = await attemptAnalysisMarkerRepair({
              groundingContext,
              conversationMessages,
              failedAssistantText: initialAssistantText,
              renderIssues: initialRenderIssues,
              citeIssues: initialCiteIssues,
              fetchedTableIds,
              confirmedCellIds,
              catalogSampleTableIds: catalogTableIds,
              abortSignal: request.signal,
            });

            let finalText = initialAssistantText;
            if (repairedText) {
              finalText = sanitizeAnalysisAssistantMessageContent(repairedText);
            }

            const remainingRenderIssues = validateAnalysisRenderMarkers({
              text: finalText,
              fetchedTableIds,
              catalogTableIds,
            });
            const remainingCiteIssues = validateAnalysisCiteMarkers({
              text: finalText,
              confirmedCellIds,
            });

            if (remainingRenderIssues.length > 0 || remainingCiteIssues.length > 0) {
              console.warn("[Analysis Chat POST] Stripping invalid markers after repair:", {
                renderMarkers: remainingRenderIssues.map((issue) => ({ tableId: issue.tableId, reason: issue.reason })),
                citeMarkers: remainingCiteIssues.map((issue) => ({ reason: issue.reason, unconfirmedCellIds: issue.unconfirmedCellIds })),
                repairAttempted: Boolean(repairedText),
              });
              if (remainingRenderIssues.length > 0) {
                finalText = stripInvalidAnalysisRenderMarkers(finalText, remainingRenderIssues);
              }
              if (remainingCiteIssues.length > 0) {
                finalText = stripInvalidAnalysisCiteMarkers(finalText, remainingCiteIssues);
              }
            }

            effectiveAssistantText = finalText;
          }

          // Freelancing-log: quiet regression detector — assistant quoted a
          // specific number but neither confirmed a cell this turn nor emitted
          // any cite marker. No user-visible effect.
          const citeMarkerCount = extractAnalysisCiteMarkers(effectiveAssistantText).length;
          if (
            detectUncitedSpecificNumbers(stripAnalysisCiteAnchors(stripAnalysisRenderAnchors(effectiveAssistantText)))
            && confirmedCellIds.length === 0
            && citeMarkerCount === 0
          ) {
            console.warn("[Analysis Chat POST] uncited_specific_numbers", {
              sessionId: String(session._id),
            });
          }

          // Rebuild trust result against the post-repair text — the cite set
          // may have changed between initial stream and final text.
          const structuredAssistantParts = buildAnalysisStructuredAssistantPartsFromText(
            effectiveAssistantText,
          );
          const trustResult = resolveAssistantMessageTrust({
            assistantText: effectiveAssistantText,
            assistantParts: structuredAssistantParts,
            responseParts: finalEvent.responseMessage.parts,
            groundingEvents: groundingCapture,
          });

          const finalResponseParts = buildFinalAssistantParts({
            originalParts: finalEvent.responseMessage.parts,
            assistantText: trustResult.assistantText,
            injectedTableCards: trustResult.injectedTableCards,
          });
          const persistedAssistantText = stripAnalysisCiteAnchors(
            stripAnalysisRenderAnchors(trustResult.assistantText),
          );
          const followUpSuggestions = buildDeterministicFollowUpSuggestions({
            groundingContext,
            groundingRefs: trustResult.groundingRefs,
            responseParts: finalResponseParts,
          });
          const assistantTitleBasis = persistedAssistantText || summarizeAssistantResponseForTitle(finalResponseParts);
          const traceCapture = getTraceCapture();

          const streamMetadata = toStreamMetadata(trustResult.groundingRefs, followUpSuggestions);
          emitInjectedTableCards(writer, trustResult.injectedTableCards);
          emitTextPart(writer, trustResult.assistantText);
          if (streamMetadata) {
            writer.write({
              type: "message-metadata",
              messageMetadata: streamMetadata,
            });
          }
          writer.write({
            type: "finish",
            finishReason: finalEvent.finishReason ?? "stop",
          });

          const { persistedParts, artifactIdsByToolCallId } = await persistAssistantMessageParts({
            parts: finalResponseParts,
            structuredAssistantParts: trustResult.assistantParts,
            sessionId: session._id,
            orgId: auth.convexOrgId,
            projectId: session.projectId,
            runId: session.runId,
            createdBy: auth.convexUserId,
          });
          const persistedGroundingRefs = applyArtifactIdsToGroundingRefsForPersistence(
            trustResult.groundingRefs,
            artifactIdsByToolCallId,
          );
          if (!persistedAssistantText && persistedParts.length === 0) return;

          const createdAt = new Date().toISOString();
          const assistantMessageId = await mutateInternal(internal.analysisMessages.create, {
            sessionId: session._id,
            orgId: auth.convexOrgId,
            role: "assistant",
            content: persistedAssistantText,
            ...(persistedParts.length > 0 ? { parts: persistedParts } : {}),
            ...(persistedGroundingRefs.length > 0 ? { groundingRefs: persistedGroundingRefs } : {}),
            ...(followUpSuggestions.length > 0 ? { followUpSuggestions } : {}),
            agentMetrics: {
              model: traceCapture.usage.model,
              inputTokens: traceCapture.usage.inputTokens,
              outputTokens: traceCapture.usage.outputTokens,
              nonCachedInputTokens: traceCapture.usage.nonCachedInputTokens,
              cachedInputTokens: traceCapture.usage.cachedInputTokens,
              cacheWriteInputTokens: traceCapture.usage.cacheWriteInputTokens,
              durationMs: traceCapture.usage.durationMs,
              estimatedCostUsd: traceCapture.usage.estimatedCostUsd,
            },
          });

          try {
            await writeAnalysisTurnTrace({
              runResultValue: run.result,
              orgId: String(auth.convexOrgId),
              projectId: String(session.projectId),
              runId: String(session.runId),
              sessionId: String(session._id),
              sessionTitle: session.title,
              messageId: String(assistantMessageId),
              createdAt,
              assistantText: persistedAssistantText,
              responseParts: finalResponseParts,
              traceCapture,
            });
          } catch (traceError) {
            console.warn("[Analysis Chat POST] Failed to write analysis turn trace:", traceError);
          }

          const shouldGenerateTitle = !hasExistingAssistantMessage
            && session.titleSource === "default"
            && isDefaultAnalysisSessionTitle(session.title);

          if (!shouldGenerateTitle || !assistantTitleBasis) {
            return;
          }

          try {
            const generatedTitle = await generateAnalysisSessionTitle({
              userPrompt: latestUserText,
              assistantResponse: assistantTitleBasis,
              abortSignal: request.signal,
            });

            await mutateInternal(internal.analysisSessions.applyGeneratedTitle, {
              orgId: auth.convexOrgId,
              sessionId: session._id,
              title: generatedTitle,
            });
          } catch (titleError) {
            console.warn("[Analysis Chat POST] Failed to generate analysis session title:", titleError);
          }
        },
      }),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Analysis Chat POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate analysis response", details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
