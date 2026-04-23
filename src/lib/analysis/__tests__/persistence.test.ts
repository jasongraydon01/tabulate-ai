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

  it("persists allowlisted tool parts with type, state, and toolCallId only", () => {
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
        },
      },
      {
        kind: "ready",
        part: {
          type: "tool-listBannerCuts",
          state: "output-available",
          toolCallId: "call-2",
        },
      },
    ]);
  });

  it("drops non-allowlisted tool parts", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "tool-someNewThing",
        toolCallId: "call-x",
        state: "output-available",
        input: {},
        output: undefined,
      } as UIMessage["parts"][number],
    ];

    expect(buildPersistedAnalysisParts(parts)).toEqual([]);
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
      template: { state: "output-available", label: "Q1 overall", toolCallId: "call-table" },
      artifact: {
        title: "Q1 overall",
        tableId: "q1",
        questionId: "Q1",
        payload,
      },
    });
  });

  it("drops getTableCard parts that are not output-available", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "tool-fetchTable",
        toolCallId: "call-table",
        state: "input-available",
        input: { tableId: "q1" },
        output: undefined,
      } as UIMessage["parts"][number],
    ];

    expect(buildPersistedAnalysisParts(parts)).toEqual([]);
  });

  it("drops getTableCard parts whose output is not a valid analysis table card", () => {
    const parts: UIMessage["parts"] = [
      {
        type: "tool-fetchTable",
        toolCallId: "call-table",
        state: "output-available",
        input: { tableId: "q1" },
        output: { nope: true },
      } as UIMessage["parts"][number],
    ];

    expect(buildPersistedAnalysisParts(parts)).toEqual([]);
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
