import { describe, expect, it } from "vitest";

import {
  buildAnalysisDisplayBlocks,
  buildAnalysisRevealEntries,
  getAnalysisAnswerRevealPhase,
  getNextAnalysisRevealDelayMs,
  splitAnalysisTextForReveal,
} from "@/components/analysis/useAnalysisAnswerReveal";
import { buildAnalysisRenderableBlocks } from "@/lib/analysis/renderAnchors";
import type { AnalysisTableCard } from "@/lib/analysis/types";
import type { AnalysisUIMessage as UIMessage } from "@/lib/analysis/ui";

function makeTablePart(toolCallId: string, tableId: string = "q1"): UIMessage["parts"][number] {
  const output: AnalysisTableCard = {
    status: "available",
    tableId,
    title: `${tableId} overall`,
    questionId: tableId.toUpperCase(),
    questionText: "How satisfied are you?",
    tableType: "frequency",
    surveySection: null,
    baseText: "All respondents",
    tableSubtitle: null,
    userNote: null,
    valueMode: "pct",
    columns: [],
    rows: [],
    totalRows: 0,
    totalColumns: 0,
    truncatedRows: 0,
    truncatedColumns: 0,
    focusedCutIds: null,
    requestedCutGroups: null,
    focusedRowKeys: null,
    focusedGroupKeys: null,
    significanceTest: null,
    significanceLevel: null,
    comparisonGroups: [],
    sourceRefs: [],
  };

  return {
    type: "tool-fetchTable",
    toolCallId,
    state: "output-available",
    input: {
      tableId,
      cutGroups: null,
      valueMode: "pct",
    },
    output,
  } as UIMessage["parts"][number];
}

function makeRenderPart(
  tableId: string,
  focus?: {
    rowLabels?: string[];
    groupNames?: string[];
  },
): UIMessage["parts"][number] {
  return {
    type: "data-analysis-render",
    id: `render-${tableId}`,
    data: {
      tableId,
      ...(focus ? { focus } : {}),
    },
  } as UIMessage["parts"][number];
}

describe("useAnalysisAnswerReveal helpers", () => {
  it("keeps sentence boundaries intact for reveal chunking", () => {
    expect(splitAnalysisTextForReveal("Overall is 45%. Next sentence.")).toEqual([
      "Overall is 45%. ",
      "Next sentence.",
    ]);
  });

  it("shows a table shell when the next unreleased entry is a table block", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-shell",
      parts: [
        makeTablePart("tool-1", "q1"),
        { type: "text", text: "Intro.\n\n" },
        makeRenderPart("q1"),
        { type: "text", text: "\n\nClose." },
      ],
    });

    const entries = buildAnalysisRevealEntries(blocks);
    const displayBlocks = buildAnalysisDisplayBlocks(blocks, entries, 1);

    expect(displayBlocks).toEqual([
      expect.objectContaining({
        kind: "text",
        segments: [{ kind: "text", text: "Intro.\n\n" }],
      }),
      expect.objectContaining({ kind: "table", displayState: "shell" }),
    ]);
  });

  it("moves through thinking, handoff, composing, and settled phases for animated live answers", () => {
    expect(getAnalysisAnswerRevealPhase({
      isStreaming: true,
      shouldAnimateReveal: true,
      releasedEntryCount: 0,
      totalEntryCount: 0,
    })).toBe("thinking");

    expect(getAnalysisAnswerRevealPhase({
      isStreaming: true,
      shouldAnimateReveal: true,
      releasedEntryCount: 0,
      totalEntryCount: 2,
    })).toBe("handoff");

    expect(getAnalysisAnswerRevealPhase({
      isStreaming: false,
      shouldAnimateReveal: true,
      releasedEntryCount: 1,
      totalEntryCount: 2,
    })).toBe("composing");

    expect(getAnalysisAnswerRevealPhase({
      isStreaming: false,
      shouldAnimateReveal: true,
      releasedEntryCount: 2,
      totalEntryCount: 2,
    })).toBe("settled");
  });

  it("renders refreshed persisted answers as settled without animation", () => {
    expect(getAnalysisAnswerRevealPhase({
      isStreaming: false,
      shouldAnimateReveal: false,
      releasedEntryCount: 0,
      totalEntryCount: 2,
    })).toBe("settled");
  });

  it("uses longer composed delays for first reveal, paragraph breaks, tables, and post-table settles", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-delays",
      parts: [
        makeTablePart("tool-1", "q1"),
        { type: "text", text: "First sentence.\n\nSecond paragraph.\n\n" },
        makeRenderPart("q1"),
        { type: "text", text: "\n\nWrap up." },
      ],
    });
    const entries = buildAnalysisRevealEntries(blocks);

    expect(getNextAnalysisRevealDelayMs({ releasedEntryCount: 0, entries })).toBe(260);
    expect(getNextAnalysisRevealDelayMs({ releasedEntryCount: 1, entries })).toBe(220);
    expect(getNextAnalysisRevealDelayMs({ releasedEntryCount: 2, entries })).toBe(220);
    expect(getNextAnalysisRevealDelayMs({ releasedEntryCount: 3, entries })).toBe(160);
  });
});
