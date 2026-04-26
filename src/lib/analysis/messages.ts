import {
  isDataUIPart,
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
} from "ai";

import { buildAnalysisStructuredAssistantPartsFromText } from "@/lib/analysis/structuredParts";
import { stripAnalysisCiteAnchors } from "@/lib/analysis/citeAnchors";
import { buildFetchTableModelMarkdown } from "@/lib/analysis/grounding";
import { stripAnalysisRenderAnchors } from "@/lib/analysis/renderAnchors";
import {
  CONFIRM_CITATION_TOOL_TYPE,
  FETCH_TABLE_TOOL_TYPE,
} from "@/lib/analysis/toolLabels";
import {
  type AnalysisUIMessage,
  isAnalysisRenderDataUIPart,
} from "@/lib/analysis/ui";
import type { AnalysisFetchTableCutGroups } from "@/lib/analysis/types";
import {
  type AnalysisStructuredAssistantPart,
  type AnalysisRenderDirectiveFocus,
  isAnalysisCellSummary,
  isAnalysisTableCard,
  type AnalysisCellSummary,
  type AnalysisEvidenceItem,
  type AnalysisGroundingRef,
  type AnalysisMessageMetadata,
  type AnalysisTableCard,
} from "@/lib/analysis/types";

export const MAX_ANALYSIS_MESSAGE_CHARS = 4000;
export const MAX_ANALYSIS_ASSISTANT_MESSAGE_CHARS = 16000;

interface PersistedAnalysisPartRecordInput {
  type: string;
  text?: string;
  tableId?: string;
  focus?: unknown;
  cellIds?: unknown;
  state?: string;
  artifactId?: unknown;
  label?: string;
  toolCallId?: string;
  cellSummary?: unknown;
  input?: unknown;
  output?: unknown;
}

interface PersistedAnalysisPartRecord {
  type: string;
  text?: string;
  tableId?: string;
  focus?: unknown;
  cellIds?: unknown;
  state?: string;
  artifactId?: string;
  label?: string;
  toolCallId?: string;
  cellSummary?: unknown;
  input?: unknown;
  output?: unknown;
}

interface PersistedAnalysisGroundingRefInput {
  claimId: string;
  claimType: "numeric" | "context" | "cell";
  evidenceKind: "table_card" | "context" | "cell";
  refType: string;
  refId: string;
  label: string;
  anchorId?: string | null;
  artifactId?: unknown;
  sourceTableId?: string;
  sourceQuestionId?: string;
  rowKey?: string;
  cutKey?: string;
  renderedInCurrentMessage?: boolean;
}

export interface PersistedAnalysisMessageRecord {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts?: PersistedAnalysisPartRecord[];
  groundingRefs?: AnalysisGroundingRef[];
  followUpSuggestions?: string[];
}

export interface PersistedAnalysisArtifactRecord {
  _id: string;
  artifactType: "table_card" | "note";
  payload: unknown;
}

function normalizePersistedAnalysisPartRecord(
  part: PersistedAnalysisPartRecordInput,
): PersistedAnalysisPartRecord {
  return {
    type: part.type,
    ...(typeof part.text === "string" ? { text: part.text } : {}),
    ...(typeof part.tableId === "string" ? { tableId: part.tableId } : {}),
    ...(part.focus !== undefined ? { focus: part.focus } : {}),
    ...(part.cellIds !== undefined ? { cellIds: part.cellIds } : {}),
    ...(typeof part.state === "string" ? { state: part.state } : {}),
    ...(part.artifactId !== undefined && part.artifactId !== null
      ? { artifactId: String(part.artifactId) }
      : {}),
    ...(typeof part.label === "string" ? { label: part.label } : {}),
    ...(typeof part.toolCallId === "string" ? { toolCallId: part.toolCallId } : {}),
    ...(part.cellSummary !== undefined ? { cellSummary: part.cellSummary } : {}),
    ...(part.input !== undefined ? { input: part.input } : {}),
    ...(part.output !== undefined ? { output: part.output } : {}),
  };
}

