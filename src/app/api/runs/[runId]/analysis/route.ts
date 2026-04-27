import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  type FinishReason,
  type InferUIMessageChunk,
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
import { stripAnalysisCiteAnchors } from "@/lib/analysis/citeAnchors";
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
import { stripAnalysisRenderAnchors } from "@/lib/analysis/renderAnchors";
import {
  buildPersistedAnalysisPartsWithStructuredAssistantParts,
  type PersistedAnalysisPart,
} from "@/lib/analysis/persistence";
import {
  extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer,
  getAnalysisTextFromStructuredAssistantParts,
} from "@/lib/analysis/structuredParts";
import { validateAnalysisStructuredRenderParts } from "@/lib/analysis/renderAnchors";
import {
  writeAnalysisTurnErrorTrace,
  writeAnalysisTurnTrace,
} from "@/lib/analysis/trace";
import {
  generateAnalysisSessionTitle,
  isDefaultAnalysisSessionTitle,
} from "@/lib/analysis/title";
import {
  FETCH_TABLE_TOOL_TYPE,
  SUBMIT_ANSWER_TOOL_NAME,
  SUBMIT_ANSWER_TOOL_TYPE,
} from "@/lib/analysis/toolLabels";
import {
  type AnalysisStructuredAssistantPart,
  type AnalysisGroundingRef,
  type AnalysisMessageMetadata,
} from "@/lib/analysis/types";
import { type AnalysisUIMessage } from "@/lib/analysis/ui";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api, internal } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;
const HIDDEN_PROPOSAL_TOOL_NAMES = new Set(["proposeDerivedRun", "proposeRowRollup"]);
const HIDDEN_PROPOSAL_TOOL_TYPES = new Set(["tool-proposeDerivedRun", "tool-proposeRowRollup"]);

function isAnalysisMessageCandidate(value: unknown): value is AnalysisUIMessage[] {
  return Array.isArray(value);
}

type PersistedPartForCreate = PersistedAnalysisPart & {
  artifactId?: Id<"analysisArtifacts">;
};

interface PersistAssistantPartsResult {
  persistedParts: PersistedPartForCreate[];
  artifactIdsByToolCallId: Record<string, Id<"analysisArtifacts">>;
}

class AnalysisTurnFinalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisTurnFinalizationError";
  }
}

function summarizeAssistantResponseForTitle(parts: AnalysisUIMessage["parts"]): string {
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
  stream: ReadableStream<InferUIMessageChunk<AnalysisUIMessage>>,
): ReadableStream<InferUIMessageChunk<AnalysisUIMessage>> {
  const suppressedToolCallIds = new Set<string>();

  return stream.pipeThrough(new TransformStream<
  InferUIMessageChunk<AnalysisUIMessage>,
  InferUIMessageChunk<AnalysisUIMessage>
  >({
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

      if ("toolName" in chunk && chunk.toolName === SUBMIT_ANSWER_TOOL_NAME) {
        if ("toolCallId" in chunk && typeof chunk.toolCallId === "string") {
          suppressedToolCallIds.add(chunk.toolCallId);
        }
        return;
      }

      if (
        "toolName" in chunk
        && typeof chunk.toolName === "string"
        && HIDDEN_PROPOSAL_TOOL_NAMES.has(chunk.toolName)
      ) {
        if ("toolCallId" in chunk && typeof chunk.toolCallId === "string") {
          suppressedToolCallIds.add(chunk.toolCallId);
        }
        return;
      }

      if (
        "toolCallId" in chunk
        && typeof chunk.toolCallId === "string"
        && suppressedToolCallIds.has(chunk.toolCallId)
      ) {
        return;
      }

      controller.enqueue(chunk);
    },
  }));
}

function emitTextPart(
  writer: UIMessageStreamWriter<AnalysisUIMessage>,
  text: string,
  id: string,
) {
  if (!text) return;

  writer.write({ type: "text-start", id });

  const deltas = text
    .split(/(\n{2,})/)
    .map((segment) => segment)
    .filter((segment) => segment.length > 0);

  if (deltas.length === 0) {
    writer.write({ type: "text-delta", id, delta: text });
  } else {
    for (const delta of deltas) {
      writer.write({ type: "text-delta", id, delta });
    }
  }

  writer.write({ type: "text-end", id });
}

