import { describe, expect, it } from "vitest";

import { buildPersistedAnalysisParts } from "@/lib/analysis/persistence";
import type { UIMessage } from "ai";

function makeTableCardPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
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
    columnGroups: [
      { groupKey: "__total__", groupName: "Total", columns: [] },
    ],
    rows: [],
    totalRows: 0,
    totalColumns: 0,
    truncatedRows: 0,
    truncatedColumns: 0,
    defaultScope: "total_only",
    initialVisibleRowCount: 0,
    initialVisibleGroupCount: 0,
    hiddenRowCount: 0,
    hiddenGroupCount: 0,
    focusedCutIds: null,
    requestedRowFilter: null,
    requestedCutFilter: null,
    significanceTest: null,
    significanceLevel: null,
    comparisonGroups: [],
    sourceRefs: [],
    ...overrides,
  };
}

describe("buildPersistedAnalysisParts", () => {
  it("keeps sanitized text parts and drops empty ones", () => {
    const parts: UIMessage["parts"] = [
      { type: "text", text: "  <b>Hello</b>  " },
      { type: "text", text: "   " },
    ];

    const pending = buildPersistedAnalysisParts(parts);

    expect(pending).toEqual([
      { kind: "ready", part: { type: "text", text: "bHello/b" } },
    ]);
  });

  it("keeps reasoning parts with state normalized to 'done' when unset", () => {
    const parts: UIMessage["parts"] = [
      { type: "reasoning", text: "Thinking about base sizes." },
    ];

    const pending = buildPersistedAnalysisParts(parts);

    expect(pending).toEqual([
      {
        kind: "ready",
        part: { type: "reasoning", text: "Thinking about base sizes.", state: "done" },
      },
    ]);
  });

  it("drops reasoning parts with whitespace-only text", () => {
    const parts: UIMessage["parts"] = [
      { type: "reasoning", text: "   " },
      { type: "reasoning", text: "" },
    ];

    expect(buildPersistedAnalysisParts(parts)).toEqual([]);
  });

  it("persists standard tool parts with input and output", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "tool-searchRunCatalog",
        toolCallId: "call-1",
        state: "output-available",
        input: { query: "satisfaction" },
        output: { matches: [] },
      } as UIMessage["parts"][number],
      {
        type: "tool-listBannerCuts",
        toolCallId: "call-2",
        state: "output-available",
        input: { filter: "age" },
        output: { groups: [] },
      } as UIMessage["parts"][number],
    ];

    const pending = buildPersistedAnalysisParts(parts);

    expect(pending).toEqual([
      {
        kind: "ready",
        part: {
          type: "tool-searchRunCatalog",
          state: "output-available",
          toolCallId: "call-1",
          input: { query: "satisfaction" },
          output: { matches: [] },
        },
      },
      {
        kind: "ready",
        part: {
          type: "tool-listBannerCuts",
          state: "output-available",
          toolCallId: "call-2",
          input: { filter: "age" },
          output: { groups: [] },
        },
      },
    ]);
  });

  it("persists arbitrary tool parts when they carry a toolCallId", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "tool-someNewThing",
        toolCallId: "call-x",
        state: "input-available",
        input: { questionId: "Q1" },
      } as UIMessage["parts"][number],
    ];

    expect(buildPersistedAnalysisParts(parts)).toEqual([
      {
        kind: "ready",
        part: {
          type: "tool-someNewThing",
          state: "input-available",
          toolCallId: "call-x",
          input: { questionId: "Q1" },
        },
      },
    ]);
  });

  it("emits a tableCard entry with artifact metadata for output-available getTableCard parts", () => {
    const payload = makeTableCardPayload();
    const parts: UIMessage["parts"] = [
      {
        type: "tool-fetchTable",
        toolCallId: "call-table",
        state: "output-available",
        input: { tableId: "q1" },
        output: payload,
      } as UIMessage["parts"][number],
    ];

    const pending = buildPersistedAnalysisParts(parts);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual({
      kind: "tableCard",
      template: {
        state: "output-available",
        label: "Q1 overall",
        toolCallId: "call-table",
        input: { tableId: "q1" },
      },
      artifact: {
        title: "Q1 overall",
        tableId: "q1",
        questionId: "Q1",
        payload,
      },
    });
  });

  it("persists getTableCard parts inline when no artifact-backed table card is available", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "tool-fetchTable",
        toolCallId: "call-table",
        state: "input-available",
        input: { tableId: "q1" },
      } as UIMessage["parts"][number],
    ];

    expect(buildPersistedAnalysisParts(parts)).toEqual([
      {
        kind: "ready",
        part: {
          type: "tool-fetchTable",
          state: "input-available",
          toolCallId: "call-table",
          input: { tableId: "q1" },
        },
      },
    ]);
  });

  it("persists getTableCard parts inline when the output is not a valid analysis table card", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "tool-fetchTable",
        toolCallId: "call-table",
        state: "output-available",
        input: { tableId: "q1" },
        output: { nope: true },
      } as UIMessage["parts"][number],
    ];

    expect(buildPersistedAnalysisParts(parts)).toEqual([
      {
        kind: "ready",
        part: {
          type: "tool-fetchTable",
          state: "output-available",
          toolCallId: "call-table",
          input: { tableId: "q1" },
          output: { nope: true },
        },
      },
    ]);
  });

  it("persists tool-confirmCitation parts inline with the cell summary", () => {
    const cellSummary = {
      cellId: "q1%7Crow_1_csb%7C__total__%3A%3Atotal%7Cpct",
      tableId: "q1",
      tableTitle: "Q1 overall",
      questionId: "Q1",
      rowKey: "row_1_csb",
      rowLabel: "CSB",
      cutKey: "__total__::total",
      cutName: "Total",
      groupName: null,
      valueMode: "pct",
      displayValue: "58%",
      pct: 58,
      count: 236,
      n: null,
      mean: null,
      baseN: 405,
      sigHigherThan: [],
      sigVsTotal: null,
      sourceRefs: [],
    };

    const parts: UIMessage["parts"] = [
      {
        type: "tool-confirmCitation",
        toolCallId: "call-cite",
        state: "output-available",
        input: { tableId: "q1", rowKey: "row_1_csb", cutKey: "__total__::total" },
        output: cellSummary,
      } as UIMessage["parts"][number],
    ];

    const pending = buildPersistedAnalysisParts(parts);

    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual({
      kind: "ready",
      part: {
        type: "tool-confirmCitation",
        state: "output-available",
        toolCallId: "call-cite",
        label: "CSB / Total",
        cellSummary,
        input: { tableId: "q1", rowKey: "row_1_csb", cutKey: "__total__::total" },
        output: { status: "confirmed", ...cellSummary },
      },
    });
  });

  it("persists tool-confirmCitation parts even when the output is not a valid cell summary", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "tool-confirmCitation",
        toolCallId: "call-cite",
        state: "output-available",
        input: {},
        output: { status: "invalid_row", tableId: "q1", message: "bad row" },
      } as UIMessage["parts"][number],
    ];

    expect(buildPersistedAnalysisParts(parts)).toEqual([
      {
        kind: "ready",
        part: {
          type: "tool-confirmCitation",
          state: "output-available",
          toolCallId: "call-cite",
          input: {},
          output: { status: "invalid_row", tableId: "q1", message: "bad row" },
        },
      },
    ]);
  });

  it("preserves order across mixed parts", () => {
    const payload = makeTableCardPayload();
    const parts: UIMessage["parts"] = [
      { type: "reasoning", text: "First thought." },
      {
        type: "tool-searchRunCatalog",
        toolCallId: "call-1",
        state: "output-available",
        input: { query: "x" },
        output: { matches: [] },
      } as UIMessage["parts"][number],
      {
        type: "tool-fetchTable",
        toolCallId: "call-2",
        state: "output-available",
        input: { tableId: "q1" },
        output: payload,
      } as UIMessage["parts"][number],
      { type: "text", text: "Final answer." },
    ];

    const pending = buildPersistedAnalysisParts(parts);

    expect(pending.map((entry) => entry.kind)).toEqual([
      "ready",
      "ready",
      "tableCard",
      "ready",
    ]);
    expect(pending[0]).toMatchObject({
      kind: "ready",
      part: { type: "reasoning" },
    });
    expect(pending[3]).toMatchObject({
      kind: "ready",
      part: { type: "text", text: "Final answer." },
    });
  });
});
