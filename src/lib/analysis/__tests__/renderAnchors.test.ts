import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import type { AnalysisTableCard } from "@/lib/analysis/types";

import {
  buildAnalysisRenderableBlocks,
  buildAnalysisRenderMarker,
  extractAnalysisRenderMarkers,
  stripAnalysisRenderAnchors,
  stripInvalidAnalysisRenderMarkers,
  validateAnalysisRenderMarkers,
} from "@/lib/analysis/renderAnchors";

type FetchTablePartFixture = {
  type: "tool-fetchTable";
  toolCallId: string;
  state: "output-available";
  input: {
    tableId: string;
    cutGroups: string[] | "*" | null;
    valueMode: "pct";
  };
  output: AnalysisTableCard;
};

function makeTablePart(toolCallId: string, tableId: string = "q1"): FetchTablePartFixture {
  return {
    type: "tool-fetchTable",
    toolCallId,
    state: "output-available",
    input: {
      tableId,
      cutGroups: null,
      valueMode: "pct",
    },
    output: {
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
    },
  };
}

describe("analysis render markers", () => {
  it("builds the expected marker form", () => {
    expect(buildAnalysisRenderMarker("A3")).toBe("[[render tableId=A3]]");
  });

  it("strips render markers from assistant text", () => {
    expect(stripAnalysisRenderAnchors("Before\n[[render tableId=A3]]\nAfter")).toBe("Before\n\nAfter");
  });

  it("places the table card at the marker position when tableId matches", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-1",
      parts: [
        makeTablePart("tool-1", "A3"),
        { type: "text", text: "Intro\n\n[[render tableId=A3]]\n\nClose" },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "table", "text"]);
    expect(blocks[0]).toEqual(expect.objectContaining({ kind: "text", text: "Intro" }));
    expect(blocks[1]).toEqual(expect.objectContaining({ kind: "table" }));
    expect(blocks[2]).toEqual(expect.objectContaining({ kind: "text", text: "Close" }));
  });

  it("accepts quoted tableIds in markers", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-1q",
      parts: [
        makeTablePart("tool-q", "A3"),
        { type: "text", text: `Before\n\n[[render tableId="A3"]]\n\nAfter` },
      ],
    });
    expect(blocks.map((block) => block.kind)).toEqual(["text", "table", "text"]);
  });

  it("appends unreferenced table cards after the prose when no marker points at them", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-2",
      parts: [
        makeTablePart("tool-1", "A3"),
        { type: "text", text: "No marker here." },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "table"]);
  });

  it("emits a missing block when the marker's tableId was not fetched this turn (stream settled)", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-m",
      parts: [
        { type: "text", text: "Ref\n\n[[render tableId=Z9]]\n\nEnd" },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "missing", "text"]);
    expect(blocks[1]).toEqual(expect.objectContaining({ kind: "missing", tableId: "Z9" }));
  });

  it("emits a placeholder (not missing) for unresolved markers while still streaming", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-s",
      parts: [
        { type: "text", text: "Ref\n\n[[render tableId=A3]]\n\nEnd" },
      ],
    }, { isStreaming: true });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "placeholder", "text"]);
  });

  it("hides fetched tables while text hasn't arrived yet during streaming", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-3",
      parts: [makeTablePart("tool-1", "A3")],
    }, { isStreaming: true });

    expect(blocks).toEqual([]);
  });

  it("extracts every marker occurrence with its raw text and tableId", () => {
    const text = "First [[render tableId=A3]] then [[render tableId=\"B4\"]] end.";
    expect(extractAnalysisRenderMarkers(text)).toEqual([
      { tableId: "A3", raw: "[[render tableId=A3]]" },
      { tableId: "B4", raw: "[[render tableId=\"B4\"]]" },
    ]);
  });

  it("resolves semantic rowLabels and fetched groupNames into render focus", () => {
    const basePart = makeTablePart("tool-1", "A3");
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-focus",
      parts: [
        {
          ...basePart,
          input: {
            tableId: "A3",
            cutGroups: ["Gender"],
            valueMode: "pct",
          },
          output: {
            ...basePart.output,
            columnGroups: [
              { groupKey: "__total__", groupName: "Total", columns: [] },
              { groupKey: "group:gender", groupName: "Gender", columns: [] },
              { groupKey: "group:region", groupName: "Region", columns: [] },
            ],
            rows: [
              { rowKey: "row_aware", label: "Aware", indent: 0, isNet: false, values: [] },
              { rowKey: "row_unaware", label: "Unaware", indent: 0, isNet: false, values: [] },
            ],
          },
        } as UIMessage["parts"][number],
        { type: "text", text: '[[render tableId=A3 rowLabels=["Aware"] groupNames=["Gender"]]]' },
      ],
    });

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "table",
        focus: {
          focusedRowKeys: ["row_aware"],
          focusedGroupKeys: ["group:gender"],
        },
      }),
    ]);
  });

  it("drops group focus when the group was not fetched as evidence", () => {
    const basePart = makeTablePart("tool-1", "A3");
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-focus-miss",
      parts: [
        {
          ...basePart,
          output: {
            ...basePart.output,
            columnGroups: [
              { groupKey: "__total__", groupName: "Total", columns: [] },
              { groupKey: "group:gender", groupName: "Gender", columns: [] },
            ],
            rows: [
              { rowKey: "row_aware", label: "Aware", indent: 0, isNet: false, values: [] },
            ],
          },
        } as UIMessage["parts"][number],
        { type: "text", text: '[[render tableId=A3 rowLabels=["Aware"] groupNames=["Gender"]]]' },
      ],
    });

    expect(blocks).toEqual([
      expect.objectContaining({
        kind: "table",
        focus: {
          focusedRowKeys: ["row_aware"],
          focusedGroupKeys: [],
        },
      }),
    ]);
  });

  it("validates markers against fetched and catalog id sets", () => {
    const text = "Here [[render tableId=A3]] and [[render tableId=B4]] plus [[render tableId=Z9]].";
    const issues = validateAnalysisRenderMarkers({
      text,
      fetchedTableIds: ["A3"],
      catalogTableIds: ["A3", "B4"],
    });
    expect(issues).toEqual([
      { tableId: "B4", raw: "[[render tableId=B4]]", reason: "not_fetched_this_turn" },
      { tableId: "Z9", raw: "[[render tableId=Z9]]", reason: "not_in_run" },
    ]);
  });

  it("returns no issues when every marker is fetched and in the catalog", () => {
    const issues = validateAnalysisRenderMarkers({
      text: "Answer: [[render tableId=A3]].",
      fetchedTableIds: ["A3"],
      catalogTableIds: ["A3", "B4"],
    });
    expect(issues).toEqual([]);
  });

  it("strips only the invalid marker occurrences and keeps valid ones", () => {
    const text = "Good [[render tableId=A3]] bad [[render tableId=Z9]] end.";
    const issues = validateAnalysisRenderMarkers({
      text,
      fetchedTableIds: ["A3"],
      catalogTableIds: ["A3"],
    });
    expect(stripInvalidAnalysisRenderMarkers(text, issues))
      .toBe("Good [[render tableId=A3]] bad  end.");
  });

  it("resolves multiple markers pointing at different tableIds in order", () => {
    const blocks = buildAnalysisRenderableBlocks({
      id: "assistant-4",
      parts: [
        makeTablePart("tool-1", "A3"),
        makeTablePart("tool-2", "B4"),
        { type: "text", text: "First:\n\n[[render tableId=A3]]\n\nSecond:\n\n[[render tableId=B4]]" },
      ],
    });

    expect(blocks.map((block) => block.kind)).toEqual(["text", "table", "text", "table"]);
  });
});
