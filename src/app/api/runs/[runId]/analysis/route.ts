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
  resolveAssistantMessageTrust,
  type AnalysisSessionTableArtifact,
  type InjectedAnalysisTableCard,
} from "@/lib/analysis/claimCheck";
import { loadAnalysisGroundingContext } from "@/lib/analysis/grounding";
import {
  buildAnalysisEvidenceItems,
  getAnalysisUIMessageText,
  persistedAnalysisMessagesToUIMessages,
  sanitizeAnalysisAssistantMessageContent,
  sanitizeAnalysisMessageContent,
} from "@/lib/analysis/messages";
import {
  buildPersistedAnalysisParts,
  type PersistedAnalysisPart,
} from "@/lib/analysis/persistence";
import {
  writeAnalysisTurnErrorTrace,
  writeAnalysisTurnTrace,
} from "@/lib/analysis/trace";
import {
  generateAnalysisSessionTitle,
  isDefaultAnalysisSessionTitle,
} from "@/lib/analysis/title";
import { TABLE_CARD_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import { isAnalysisTableCard, type AnalysisGroundingRef, type AnalysisMessageMetadata } from "@/lib/analysis/types";
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
      const text = sanitizeAnalysisMessageContent(part.text);
      if (text) segments.push(text);
      continue;
    }

    if (part.type === TABLE_CARD_TOOL_TYPE) {
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

function buildPriorTableArtifacts(
  persistedArtifacts: Array<{
    _id: Id<"analysisArtifacts">;
    artifactType: "table_card" | "note";
    title: string;
    sourceTableIds: string[];
    sourceQuestionIds: string[];
    payload: unknown;
  }>,
): AnalysisSessionTableArtifact[] {
  return persistedArtifacts.flatMap((artifact) => {
    if (artifact.artifactType !== "table_card") return [];

    return [{
      artifactId: String(artifact._id),
      title: artifact.title,
      sourceTableIds: artifact.sourceTableIds,
      sourceQuestionIds: artifact.sourceQuestionIds,
      payload: isAnalysisTableCard(artifact.payload) ? artifact.payload : null,
    }];
  });
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
      toolName: "getTableCard",
      input: {
        tableId: injected.card.tableId,
        rowFilter: injected.card.requestedRowFilter,
        cutFilter: injected.card.requestedCutFilter,
        valueMode: injected.card.valueMode,
      },
    });
    writer.write({
      type: "tool-output-available",
      toolCallId: injected.toolCallId,
      output: injected.card,
    });
  }
}

function toStreamMetadata(groundingRefs: AnalysisGroundingRef[]): AnalysisMessageMetadata | undefined {
  if (groundingRefs.length === 0) return undefined;

  return {
    hasGroundedClaims: true,
    evidence: buildAnalysisEvidenceItems(groundingRefs),
  };
}

function applyArtifactIdsToGroundingRefsForPersistence(
  groundingRefs: AnalysisGroundingRef[],
  artifactIdsByToolCallId: Record<string, Id<"analysisArtifacts">>,
): Array<AnalysisGroundingRef & { artifactId?: Id<"analysisArtifacts"> }> {
  return groundingRefs.map((ref) => {
    const artifactId = ref.anchorId ? artifactIdsByToolCallId[ref.anchorId] : undefined;
    if (!artifactId) {
      return {
        ...ref,
        ...(ref.artifactId && ref.artifactId !== null
          ? { artifactId: ref.artifactId as unknown as Id<"analysisArtifacts"> }
          : {}),
      } as AnalysisGroundingRef & { artifactId?: Id<"analysisArtifacts"> };
    }

    return {
      ...ref,
      artifactId,
      anchorId: String(artifactId),
      renderedInCurrentMessage: true,
    } as AnalysisGroundingRef & { artifactId?: Id<"analysisArtifacts"> };
  });
}

