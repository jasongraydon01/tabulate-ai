import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import { shouldShowAnalysisMessageActions } from "@/components/analysis/AnalysisThread";

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