function normalizePersistedAnalysisGroundingRef(
  ref: PersistedAnalysisGroundingRefInput,
): AnalysisGroundingRef {
  return {
    claimId: ref.claimId,
    claimType: ref.claimType,
    evidenceKind: ref.evidenceKind,
    refType: ref.refType as AnalysisGroundingRef["refType"],
    refId: ref.refId,
    label: ref.label,
    ...(typeof ref.anchorId === "string" ? { anchorId: ref.anchorId } : {}),
    ...(ref.artifactId !== undefined && ref.artifactId !== null
      ? { artifactId: String(ref.artifactId) }
      : {}),
    ...(typeof ref.sourceTableId === "string" ? { sourceTableId: ref.sourceTableId } : {}),
    ...(typeof ref.sourceQuestionId === "string" ? { sourceQuestionId: ref.sourceQuestionId } : {}),
    ...(typeof ref.rowKey === "string" ? { rowKey: ref.rowKey } : {}),
    ...(typeof ref.cutKey === "string" ? { cutKey: ref.cutKey } : {}),
    ...(typeof ref.renderedInCurrentMessage === "boolean"
      ? { renderedInCurrentMessage: ref.renderedInCurrentMessage }
      : {}),
  };
}

export function normalizePersistedAnalysisMessageRecord(
  message: {
    _id: unknown;
    role: "user" | "assistant" | "system";
    content: string;
    parts?: PersistedAnalysisPartRecordInput[];
    groundingRefs?: PersistedAnalysisGroundingRefInput[];
    followUpSuggestions?: string[];
  },
): PersistedAnalysisMessageRecord {
  return {
    _id: String(message._id),
    role: message.role,
    content: message.content,
    ...(message.parts ? { parts: message.parts.map(normalizePersistedAnalysisPartRecord) } : {}),
    ...(message.groundingRefs
      ? { groundingRefs: message.groundingRefs.map(normalizePersistedAnalysisGroundingRef) }
      : {}),
    ...(message.followUpSuggestions ? { followUpSuggestions: message.followUpSuggestions } : {}),
  };
}

export function normalizePersistedAnalysisArtifactRecord(
  artifact: {
    _id: unknown;
    artifactType: "table_card" | "note";
    payload: unknown;
  },
): PersistedAnalysisArtifactRecord {
  return {
    _id: String(artifact._id),
    artifactType: artifact.artifactType,
    payload: artifact.payload,
  };
}

function normalizeAnalysisLineBreaks(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function normalizeAssistantMarkdown(content: string): string {
  const lines = normalizeAnalysisLineBreaks(content).split("\n");
  const normalized: string[] = [];

  const unorderedBulletOnlyPattern = /^\s*[-*•]\s*$/;
  const orderedBulletOnlyPattern = /^\s*\d+\.\s*$/;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmedLine = line.trim();
    const isStandaloneBullet = unorderedBulletOnlyPattern.test(line) || orderedBulletOnlyPattern.test(line);

    if (!isStandaloneBullet) {
      normalized.push(line);
      continue;
    }

    let nextIndex = index + 1;
    while (nextIndex < lines.length && lines[nextIndex].trim().length === 0) {
      nextIndex += 1;
    }

    if (nextIndex >= lines.length) {
      normalized.push(line);
      continue;
    }

    const nextLine = lines[nextIndex];
    if (unorderedBulletOnlyPattern.test(nextLine) || orderedBulletOnlyPattern.test(nextLine)) {
      normalized.push(line);
      continue;
    }

    const marker = orderedBulletOnlyPattern.test(line)
      ? trimmedLine
      : "-";

    normalized.push(`${marker} ${nextLine.trim()}`);
    index = nextIndex;
  }

  return normalized.join("\n");
}

function sanitizeAnalysisContent(
  content: string,
  options?: {
    maxChars?: number;
    normalizeMarkdown?: boolean;
  },
): string {
  const normalized = options?.normalizeMarkdown
    ? normalizeAssistantMarkdown(content)
    : normalizeAnalysisLineBreaks(content);

  return normalized
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, options?.maxChars ?? MAX_ANALYSIS_MESSAGE_CHARS);
}

