import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  hasVisibleAnalysisMessageParts,
  shouldShowAnalysisMessageActions,
  shouldShowAnalysisPendingState,
} from "@/components/analysis/AnalysisThread";

describe("AnalysisThread action visibility", () => {
  it("shows actions for the latest assistant turn when nothing follows it", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "What stands out?" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Here is the answer." }] },
    ];

    expect(shouldShowAnalysisMessageActions(messages, 1)).toBe(true);
  });

  it("hides actions for an assistant turn once a later user message exists", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "What stands out?" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "Here is the answer." }] },
      { id: "user-2", role: "user", parts: [{ type: "text", text: "Make that tighter." }] },
    ];

    expect(shouldShowAnalysisMessageActions(messages, 1)).toBe(false);
  });

  it("hides actions on older assistant turns when a newer assistant response exists", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "First question" }] },
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "First answer" }] },
      { id: "user-2", role: "user", parts: [{ type: "text", text: "Follow-up" }] },
      { id: "assistant-2", role: "assistant", parts: [{ type: "text", text: "Second answer" }] },
    ];

    expect(shouldShowAnalysisMessageActions(messages, 1)).toBe(false);
    expect(shouldShowAnalysisMessageActions(messages, 3)).toBe(true);
  });
});

describe("AnalysisThread pending state", () => {
  it("shows the pending state while submitted before an assistant message exists", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "What stands out?" }] },
    ];

    expect(shouldShowAnalysisPendingState(messages, "submitted")).toBe(true);
  });

  it("keeps the pending state visible while streaming if the assistant shell has no visible parts yet", () => {
    const messages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "What stands out?" }] },
      { id: "assistant-1", role: "assistant", parts: [] },
    ];

    expect(shouldShowAnalysisPendingState(messages, "streaming")).toBe(true);
  });

  it("hides the pending state once the assistant has visible reasoning or tool activity", () => {
    const reasoningMessage: UIMessage = {
      id: "assistant-reasoning",
      role: "assistant",
      parts: [{ type: "reasoning", text: "Checking the age cuts first." }],
    };
    const toolMessage: UIMessage = {
      id: "assistant-tool",
      role: "assistant",
      parts: [
        {
          type: "tool-searchRunCatalog",
          toolCallId: "search-1",
          state: "input-available",
          input: { query: "awareness" },
        } as UIMessage["parts"][number],
      ],
    };

    expect(hasVisibleAnalysisMessageParts(reasoningMessage)).toBe(true);
    expect(hasVisibleAnalysisMessageParts(toolMessage)).toBe(true);
    expect(shouldShowAnalysisPendingState([reasoningMessage], "streaming")).toBe(false);
    expect(shouldShowAnalysisPendingState([toolMessage], "streaming")).toBe(false);
  });

  it("treats whitespace-only text and reasoning parts as not yet visible", () => {
    const message: UIMessage = {
      id: "assistant-empty",
      role: "assistant",
      parts: [
        { type: "text", text: "   " },
        { type: "reasoning", text: "   " },
      ],
    };

    expect(hasVisibleAnalysisMessageParts(message)).toBe(false);
    expect(shouldShowAnalysisPendingState([message], "streaming")).toBe(true);
  });
});