function emitInjectedTableCards(
  writer: UIMessageStreamWriter<AnalysisUIMessage>,
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

function emitStructuredAssistantParts(
  writer: UIMessageStreamWriter<AnalysisUIMessage>,
  structuredAssistantParts: AnalysisStructuredAssistantPart[],
) {
  structuredAssistantParts.forEach((part, index) => {
    if (part.type === "text") {
      emitTextPart(writer, part.text, `analysis-final-text-${index}`);
      return;
    }

    if (part.type === "render") {
      writer.write({
        type: "data-analysis-render",
        id: `analysis-render-${index}`,
        data: {
          tableId: part.tableId,
          ...(part.focus ? { focus: part.focus } : {}),
        },
      });
      return;
    }

    writer.write({
      type: "data-analysis-cite",
      id: `analysis-cite-${index}`,
      data: {
        cellIds: [...part.cellIds],
      },
    });
  });
}

function toStreamMetadata(
  groundingRefs: AnalysisGroundingRef[],
  contextEvidence: AnalysisGroundingRef[],
  followUpSuggestions: string[],
): AnalysisMessageMetadata | undefined {
  if (groundingRefs.length === 0 && contextEvidence.length === 0 && followUpSuggestions.length === 0) {
    return undefined;
  }

  return {
    ...(groundingRefs.length > 0
      ? {
          hasGroundedClaims: true,
          evidence: buildAnalysisEvidenceItems(groundingRefs),
        }
      : {}),
    ...(contextEvidence.length > 0
      ? {
          contextEvidence: buildAnalysisEvidenceItems(contextEvidence),
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

function buildPersistedGroundingRefs(
  groundingRefs: AnalysisGroundingRef[],
): Array<Record<string, unknown>> {
  return groundingRefs.map((ref) => buildPersistedGroundingRef(ref, undefined));
}

function describeSubmitAnswerValidationError(
  reason:
    | "missing_submit_answer"
    | "multiple_submit_answers"
    | "submit_answer_not_last"
    | "submit_answer_invalid"
    | "submit_answer_empty"
    | "assistant_text_outside_submit_answer",
): string {
  switch (reason) {
    case "missing_submit_answer":
      return "submit_answer_missing";
    case "multiple_submit_answers":
      return "submit_answer_multiple";
    case "submit_answer_invalid":
      return "submit_answer_invalid";
    case "submit_answer_empty":
      return "submit_answer_empty";
    case "assistant_text_outside_submit_answer":
      return "assistant_text_outside_submit_answer";
    default:
      return "submit_answer_invalid";
  }
}

function formatRenderValidationIssue(issue: ReturnType<typeof validateAnalysisStructuredRenderParts>[number]): string {
  const detail = issue.detail ? ` (${issue.detail})` : "";
  return `${issue.tableId}:${issue.reason}${detail}`;
}

function buildFinalAssistantParts(params: {
  originalParts: AnalysisUIMessage["parts"];
  structuredAssistantParts: AnalysisStructuredAssistantPart[];
  injectedTableCards: InjectedAnalysisTableCard[];
}): AnalysisUIMessage["parts"] {
  const nonTextParts = params.originalParts.filter((part) => (
    part.type !== "text"
    && part.type !== SUBMIT_ANSWER_TOOL_TYPE
    && !HIDDEN_PROPOSAL_TOOL_TYPES.has(part.type)
  ));
  const injectedParts = params.injectedTableCards.map<AnalysisUIMessage["parts"][number]>((entry) => ({
    type: FETCH_TABLE_TOOL_TYPE,
    toolCallId: entry.toolCallId,
    state: "output-available",
    input: {
      tableId: entry.card.tableId,
      cutGroups: entry.card.requestedCutGroups ?? null,
    },
    output: entry.card,
  }));
  const structuredParts = params.structuredAssistantParts.flatMap<AnalysisUIMessage["parts"][number]>((part) => {
    if (part.type === "text") {
      return [{ type: "text", text: part.text }];
    }

    if (part.type === "render") {
      return [{
        type: "data-analysis-render",
        data: {
          tableId: part.tableId,
          ...(part.focus ? { focus: part.focus } : {}),
        },
      }];
    }

    return part.cellIds.length > 0
      ? [{
          type: "data-analysis-cite",
          data: {
            cellIds: [...part.cellIds],
          },
        }]
      : [];
  });

  return [
    ...nonTextParts,
    ...injectedParts,
    ...structuredParts,
  ];
}

async function persistAssistantMessageParts(params: {
  parts: AnalysisUIMessage["parts"];
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
      derivedArtifacts: persistedArtifacts.map((artifact) => ({
        payload: artifact.payload,
        sourceClass: artifact.sourceClass,
      })),
    });

    const {
      streamResult,
      getTraceCapture,
      getGroundingCapture,
    } = await streamAnalysisResponse({
      messages: conversationMessages,
      groundingContext,
      computeProposalContext: {
        orgId: auth.convexOrgId,
        projectId: session.projectId,
        parentRunId: run._id,
        sessionId: session._id,
        requestedBy: auth.convexUserId,
        parentRun: run,
        project,
        session,
      },
      abortSignal: request.signal,
    });

    let errorTraceWritten = false;
    let settledFinalEvent = false;
    let resolveFinalEvent: ((event: {
      responseMessage: AnalysisUIMessage;
      isAborted: boolean;
      finishReason?: FinishReason;
    } | null) => void) | null = null;
    const finalEventPromise = new Promise<{
      responseMessage: AnalysisUIMessage;
      isAborted: boolean;
      finishReason?: FinishReason;
    } | null>((resolve) => {
      resolveFinalEvent = resolve;
    });

    const settleFinalEvent = (event: {
      responseMessage: AnalysisUIMessage;
      isAborted: boolean;
      finishReason?: FinishReason;
    } | null) => {
      if (settledFinalEvent) return;
      settledFinalEvent = true;
      resolveFinalEvent?.(event);
    };

    const persistAnalysisErrorTrace = (params: {
      error: unknown;
      responseMessage?: AnalysisUIMessage;
    }) => {
      if (errorTraceWritten) return;
      errorTraceWritten = true;
      const createdAt = new Date().toISOString();
      const assistantText = params.responseMessage
        ? sanitizeAnalysisAssistantMessageContent(
            getAnalysisUIMessageText(params.responseMessage),
          )
        : undefined;

      void writeAnalysisTurnErrorTrace({
        runResultValue: run.result,
        orgId: String(auth.convexOrgId),
        projectId: String(session.projectId),
        runId: String(session.runId),
        sessionId: String(session._id),
        sessionTitle: session.title,
        createdAt,
        latestUserPrompt: latestUserText,
        errorMessage: params.error instanceof Error ? params.error.message : String(params.error),
        traceCapture: getTraceCapture(),
        ...(assistantText ? { assistantText } : {}),
        ...(params.responseMessage ? { responseParts: params.responseMessage.parts } : {}),
      }).catch((traceError) => {
        console.warn("[Analysis Chat POST] Failed to write analysis error trace:", traceError);
      });
    };

    const handleStreamError = (error: unknown) => {
      console.error("[Analysis Chat POST] Stream error:", error);
      persistAnalysisErrorTrace({ error });

      settleFinalEvent(null);
      return "Analysis response failed. Please try again.";
    };

    const uiMessageStream = streamResult.toUIMessageStream<AnalysisUIMessage>({
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
      stream: createUIMessageStream<AnalysisUIMessage>({
        originalMessages: conversationMessages,
        onError: handleStreamError,
        execute: async ({ writer }) => {
          writer.merge(filterUIStreamForTrustLayer(uiMessageStream));

          const finalEvent = await finalEventPromise;
          if (!finalEvent || finalEvent.isAborted) {
            return;
          }

          try {
            const groundingCapture = getGroundingCapture();
            const extractedAssistantParts = extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer(
              finalEvent.responseMessage.parts,
            );
            if (!extractedAssistantParts.ok) {
              console.warn("[Analysis Chat POST] submit_answer_validation_failed", {
                sessionId: String(session._id),
                reason: describeSubmitAnswerValidationError(extractedAssistantParts.reason),
              });
              throw new AnalysisTurnFinalizationError(extractedAssistantParts.message);
            }

            const structuredAssistantParts = extractedAssistantParts.parts;
            const effectiveAssistantText = getAnalysisTextFromStructuredAssistantParts(
              structuredAssistantParts,
            );
            const confirmedCellIds = new Set(groundingCapture
              .map((event) => event.cellSummary?.cellId)
              .filter((id): id is string => typeof id === "string"));

            const citedCellIds = structuredAssistantParts
              .filter((part) => part.type === "cite")
              .flatMap((part) => part.cellIds);
            const unconfirmedCellIds = [...new Set(citedCellIds.filter((cellId) => !confirmedCellIds.has(cellId)))];
            if (unconfirmedCellIds.length > 0) {
              console.warn("[Analysis Chat POST] unconfirmed_cite_parts", {
                sessionId: String(session._id),
                cellIds: unconfirmedCellIds,
              });
              throw new AnalysisTurnFinalizationError(
                `Analysis turn failed: cite parts referenced unconfirmed cellIds (${unconfirmedCellIds.join(", ")}).`,
              );
            }

            const renderValidationIssues = validateAnalysisStructuredRenderParts({
              assistantParts: structuredAssistantParts,
              responseParts: finalEvent.responseMessage.parts,
            });
            if (renderValidationIssues.length > 0) {
              console.warn("[Analysis Chat POST] invalid_render_parts", {
                sessionId: String(session._id),
                issues: renderValidationIssues.map(formatRenderValidationIssue),
              });
              throw new AnalysisTurnFinalizationError(
                `Analysis turn failed: render parts were invalid (${renderValidationIssues.map(formatRenderValidationIssue).join("; ")}).`,
              );
            }

            if (
              detectUncitedSpecificNumbers(effectiveAssistantText)
              && confirmedCellIds.size === 0
              && citedCellIds.length === 0
            ) {
              console.warn("[Analysis Chat POST] uncited_specific_numbers", {
                sessionId: String(session._id),
              });
            }

            const trustResult = resolveAssistantMessageTrust({
              assistantParts: structuredAssistantParts,
              responseParts: finalEvent.responseMessage.parts,
              groundingEvents: groundingCapture,
            });

            const finalResponseParts = buildFinalAssistantParts({
              originalParts: finalEvent.responseMessage.parts,
              structuredAssistantParts: trustResult.assistantParts,
              injectedTableCards: trustResult.injectedTableCards,
            });
            const persistedAssistantText = sanitizeAnalysisAssistantMessageContent(
              getAnalysisUIMessageText({ parts: finalResponseParts }),
            );
            const followUpSuggestions = buildDeterministicFollowUpSuggestions({
              groundingContext,
              groundingRefs: trustResult.groundingRefs,
              responseParts: finalResponseParts,
            });
            const assistantTitleBasis = persistedAssistantText || summarizeAssistantResponseForTitle(finalResponseParts);
            const traceCapture = getTraceCapture();

            const streamMetadata = toStreamMetadata(
              trustResult.groundingRefs,
              trustResult.contextEvidence,
              followUpSuggestions,
            );
            emitInjectedTableCards(writer, trustResult.injectedTableCards);
            emitStructuredAssistantParts(writer, trustResult.assistantParts);
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
            const persistedContextEvidence = buildPersistedGroundingRefs(trustResult.contextEvidence);
            if (!persistedAssistantText && persistedParts.length === 0) return;

            const createdAt = new Date().toISOString();
            const assistantMessageId = await mutateInternal(internal.analysisMessages.create, {
              sessionId: session._id,
              orgId: auth.convexOrgId,
              role: "assistant",
              content: persistedAssistantText,
              ...(persistedParts.length > 0 ? { parts: persistedParts } : {}),
              ...(persistedGroundingRefs.length > 0 ? { groundingRefs: persistedGroundingRefs } : {}),
              ...(persistedContextEvidence.length > 0 ? { contextEvidence: persistedContextEvidence } : {}),
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
          } catch (error) {
            persistAnalysisErrorTrace({
              error,
              responseMessage: finalEvent.responseMessage,
            });
            throw error;
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
