import { isTextUIPart, type UIMessage } from "ai";

import { isRenderableAnalysisToolType, TABLE_CARD_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import { isAnalysisTableCard, type AnalysisTableCard } from "@/lib/analysis/types";

export const MAX_ANALYSIS_MESSAGE_CHARS = 4000;

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
  }>;
}

interface PersistedAnalysisArtifactRecord {
  _id: string;
  artifactType: "table_card" | "note";
  payload: unknown;
}

export function sanitizeAnalysisMessageContent(content: string): string {
  return content
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, MAX_ANALYSIS_MESSAGE_CHARS);
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
    type: "tool-getTableCard" as const,
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

        if (part.type === TABLE_CARD_TOOL_TYPE && part.artifactId) {
          const artifact = artifactLookup.get(part.artifactId);
          if (artifact?.artifactType === "table_card" && isAnalysisTableCard(artifact.payload)) {
            parts.push(persistedTableCardPart(String(artifact._id), artifact.payload));
          }
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
        const text = sanitizeAnalysisMessageContent(part.text);
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