export function sanitizeAnalysisMessageContent(content: string): string {
  return sanitizeAnalysisContent(content, { maxChars: MAX_ANALYSIS_MESSAGE_CHARS });
}

export function sanitizeAnalysisAssistantMessageContent(content: string): string {
  return sanitizeAnalysisContent(content, {
    maxChars: MAX_ANALYSIS_ASSISTANT_MESSAGE_CHARS,
    normalizeMarkdown: true,
  });
}

export function buildAnalysisEvidenceItems(
  groundingRefs: AnalysisGroundingRef[] | undefined,
): AnalysisEvidenceItem[] {
  if (!groundingRefs || groundingRefs.length === 0) return [];

  const deduped = new Map<string, AnalysisEvidenceItem>();

  for (const ref of groundingRefs) {
    const key = [
      ref.evidenceKind,
      ref.claimType,
      ref.artifactId ?? "",
      ref.anchorId ?? "",
      ref.refType,
      ref.refId,
      ref.sourceTableId ?? "",
      ref.sourceQuestionId ?? "",
      ref.rowKey ?? "",
      ref.cutKey ?? "",
    ].join("::");

    if (deduped.has(key)) continue;

    deduped.set(key, {
      key,
      claimType: ref.claimType,
      evidenceKind: ref.evidenceKind,
      refType: ref.refType,
      refId: ref.refId,
      label: ref.label,
      anchorId: ref.anchorId ?? null,
      artifactId: ref.artifactId ?? null,
      sourceTableId: ref.sourceTableId ?? null,
      sourceQuestionId: ref.sourceQuestionId ?? null,
      rowKey: ref.rowKey ?? null,
      cutKey: ref.cutKey ?? null,
      renderedInCurrentMessage: ref.renderedInCurrentMessage ?? false,
    });
  }

  return [...deduped.values()];
}

export function getAnalysisMessageMetadata(
  message: Pick<AnalysisUIMessage, "metadata">,
): AnalysisMessageMetadata | null {
  if (!message.metadata || typeof message.metadata !== "object") {
    return null;
  }

  const candidate = message.metadata as AnalysisMessageMetadata;
  if (
    !candidate.hasGroundedClaims
    && (!candidate.evidence || candidate.evidence.length === 0)
    && (!candidate.followUpSuggestions || candidate.followUpSuggestions.length === 0)
  ) {
    return null;
  }

  return candidate;
}

export function getAnalysisMessageFollowUpSuggestions(message: Pick<AnalysisUIMessage, "metadata">): string[] {
  return getAnalysisMessageMetadata(message)?.followUpSuggestions ?? [];
}

function appendRenderBoundaryText(accumulator: string): string {
  if (accumulator.trim().length === 0) {
    return accumulator;
  }

  return `${accumulator}\n\n`;
}

export function getAnalysisUIMessageText(message: Pick<AnalysisUIMessage, "parts">): string {
  let output = "";
  let hasPendingRenderBoundary = false;

  for (const part of message.parts) {
    if (isTextUIPart(part)) {
      const text = part.text;
      if (!text) continue;
      if (hasPendingRenderBoundary) {
        output = appendRenderBoundaryText(output);
        hasPendingRenderBoundary = false;
      }
      output += text;
      continue;
    }

    if (isAnalysisRenderDataUIPart(part)) {
      hasPendingRenderBoundary = true;
    }
  }

  return output.trim();
}

function getRequestedCutGroupsFromToolInput(
  input: unknown,
): AnalysisFetchTableCutGroups | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const record = input as { cutGroups?: unknown };
  if (record.cutGroups === "*") return "*";
  if (!Array.isArray(record.cutGroups)) return null;

  const normalized = record.cutGroups
    .filter((group): group is string => typeof group === "string")
    .map((group) => group.trim())
    .filter((group, index, values) => group.length > 0 && values.indexOf(group) === index);

  return normalized.length > 0 ? normalized : null;
}

