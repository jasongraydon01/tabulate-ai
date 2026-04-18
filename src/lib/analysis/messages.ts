import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";

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
      const parts = [];

      for (const part of message.parts ?? []) {
        if (part.type === "text" && part.text) {
          parts.push({
            type: "text" as const,
            text: part.text,
          });
          continue;
        }

        if (part.type === "tool-getTableCard" && part.artifactId) {
          const artifact = artifactLookup.get(part.artifactId);
          if (artifact?.artifactType === "table_card" && isAnalysisTableCard(artifact.payload)) {
            parts.push(persistedTableCardPart(String(artifact._id), artifact.payload));
          }
        }
      }

      if (parts.length === 0 && message.content) {
        parts.push({
          type: "text" as const,
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
