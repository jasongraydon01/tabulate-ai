import type { UIMessage } from "ai";

import { api, internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  detectUncitedSpecificNumbers,
  type InjectedAnalysisTableCard,
  resolveAssistantMessageTrust,
} from "@/lib/analysis/claimCheck";
import { buildDeterministicFollowUpSuggestions } from "@/lib/analysis/followups";
import { loadAnalysisGroundingContext } from "@/lib/analysis/grounding";
import {
  getAnalysisUIMessageText,
  normalizePersistedAnalysisArtifactRecord,
  normalizePersistedAnalysisMessageRecord,
  persistedAnalysisMessagesToUIMessages,
  sanitizeAnalysisAssistantMessageContent,
} from "@/lib/analysis/messages";
import {
  buildPersistedAnalysisPartsWithStructuredAssistantParts,
  type PersistedAnalysisPart,
} from "@/lib/analysis/persistence";
import {
  validateAnalysisStructuredRenderParts,
  type AnalysisStructuredRenderValidationIssue,
} from "@/lib/analysis/renderAnchors";
import { streamAnalysisResponse } from "@/lib/analysis/AnalysisAgent";
import {
  extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer,
  getAnalysisTextFromStructuredAssistantParts,
} from "@/lib/analysis/structuredParts";
import {
  FETCH_TABLE_TOOL_TYPE,
  isAllowedAnalysisToolType,
  isHiddenAnalysisToolType,
  SUBMIT_ANSWER_TOOL_TYPE,
} from "@/lib/analysis/toolLabels";
import {
  type AnalysisGroundingRef,
  type AnalysisStructuredAssistantPart,
  isAnalysisTableCard,
} from "@/lib/analysis/types";
import type { AnalysisUIMessage } from "@/lib/analysis/ui";
import { writeAnalysisTurnTrace } from "@/lib/analysis/trace";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { sanitizeHintForPrompt } from "@/lib/promptSanitization";

type PersistedPartForCreate = PersistedAnalysisPart & {
  artifactId?: Id<"analysisArtifacts">;
};

interface PersistAssistantPartsResult {
  persistedParts: PersistedPartForCreate[];
  artifactIdsByToolCallId: Record<string, Id<"analysisArtifacts">>;
}

interface ExistingComputedArtifact {
  _id: Id<"analysisArtifacts">;
  artifactType: "table_card" | "note";
  payload: unknown;
  sourceClass: string;
}

function consumeStream(stream: ReadableStream<unknown>): Promise<void> {
  const reader = stream.getReader();

  async function readNext(): Promise<void> {
    const result = await reader.read();
    if (result.done) return;
    return readNext();
  }

  return readNext().finally(() => {
    reader.releaseLock();
  });
}

function formatRenderValidationIssue(issue: AnalysisStructuredRenderValidationIssue): string {
  return [issue.tableId, issue.reason, issue.detail].filter(Boolean).join(":");
}

function buildFinalAssistantParts(params: {
  originalParts: AnalysisUIMessage["parts"];
  structuredAssistantParts: AnalysisStructuredAssistantPart[];
  injectedTableCards: InjectedAnalysisTableCard[];
}): AnalysisUIMessage["parts"] {
  const nonTextParts = params.originalParts.filter((part) => {
    if (part.type === "text" || part.type.startsWith("data-")) return false;
    if (part.type === "reasoning") return true;
    if (!part.type.startsWith("tool-")) return false;
    return isAllowedAnalysisToolType(part.type)
      && !isHiddenAnalysisToolType(part.type)
      && part.type !== SUBMIT_ANSWER_TOOL_TYPE;
  });
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

  return [
    ...nonTextParts,
    ...injectedParts,
    ...structuredParts,
  ];
}

function buildPersistedGroundingRefs(refs: AnalysisGroundingRef[]): Array<{
  claimId: string;
  claimType: "numeric" | "context" | "cell";
  evidenceKind: "table_card" | "context" | "cell";
  refType: string;
  refId: string;
  label: string;
  anchorId?: string;
  artifactId?: Id<"analysisArtifacts">;
  sourceTableId?: string;
  sourceQuestionId?: string;
  rowKey?: string;
  cutKey?: string;
  renderedInCurrentMessage?: boolean;
}> {
  return refs.map((ref) => ({
    claimId: ref.claimId,
    claimType: ref.claimType,
    evidenceKind: ref.evidenceKind,
    refType: ref.refType,
    refId: ref.refId,
    label: ref.label,
    ...(ref.anchorId ? { anchorId: ref.anchorId } : {}),
    ...(ref.artifactId ? { artifactId: ref.artifactId as unknown as Id<"analysisArtifacts"> } : {}),
    ...(ref.sourceTableId ? { sourceTableId: ref.sourceTableId } : {}),
    ...(ref.sourceQuestionId ? { sourceQuestionId: ref.sourceQuestionId } : {}),
    ...(ref.rowKey ? { rowKey: ref.rowKey } : {}),
    ...(ref.cutKey ? { cutKey: ref.cutKey } : {}),
    ...(typeof ref.renderedInCurrentMessage === "boolean"
      ? { renderedInCurrentMessage: ref.renderedInCurrentMessage }
      : {}),
  }));
}

