import { isTextUIPart, type UIMessage } from "ai";

import { stripAnalysisCiteAnchors } from "@/lib/analysis/citeAnchors";
import { stripAnalysisRenderAnchors } from "@/lib/analysis/renderAnchors";
import {
  CONFIRM_CITATION_TOOL_TYPE,
  FETCH_TABLE_TOOL_TYPE,
  isRenderableAnalysisToolType,
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
  artifactId: string,
  payload: AnalysisTableCard,
) {
  return {
    type: "tool-fetchTable" as const,
    toolCallId: artifactId,
    state: "output-available" as const,
    input: {
      tableId: payload.tableId,
      rowFilter: payload.requestedRowFilter,
      cutFilter: payload.requestedCutFilter,
      valueMode: payload.valueMode,
    },
    output: payload,
  };
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
            parts.push(persistedTableCardPart(String(artifact._id), artifact.payload));
          }
          continue;
        }

        if (part.type === CONFIRM_CITATION_TOOL_TYPE && part.toolCallId) {
          const cellSummary = isAnalysisCellSummary(part.cellSummary)
            ? (part.cellSummary as AnalysisCellSummary)
            : null;
          parts.push({
            type: part.type,
            toolCallId: part.toolCallId,
            state: "output-available",
            input: {},
            output: cellSummary
              ? { status: "confirmed", ...cellSummary }
              : undefined,
          } as UIMessage["parts"][number]);
          continue;
        }

        if (
          part.type.startsWith("tool-")
          && isRenderableAnalysisToolType(part.type)
          && part.toolCallId
        ) {
          parts.push({
            type: part.type,
            toolCallId: part.toolCallId,
            state: "output-available",
            input: {},
            output: undefined,
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
    const sanitizedParts = message.parts.reduce<UIMessage["parts"]>((acc, part) => {
      if (isTextUIPart(part)) {
        // Strip both marker families from prior-turn text — cite markers are
        // per-turn contracts, so historical markers are noise in the model's
        // view of history. Keep the surrounding prose.
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

      return acc;
    }, []);

    return {
      ...message,
      parts: sanitizedParts,
    };
  });
}
