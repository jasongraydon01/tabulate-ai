import { describe, expect, it, vi } from "vitest";

import { createAnalysisScratchpadTool } from "@/lib/analysis/scratchpad";

function executeToolAction(
  scratchpad: ReturnType<typeof createAnalysisScratchpadTool>["tool"],
  action: "add" | "review" | "read",
  content: string,
  toolCallId = "t1",
) {
  if (!scratchpad.execute) throw new Error("Scratchpad tool missing execute");
  return scratchpad.execute(
    { action, content },
    { toolCallId, messages: [], abortSignal: undefined as never },
  );
}

describe("analysis scratchpad tool", () => {
  it("adds reasoning entries and returns confirmation", async () => {
    const { tool: scratchpad, getEntries } = createAnalysisScratchpadTool();

    const result = await executeToolAction(scratchpad, "add", "Searching for awareness tables first.");

    expect(result).toContain("[Thinking]");
    expect(result).toContain("Searching for awareness tables first.");
    expect(getEntries()).toHaveLength(1);
    expect(getEntries()[0].action).toBe("add");
  });

  it("records review entries separately from add entries", async () => {
    const { tool: scratchpad, getEntries } = createAnalysisScratchpadTool();

    await executeToolAction(scratchpad, "add", "Plan: search then retrieve.", "t1");
    const result = await executeToolAction(scratchpad, "review", "Base sizes look adequate.", "t2");

    expect(result).toContain("[Review]");
    expect(getEntries()).toHaveLength(2);
    expect(getEntries()[1].action).toBe("review");
  });

  it("reads back all accumulated entries", async () => {
    const { tool: scratchpad } = createAnalysisScratchpadTool();

    await executeToolAction(scratchpad, "add", "First thought.", "t1");
    await executeToolAction(scratchpad, "add", "Second thought.", "t2");

    const result = await executeToolAction(scratchpad, "read", "reviewing", "t3");

    expect(result).toContain("2 entries");
    expect(result).toContain("First thought.");
    expect(result).toContain("Second thought.");
  });

  it("returns empty message when reading with no entries", async () => {
    const { tool: scratchpad } = createAnalysisScratchpadTool();

    const result = await executeToolAction(scratchpad, "read", "check");

    expect(result).toContain("No entries yet");
  });

  it("returns a copy from getEntries so the internal state is immutable", () => {
    const { getEntries } = createAnalysisScratchpadTool();

    const first = getEntries();
    const second = getEntries();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it("logs to console on add and review actions", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const { tool: scratchpad } = createAnalysisScratchpadTool();

    await executeToolAction(scratchpad, "add", "Testing console output.");

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("[AnalysisAgent Scratchpad] add: Testing console output."),
    );

    consoleSpy.mockRestore();
  });
});