function applyArtifactIdsToGroundingRefsForPersistence(
  refs: AnalysisGroundingRef[],
  artifactIdsByToolCallId: Record<string, Id<"analysisArtifacts">>,
): Array<ReturnType<typeof buildPersistedGroundingRefs>[number]> {
  return buildPersistedGroundingRefs(refs.map((ref) => {
    const artifactId = ref.anchorId ? artifactIdsByToolCallId[ref.anchorId] : undefined;
    return artifactId ? { ...ref, artifactId: String(artifactId) } : ref;
  }));
}

async function persistAssistantMessageParts(params: {
  parts: AnalysisUIMessage["parts"];
  structuredAssistantParts: AnalysisStructuredAssistantPart[];
  sessionId: Id<"analysisSessions">;
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  createdBy: Id<"users">;
  existingComputedArtifactsByTableId: Map<string, ExistingComputedArtifact>;
}): Promise<PersistAssistantPartsResult> {
  const pending = buildPersistedAnalysisPartsWithStructuredAssistantParts(
    params.parts as UIMessage["parts"],
    params.structuredAssistantParts,
  );
  const persistedParts: PersistedPartForCreate[] = [];
  const artifactIdsByToolCallId: Record<string, Id<"analysisArtifacts">> = {};

  for (const entry of pending) {
    if (entry.kind === "ready") {
      persistedParts.push(entry.part);
      continue;
    }

    const existingComputedArtifact = params.existingComputedArtifactsByTableId.get(entry.artifact.tableId);
    const artifactId = existingComputedArtifact?._id ?? await mutateInternal(internal.analysisArtifacts.create, {
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

function buildDerivedTableContinuationPrompt(params: {
  requestText: string;
  derivedTableId: string;
  sourceTableTitle: string | null;
}): string {
  const requestText = sanitizeHintForPrompt(params.requestText, 1000);
  const sourceTableTitle = params.sourceTableTitle
    ? sanitizeHintForPrompt(params.sourceTableTitle, 300)
    : null;

  return [
    "TabulateAI has just computed a confirmed derived table for the user's roll-up request.",
    "<original-request>",
    requestText,
    "</original-request>",
    `Computed table id: ${params.derivedTableId}`,
    sourceTableTitle ? `Source table: ${sourceTableTitle}` : "",
    "",
    "Use the computed table as grounded evidence. Fetch the computed table, render it in your answer, confirm any cells for numbers you quote, and explain what the roll-up shows in plain research language. Do not mention this automation note.",
  ].filter(Boolean).join("\n");
}

export async function runDerivedTableAnalysisContinuation(params: {
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  sessionId: Id<"analysisSessions">;
  requestedBy: Id<"users">;
  derivedArtifactId: Id<"analysisArtifacts">;
  derivedTableId: string;
  requestText: string;
  sourceTableTitle?: string | null;
  abortSignal?: AbortSignal;
}): Promise<{ assistantMessageId: Id<"analysisMessages"> | null }> {
  const convex = getConvexClient();
  const [run, session, project, persistedMessages, persistedArtifacts] = await Promise.all([
    convex.query(api.runs.get, {
      runId: params.runId,
      orgId: params.orgId,
    }),
    convex.query(api.analysisSessions.getById, {
      orgId: params.orgId,
      sessionId: params.sessionId,
    }),
    convex.query(api.projects.get, {
      projectId: params.projectId,
      orgId: params.orgId,
    }),
    convex.query(api.analysisMessages.listBySession, {
      orgId: params.orgId,
      sessionId: params.sessionId,
    }),
    convex.query(api.analysisArtifacts.listBySession, {
      orgId: params.orgId,
      sessionId: params.sessionId,
    }),
  ]);

  if (!run) throw new Error("Run not found");
  if (!session || session.runId !== params.runId) throw new Error("Analysis session not found");
  if (!project) throw new Error("Project not found");

  const conversationMessages = persistedAnalysisMessagesToUIMessages(
    persistedMessages.map((message) => normalizePersistedAnalysisMessageRecord(message)),
    persistedArtifacts.map((artifact) => normalizePersistedAnalysisArtifactRecord(artifact)),
  );
  const syntheticPrompt = buildDerivedTableContinuationPrompt({
    requestText: params.requestText,
    derivedTableId: params.derivedTableId,
    sourceTableTitle: params.sourceTableTitle ?? null,
  });
  const continuationMessages: AnalysisUIMessage[] = [
    ...conversationMessages,
    {
      id: `derived-table-continuation-${String(params.derivedArtifactId)}`,
      role: "user",
      parts: [{ type: "text", text: syntheticPrompt }],
    },
  ];

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

  const { streamResult, getTraceCapture, getGroundingCapture } = await streamAnalysisResponse({
    messages: continuationMessages,
    groundingContext,
    abortSignal: params.abortSignal,
  });

  type FinalEvent = {
    responseMessage: AnalysisUIMessage;
    isAborted: boolean;
    finishReason?: string;
  };
  let resolveFinalEvent: ((event: FinalEvent | null) => void) | null = null;
  const finalEventPromise = new Promise<FinalEvent | null>((resolve) => {
    resolveFinalEvent = resolve;
  });
  let streamError: unknown = null;

  const uiMessageStream = streamResult.toUIMessageStream<AnalysisUIMessage>({
    originalMessages: continuationMessages,
    sendReasoning: true,
    sendFinish: false,
    onError: (error) => {
      streamError = error;
      resolveFinalEvent?.(null);
      return "Analysis response failed.";
    },
    onFinish: ({ responseMessage, isAborted, finishReason }) => {
      resolveFinalEvent?.({ responseMessage, isAborted, finishReason });
    },
  });
  await consumeStream(uiMessageStream);
  if (streamError) throw streamError;
  const finalEvent = await finalEventPromise;
  if (!finalEvent || finalEvent.isAborted) return { assistantMessageId: null };

  const groundingCapture = getGroundingCapture();
  const extractedAssistantParts = extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer(
    finalEvent.responseMessage.parts,
  );
  if (!extractedAssistantParts.ok) {
    throw new Error(extractedAssistantParts.message);
  }

  const structuredAssistantParts = extractedAssistantParts.parts;
  const effectiveAssistantText = getAnalysisTextFromStructuredAssistantParts(structuredAssistantParts);
  const confirmedCellIds = new Set(groundingCapture
    .map((event) => event.cellSummary?.cellId)
    .filter((id): id is string => typeof id === "string"));
  const citedCellIds = structuredAssistantParts
    .filter((part) => part.type === "cite")
    .flatMap((part) => part.cellIds);
  const unconfirmedCellIds = [...new Set(citedCellIds.filter((cellId) => !confirmedCellIds.has(cellId)))];
  if (unconfirmedCellIds.length > 0) {
    throw new Error(`Analysis continuation failed: cite parts referenced unconfirmed cellIds (${unconfirmedCellIds.join(", ")}).`);
  }

  const renderValidationIssues = validateAnalysisStructuredRenderParts({
    assistantParts: structuredAssistantParts,
    responseParts: finalEvent.responseMessage.parts,
  });
  if (renderValidationIssues.length > 0) {
    throw new Error(
      `Analysis continuation failed: render parts were invalid (${renderValidationIssues.map(formatRenderValidationIssue).join("; ")}).`,
    );
  }

  if (
    detectUncitedSpecificNumbers(effectiveAssistantText)
    && confirmedCellIds.size === 0
    && citedCellIds.length === 0
  ) {
    console.warn("[Analysis continuation] uncited_specific_numbers", {
      sessionId: String(params.sessionId),
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
    injectedTableCards: [],
  });
  const persistedAssistantText = sanitizeAnalysisAssistantMessageContent(
    getAnalysisUIMessageText({ parts: finalResponseParts }),
  );
  const followUpSuggestions = buildDeterministicFollowUpSuggestions({
    groundingContext,
    groundingRefs: trustResult.groundingRefs,
    responseParts: finalResponseParts,
  });
  const traceCapture = getTraceCapture();
  const existingComputedArtifactsByTableId = new Map<string, ExistingComputedArtifact>();
  for (const artifact of persistedArtifacts) {
    if (artifact.sourceClass === "computed_derivation" && isAnalysisTableCard(artifact.payload)) {
      existingComputedArtifactsByTableId.set(artifact.payload.tableId, artifact as ExistingComputedArtifact);
    }
  }

  const { persistedParts, artifactIdsByToolCallId } = await persistAssistantMessageParts({
    parts: finalResponseParts,
    structuredAssistantParts: trustResult.assistantParts,
    sessionId: params.sessionId,
    orgId: params.orgId,
    projectId: params.projectId,
    runId: params.runId,
    createdBy: params.requestedBy,
    existingComputedArtifactsByTableId,
  });
  const persistedGroundingRefs = applyArtifactIdsToGroundingRefsForPersistence(
    trustResult.groundingRefs,
    artifactIdsByToolCallId,
  );
  const persistedContextEvidence = buildPersistedGroundingRefs(trustResult.contextEvidence);
  if (!persistedAssistantText && persistedParts.length === 0) {
    return { assistantMessageId: null };
  }

  const createdAt = new Date().toISOString();
  const assistantMessageId = await mutateInternal(internal.analysisMessages.create, {
    sessionId: params.sessionId,
    orgId: params.orgId,
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
      orgId: String(params.orgId),
      projectId: String(params.projectId),
      runId: String(params.runId),
      sessionId: String(params.sessionId),
      sessionTitle: session.title,
      messageId: String(assistantMessageId),
      createdAt,
      assistantText: persistedAssistantText,
      responseParts: finalResponseParts,
      traceCapture,
    });
  } catch (traceError) {
    console.warn("[Analysis continuation] Failed to write analysis turn trace:", traceError);
  }

  return { assistantMessageId };
}
