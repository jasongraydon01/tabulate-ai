import {
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";

import { stripAnalysisCiteAnchors } from "@/lib/analysis/citeAnchors";
import { stripAnalysisRenderAnchors } from "@/lib/analysis/renderAnchors";
import {
  CONFIRM_CITATION_TOOL_TYPE,
  FETCH_TABLE_TOOL_TYPE,
} from "@/lib/analysis/toolLabels";
import {
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

interface PersistedAnalysisMessageRecord {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
  parts?: Array<{
    type: string;
    text?: string;
    state?: string;
    artifactId?: string;
    label?: string;
    toolCallId?: string;
    cellSummary?: unknown;
    input?: unknown;
    output?: unknown;
  }>;
  groundingRefs?: AnalysisGroundingRef[];
  followUpSuggestions?: string[];
}

interface PersistedAnalysisArtifactRecord {
  _id: string;
  artifactType: "table_card" | "note";
  payload: unknown;
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
  message: Pick<UIMessage, "metadata">,
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

export function getAnalysisMessageFollowUpSuggestions(message: Pick<UIMessage, "metadata">): string[] {
  return getAnalysisMessageMetadata(message)?.followUpSuggestions ?? [];
}

export function getAnalysisUIMessageText(message: Pick<UIMessage, "parts">): string {
  return message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("")
    .trim();
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
      rowFilter: payload.requestedRowFilter,
      cutFilter: payload.requestedCutFilter,
      valueMode: payload.valueMode,
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

export function persistedAnalysisMessagesToUIMessages(
  messages: PersistedAnalysisMessageRecord[],
  artifacts: PersistedAnalysisArtifactRecord[] = [],
): UIMessage[] {
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
      const parts: UIMessage["parts"] = [];

      for (const part of message.parts ?? []) {
        if (part.type === "text" && part.text) {
          parts.push({
            type: "text",
            text: part.text,
          });
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
          } as UIMessage["parts"][number]);
        }
      }

      if (parts.length === 0 && message.content) {
        parts.push({
          type: "text",
          text: message.content,
        });
      }

      return parts;
    })(),
  }));
}

export function getSanitizedConversationMessagesForModel(
  messages: UIMessage[],
): UIMessage[] {
  return messages.map((message) => {
    const sanitizedParts = (message.parts ?? []).reduce<UIMessage["parts"]>((acc, part) => {
      if (isTextUIPart(part)) {
        // Keep historical prose, but strip marker syntax whose trust contract
        // is scoped to the turn where it was emitted.
        const markerFree = stripAnalysisCiteAnchors(stripAnalysisRenderAnchors(part.text));
        const text = sanitizeAnalysisMessageContent(markerFree);
        if (text.length > 0) {
          acc.push({
            type: "text",
            text,
          });
        }
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

      if (isToolUIPart(part)) {
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
