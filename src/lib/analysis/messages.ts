import { isTextUIPart, type UIMessage } from "ai";

export const MAX_ANALYSIS_MESSAGE_CHARS = 4000;

interface PersistedAnalysisMessageRecord {
  _id: string;
  role: "user" | "assistant" | "system";
  content: string;
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

export function persistedAnalysisMessagesToUIMessages(
  messages: PersistedAnalysisMessageRecord[],
): UIMessage[] {
  return messages.map((message) => ({
    id: String(message._id),
    role: message.role,
    parts: [
      {
        type: "text",
        text: message.content,
      },
    ],
  }));
}

export function getSanitizedConversationMessagesForModel(
  messages: UIMessage[],
): UIMessage[] {
  return messages.map((message) => {
    const text = sanitizeAnalysisMessageContent(getAnalysisUIMessageText(message));
    return {
      ...message,
      parts: text.length > 0
        ? [
            {
              type: "text" as const,
              text,
            },
          ]
        : [],
    };
  });
}
