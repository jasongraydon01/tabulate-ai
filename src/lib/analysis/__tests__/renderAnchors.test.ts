import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";

import {
  ANALYSIS_TABLE_RENDER_ANCHOR,
  buildAnalysisRenderableBlocks,
  stripAnalysisRenderAnchors,
} from "@/lib/analysis/renderAnchors";

function makeTablePart(toolCallId: string): UIMessage["parts"][number] {
  return {
    type: "tool-getTableCard",
    toolCallId,
    state: "output-available",
    input: {
      tableId: "q1",
      rowFilter: null,
      cutFilter: null,
      valueMode: "pct",
    },
    output: {
      status: "available",
      tableId: "q1",
      title: "Q1 overall",
      questionId: "Q1",
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
      requestedRowFilter: null,
      requestedCutFilter: null,
      significanceTest: null,
      significanceLevel: null,
      comparisonGroups: [],
      sourceRefs: [],
    },
  } as UIMessage["parts"][number];
}

describe("analysis render anchors", () => {
  it("strips render anchors from assistant text", () => {
    expect(stripAnalysisRenderAnchors(`Before\n${ANALYSIS_TABLE_RENDER_ANCHOR}\nAfter`)).toBe("Before\n\nAfter");
  });

  it("places table cards at render anchors in text order", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-1",
      parts: [
        makeTablePart("tool-1"),
        { type: "text", text: `Intro\n\n${ANALYSIS_TABLE_RENDER_ANCHOR}\n\nClose` },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "table", "text"]);
    expect(blocks[0]).toEqual(expect.objectContaining({ kind: "text", text: "Intro" }));
    expect(blocks[1]).toEqual(expect.objectContaining({ kind: "table" }));
    expect(blocks[2]).toEqual(expect.objectContaining({ kind: "text", text: "Close" }));
  });

  it("appends unanchored table cards after the prose block", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-2",
      parts: [
        makeTablePart("tool-1"),
        { type: "text", text: "No anchor here." },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "table"]);
  });

  it("hides streamed table cards until text arrives when no anchor can be resolved yet", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-3",
      parts: [makeTablePart("tool-1")],
    }, { isStreaming: true });

    expect(blocks).toEqual([]);
  });

  it("reserves an anchored slot while the table card is still pending in the stream", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-4",
      parts: [{ type: "text", text: `Intro\n\n${ANALYSIS_TABLE_RENDER_ANCHOR}\n\nClose` }],
    }, { isStreaming: true });

    expect(blocks).toEqual([
      expect.objectContaining({ kind: "text", text: "Intro" }),
      expect.objectContaining({ kind: "placeholder" }),
      expect.objectContaining({ kind: "text", text: "Close" }),
    ]);
  });
});
