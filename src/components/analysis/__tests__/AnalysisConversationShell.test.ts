import { describe, expect, it } from "vitest";

import {
  ANALYSIS_CONVERSATION_INITIAL_SCROLL,
  ANALYSIS_CONVERSATION_RESIZE_SCROLL,
  getNextAnalysisConversationScrollRequestKey,
} from "@/components/analysis/AnalysisConversationShell";

describe("AnalysisConversationShell contract", () => {
  it("opens persisted sessions at the latest turn and uses smooth resize stickiness", () => {
    expect(ANALYSIS_CONVERSATION_INITIAL_SCROLL).toBe("instant");
    expect(ANALYSIS_CONVERSATION_RESIZE_SCROLL).toBe("smooth");
  });

  it("uses monotonic scroll request keys for user-initiated sends", () => {
    expect(getNextAnalysisConversationScrollRequestKey(0)).toBe(1);
    expect(getNextAnalysisConversationScrollRequestKey(41)).toBe(42);
  });
});