function normalizeGroundingRefForUI(ref: {
  claimId: string;
  claimType: "numeric" | "context";
  evidenceKind: "table_card" | "context";
  refType: string;
  refId: string;
  label: string;
  anchorId?: string;
  artifactId?: Id<"analysisArtifacts">;
  sourceTableId?: string;
  sourceQuestionId?: string;
  renderedInCurrentMessage?: boolean;
}): AnalysisGroundingRef {
  return {
    claimId: ref.claimId,
    claimType: ref.claimType,
    evidenceKind: ref.evidenceKind,
    refType: ref.refType as AnalysisGroundingRef["refType"],
    refId: ref.refId,
    label: ref.label,
    ...(ref.anchorId ? { anchorId: ref.anchorId } : {}),
    ...(ref.artifactId ? { artifactId: String(ref.artifactId) } : {}),
    ...(ref.sourceTableId ? { sourceTableId: ref.sourceTableId } : {}),
    ...(ref.sourceQuestionId ? { sourceQuestionId: ref.sourceQuestionId } : {}),
    ...(typeof ref.renderedInCurrentMessage === "boolean"
      ? { renderedInCurrentMessage: ref.renderedInCurrentMessage }
      : {}),
  };
}

function buildFinalAssistantParts(params: {
  originalParts: UIMessage["parts"];
  assistantText: string;
  injectedTableCards: InjectedAnalysisTableCard[];
}): UIMessage["parts"] {
  const nonTextParts = params.originalParts.filter((part) => part.type !== "text");
  const injectedParts = params.injectedTableCards.map<UIMessage["parts"][number]>((entry) => ({
    type: TABLE_CARD_TOOL_TYPE,
    toolCallId: entry.toolCallId,
    state: "output-available",
    input: {
      tableId: entry.card.tableId,
      rowFilter: entry.card.requestedRowFilter,
      cutFilter: entry.card.requestedCutFilter,
      valueMode: entry.card.valueMode,
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
  sessionId: Id<"analysisSessions">;
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  createdBy: Id<"users">;
}): Promise<PersistAssistantPartsResult> {
  const pending = buildPersistedAnalysisParts(params.parts);
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
      type: TABLE_CARD_TOOL_TYPE,
      state: entry.template.state,
      artifactId,
      label: entry.template.label,
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
      persistedMessages.map((message) => ({
        _id: String(message._id),
        role: message.role,
        content: message.content,
        groundingRefs: message.groundingRefs?.map(normalizeGroundingRefForUI),
        parts: message.parts?.map((part) => ({
          type: part.type,
          text: part.text,
          state: part.state,
          artifactId: part.artifactId ? String(part.artifactId) : undefined,
          label: part.label,
          toolCallId: part.toolCallId,
        })),
      })),
      persistedArtifacts.map((artifact) => ({
        _id: String(artifact._id),
        artifactType: artifact.artifactType,
        payload: artifact.payload,
      })),
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

    const priorTableArtifacts = buildPriorTableArtifacts(
      persistedArtifacts.map((artifact) => ({
        _id: artifact._id,
        artifactType: artifact.artifactType,
        title: artifact.title,
        sourceTableIds: artifact.sourceTableIds,
        sourceQuestionIds: artifact.sourceQuestionIds,
        payload: artifact.payload,
      })),
    );

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
          const trustResult = resolveAssistantMessageTrust({
            assistantText: rawAssistantText,
            responseParts: finalEvent.responseMessage.parts,
            groundingEvents: getGroundingCapture(),
            priorTableArtifacts,
          });

          const finalResponseParts = buildFinalAssistantParts({
            originalParts: finalEvent.responseMessage.parts,
            assistantText: trustResult.assistantText,
            injectedTableCards: trustResult.injectedTableCards,
          });
          const assistantTitleBasis = trustResult.assistantText || summarizeAssistantResponseForTitle(finalResponseParts);
          const traceCapture = getTraceCapture();

          const streamMetadata = toStreamMetadata(trustResult.groundingRefs);
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
          if (!trustResult.assistantText && persistedParts.length === 0) return;

          const createdAt = new Date().toISOString();
          const assistantMessageId = await mutateInternal(internal.analysisMessages.create, {
            sessionId: session._id,
            orgId: auth.convexOrgId,
            role: "assistant",
            content: trustResult.assistantText,
            ...(persistedParts.length > 0 ? { parts: persistedParts } : {}),
            ...(persistedGroundingRefs.length > 0 ? { groundingRefs: persistedGroundingRefs } : {}),
            agentMetrics: {
              model: traceCapture.usage.model,
              inputTokens: traceCapture.usage.inputTokens,
              outputTokens: traceCapture.usage.outputTokens,
              durationMs: traceCapture.usage.durationMs,
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
              assistantText: trustResult.assistantText,
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
