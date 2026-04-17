import { describe, expect, it } from "vitest";

import {
  MAX_ANALYSIS_MESSAGE_CHARS,
  getAnalysisUIMessageText,
  persistedAnalysisMessagesToUIMessages,
  sanitizeAnalysisMessageContent,
} from "@/lib/analysis/messages";

describe("analysis message helpers", () => {
  it("sanitizes angle brackets and trims to the configured maximum", () => {
    const value = sanitizeAnalysisMessageContent(`  <b>${"x".repeat(MAX_ANALYSIS_MESSAGE_CHARS + 20)}</b>  `);

    expect(value.startsWith("b")).toBe(true);
    expect(value.includes("<")).toBe(false);
    expect(value.includes(">")).toBe(false);
    expect(value.length).toBe(MAX_ANALYSIS_MESSAGE_CHARS);
  });

  it("extracts text from UI message parts", () => {
    const text = getAnalysisUIMessageText({
      parts: [
        { type: "text", text: "Hello" },
        { type: "text", text: " world" },
      ],
    });

    expect(text).toBe("Hello world");
  });

  it("maps persisted records into UI messages", () => {
    const messages = persistedAnalysisMessagesToUIMessages([
      {
        _id: "msg-1",
        role: "assistant",
        content: "Ready to help.",
      },
    ]);

    expect(messages).toEqual([
      {
        id: "msg-1",
        role: "assistant",
        parts: [{ type: "text", text: "Ready to help." }],
      },
    ]);
  });
});