function persistedTableCardPart(
  params: {
    artifactId: string;
    toolCallId?: string;
    state?: string;
    input?: unknown;
  },
  payload: AnalysisTableCard,
) {
  return {
    type: "tool-fetchTable" as const,
    toolCallId: params.toolCallId ?? params.artifactId,
    state: (params.state ?? "output-available") as "output-available",
    input: (params.input ?? {
      tableId: payload.tableId,
      cutGroups: payload.requestedCutGroups ?? null,
    }) as Record<string, unknown>,
    output: payload,
  };
}

function extractCellSummary(
  value: unknown,
): AnalysisCellSummary | null {
  if (isAnalysisCellSummary(value)) {
    return value as AnalysisCellSummary;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  if (record.status !== "confirmed") {
    return null;
  }

  const { status: _status, ...cellSummary } = record;
  return isAnalysisCellSummary(cellSummary) ? (cellSummary as AnalysisCellSummary) : null;
}

function extractStructuredAssistantPart(
  part: PersistedAnalysisPartRecord,
): AnalysisStructuredAssistantPart | null {
  if (part.type === "text" && typeof part.text === "string") {
    return { type: "text", text: part.text };
  }

  if (part.type === "render" && typeof part.tableId === "string") {
    return {
      type: "render",
      tableId: part.tableId,
      ...(part.focus && typeof part.focus === "object" && !Array.isArray(part.focus)
        ? { focus: part.focus as AnalysisRenderDirectiveFocus }
        : {}),
    } as AnalysisStructuredAssistantPart;
  }

  if (part.type === "cite" && Array.isArray(part.cellIds)) {
    const cellIds = part.cellIds
      .filter((cellId: unknown): cellId is string => typeof cellId === "string")
      .map((cellId: string) => cellId.trim())
      .filter((cellId: string) => cellId.length > 0);
    return cellIds.length > 0 ? { type: "cite", cellIds } : null;
  }

  return null;
}

export function persistedAnalysisMessagesToUIMessages(
  messages: PersistedAnalysisMessageRecord[],
  artifacts: PersistedAnalysisArtifactRecord[] = [],
): AnalysisUIMessage[] {
  const artifactLookup = new Map(
    artifacts.map((artifact) => [String(artifact._id), artifact] as const),
  );

  return messages.map((message) => ({
    id: String(message._id),
    role: message.role,
    ...((message.groundingRefs && message.groundingRefs.length > 0)
      || (message.followUpSuggestions && message.followUpSuggestions.length > 0)
      ? {
          metadata: {
            ...(message.groundingRefs && message.groundingRefs.length > 0
              ? {
                  hasGroundedClaims: true,
                  evidence: buildAnalysisEvidenceItems(message.groundingRefs),
                }
              : {}),
            ...(message.followUpSuggestions && message.followUpSuggestions.length > 0
              ? { followUpSuggestions: message.followUpSuggestions }
              : {}),
          } satisfies AnalysisMessageMetadata,
        }
      : {}),
    parts: (() => {
      const parts: AnalysisUIMessage["parts"] = [];

      function appendStructuredAssistantPart(part: AnalysisStructuredAssistantPart) {
        if (part.type === "text") {
          parts.push({
            type: "text",
            text: part.text,
          });
          return;
        }

        if (part.type === "render") {
          parts.push({
            type: "data-analysis-render",
            data: {
              tableId: part.tableId,
              ...(part.focus ? { focus: part.focus } : {}),
            },
          });
          return;
        }

        if (part.cellIds.length > 0) {
          parts.push({
            type: "data-analysis-cite",
            data: {
              cellIds: [...part.cellIds],
            },
          });
        }
      }

      function appendLegacyMarkerFallback(text: string) {
        const structuredAssistantParts = buildAnalysisStructuredAssistantPartsFromText(text);
        const hasStructuredNonTextParts = structuredAssistantParts.some((part) => part.type !== "text");
        if (!hasStructuredNonTextParts) {
          parts.push({
            type: "text",
            text,
          });
          return;
        }

        for (const structuredAssistantPart of structuredAssistantParts) {
          appendStructuredAssistantPart(structuredAssistantPart);
        }
      }

      for (const part of message.parts ?? []) {
        const structuredAssistantPart = extractStructuredAssistantPart(part);
        if (structuredAssistantPart) {
          appendStructuredAssistantPart(structuredAssistantPart);
          continue;
        }

        if (part.type === "text" && message.role === "assistant" && typeof part.text === "string") {
          appendLegacyMarkerFallback(part.text);
          continue;
        }

        if (part.type === "reasoning" && part.text) {
          parts.push({
            type: "reasoning",
            text: part.text,
            state: "done",
          });
          continue;
        }

        if (part.type === FETCH_TABLE_TOOL_TYPE && part.artifactId) {
          const artifact = artifactLookup.get(part.artifactId);
          if (artifact?.artifactType === "table_card" && isAnalysisTableCard(artifact.payload)) {
            parts.push(persistedTableCardPart({
              artifactId: String(artifact._id),
              toolCallId: part.toolCallId,
              state: part.state,
              input: part.input,
            }, artifact.payload));
          }
          continue;
        }

        if (part.type.startsWith("tool-") && part.toolCallId) {
          const cellSummary = part.type === CONFIRM_CITATION_TOOL_TYPE
            ? extractCellSummary(part.output)
              ?? (isAnalysisCellSummary(part.cellSummary)
                ? (part.cellSummary as AnalysisCellSummary)
                : null)
            : null;
          parts.push({
            type: part.type,
            toolCallId: part.toolCallId,
            ...(part.state ? { state: part.state } : {}),
            ...(part.input !== undefined ? { input: part.input as Record<string, unknown> } : {}),
            ...(part.output !== undefined
              ? {
                  output: cellSummary
                    ? { status: "confirmed", ...cellSummary }
                    : part.output,
                }
              : {}),
          } as AnalysisUIMessage["parts"][number]);
        }
      }

      if (parts.length === 0 && message.content) {
        if (message.role === "assistant") {
          appendLegacyMarkerFallback(message.content);
        } else {
          parts.push({
            type: "text",
            text: message.content,
          });
        }
      }

      return parts;
    })(),
  }));
}

export function getSanitizedConversationMessagesForModel(
  messages: AnalysisUIMessage[],
): AnalysisUIMessage[] {
  return messages.map((message) => {
    let hasPendingRenderBoundary = false;

    function appendSanitizedText(
      acc: AnalysisUIMessage["parts"],
      text: string,
    ) {
      const prefix = hasPendingRenderBoundary && acc.some(isTextUIPart) ? "\n\n" : "";
      hasPendingRenderBoundary = false;
      const markerFree = stripAnalysisCiteAnchors(stripAnalysisRenderAnchors(`${prefix}${text}`));
      const sanitizedText = sanitizeAnalysisMessageContent(markerFree);
      if (sanitizedText.length > 0) {
        acc.push({
          type: "text",
          text: sanitizedText,
        });
      }
    }

    const sanitizedParts = (message.parts ?? []).reduce<AnalysisUIMessage["parts"]>((acc, part) => {
      if (isTextUIPart(part)) {
        appendSanitizedText(acc, part.text);
        return acc;
      }

      if (isReasoningUIPart(part)) {
        const text = sanitizeAnalysisMessageContent(part.text ?? "");
        if (text.length > 0) {
          acc.push({
            type: "reasoning",
            text,
            state: part.state ?? "done",
          });
        }
        return acc;
      }

      if (isDataUIPart(part)) {
        if (isAnalysisRenderDataUIPart(part)) {
          hasPendingRenderBoundary = true;
        }
        return acc;
      }

      if (isToolUIPart(part)) {
        if (
          part.type === FETCH_TABLE_TOOL_TYPE
          && part.state === "output-available"
          && isAnalysisTableCard(part.output)
        ) {
          acc.push({
            ...part,
            output: buildFetchTableModelMarkdown(part.output, {
              requestedCutGroups: getRequestedCutGroupsFromToolInput("input" in part ? part.input : null),
            }),
          } as AnalysisUIMessage["parts"][number]);
          return acc;
        }
        acc.push(part);
      }
      return acc;
    }, []);

    return {
      ...message,
      parts: sanitizedParts,
    };
  });
}
