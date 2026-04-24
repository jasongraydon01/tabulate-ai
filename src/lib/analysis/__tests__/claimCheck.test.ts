import { describe, expect, it } from "vitest";

import { buildAnalysisCiteMarker } from "@/lib/analysis/citeAnchors";
import {
  detectUncitedSpecificNumbers,
  resolveAssistantMessageTrust,
} from "@/lib/analysis/claimCheck";
import { buildAnalysisCellId, type AnalysisCellSummary, type AnalysisTableCard } from "@/lib/analysis/types";

const TOTAL_CELL_ID = buildAnalysisCellId({
  tableId: "q1",
  rowKey: "row_1_csb",
  cutKey: "__total__::total",
});

const FEMALE_CELL_ID = buildAnalysisCellId({
  tableId: "q1",
  rowKey: "row_1_csb",
  cutKey: "group:gender::female",
});

function makeTableCard(overrides: Partial<AnalysisTableCard> = {}): AnalysisTableCard {
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
    sourceRefs: [
      { refType: "table", refId: "q1", label: "Q1 overall" },
      { refType: "question", refId: "Q1", label: "Q1" },
    ],
    ...overrides,
  };
}

function makeCellSummary(overrides: Partial<AnalysisCellSummary> = {}): AnalysisCellSummary {
  return {
    cellId: TOTAL_CELL_ID,
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
    sourceRefs: [
      { refType: "table", refId: "q1", label: "Q1 overall" },
      { refType: "question", refId: "Q1", label: "Q1" },
    ],
    ...overrides,
  };
}

describe("resolveAssistantMessageTrust (cite-driven)", () => {
  it("returns no refs for plain interpretation prose with no markers", () => {
    const result = resolveAssistantMessageTrust({
      assistantText: "I would start with overall satisfaction, then check subgroup spread.",
      responseParts: [{ type: "text", text: "I would start with overall satisfaction, then check subgroup spread." }],
      groundingEvents: [],
    });

    expect(result.hasGroundedClaims).toBe(false);
    expect(result.groundingRefs).toEqual([]);
    expect(result.injectedTableCards).toEqual([]);
  });

  it("builds one cell ref per cellId inside a single cite marker", () => {
    const marker = buildAnalysisCiteMarker([TOTAL_CELL_ID]);
    const assistantText = `Awareness is 58% overall.${marker}`;

    const result = resolveAssistantMessageTrust({
      assistantText,
      responseParts: [{ type: "text", text: assistantText }],
      groundingEvents: [
        {
          toolName: "confirmCitation",
          toolCallId: "confirm-1",
          sourceRefs: makeCellSummary().sourceRefs,
          cellSummary: makeCellSummary(),
        },
      ],
    });

    expect(result.hasGroundedClaims).toBe(true);
    expect(result.groundingRefs).toHaveLength(1);
    const ref = result.groundingRefs[0]!;
    expect(ref.claimType).toBe("cell");
    expect(ref.evidenceKind).toBe("cell");
    expect(ref.refType).toBe("table");
    expect(ref.refId).toBe("q1");
    expect(ref.rowKey).toBe("row_1_csb");
    expect(ref.cutKey).toBe("__total__::total");
    expect(ref.sourceTableId).toBe("q1");
    expect(ref.sourceQuestionId).toBe("Q1");
    expect(ref.label).toContain("CSB");
  });

  it("emits one ref per cellId when a multi-cell marker is used", () => {
    const marker = buildAnalysisCiteMarker([TOTAL_CELL_ID, FEMALE_CELL_ID]);
    const assistantText = `Awareness is 58% overall, higher among women.${marker}`;

    const result = resolveAssistantMessageTrust({
      assistantText,
      responseParts: [{ type: "text", text: assistantText }],
      groundingEvents: [
        {
          toolName: "confirmCitation",
          toolCallId: "confirm-1",
          sourceRefs: [],
          cellSummary: makeCellSummary(),
        },
        {
          toolName: "confirmCitation",
          toolCallId: "confirm-2",
          sourceRefs: [],
          cellSummary: makeCellSummary({
            cellId: FEMALE_CELL_ID,
            cutKey: "group:gender::female",
            cutName: "Female",
            groupName: "Gender",
          }),
        },
      ],
    });

    expect(result.groundingRefs.filter((ref) => ref.claimType === "cell")).toHaveLength(2);
  });

  it("marks refs renderedInCurrentMessage=true when the cited table was rendered this turn", () => {
    const marker = buildAnalysisCiteMarker([TOTAL_CELL_ID]);
    const assistantText = `Awareness is 58%.${marker}`;

    const result = resolveAssistantMessageTrust({
      assistantText,
      responseParts: [
        {
          type: "tool-fetchTable",
          toolCallId: "tool-1",
          state: "output-available",
          input: { tableId: "q1" },
          output: makeTableCard(),
        },
        { type: "text", text: assistantText },
      ],
      groundingEvents: [
        {
          toolName: "confirmCitation",
          toolCallId: "confirm-1",
          sourceRefs: [],
          cellSummary: makeCellSummary(),
        },
      ],
    });

    const cellRef = result.groundingRefs.find((ref) => ref.claimType === "cell");
    expect(cellRef).toBeDefined();
    expect(cellRef!.renderedInCurrentMessage).toBe(true);
    expect(cellRef!.anchorId).toBe("tool-1");
  });

  it("strips leaked placeholder citation tokens from assistant text", () => {
    const assistantText = [
      "These three tables help flesh it out:",
      "",
      "{{table:f10__standard_overview}}",
      "",
      "{{table:f11__standard_overview}}",
      "",
      "---",
      "",
      "The age story gets sharper now.",
    ].join("\n");

    const result = resolveAssistantMessageTrust({
      assistantText,
      responseParts: [{ type: "text", text: assistantText }],
      groundingEvents: [],
    });

    expect(result.assistantText).toBe([
      "These three tables help flesh it out:",
      "",
      "The age story gets sharper now.",
    ].join("\n"));
  });

  it("silently ignores unparseable cellIds inside cite markers", () => {
    const assistantText = `Value.[[cite cellIds=not_a_real_cell_id]] End.`;
    const result = resolveAssistantMessageTrust({
      assistantText,
      responseParts: [{ type: "text", text: assistantText }],
      groundingEvents: [],
    });
    expect(result.hasGroundedClaims).toBe(false);
    expect(result.groundingRefs).toEqual([]);
  });
});

describe("detectUncitedSpecificNumbers", () => {
  it("fires on a percent", () => {
    expect(detectUncitedSpecificNumbers("Awareness is 58% overall.")).toBe(true);
  });

  it("fires on a base-n pattern", () => {
    expect(detectUncitedSpecificNumbers("The base was n=405.")).toBe(true);
  });

  it("does not fire on interpretation prose", () => {
    expect(detectUncitedSpecificNumbers("Awareness is notably higher in the older segment.")).toBe(false);
  });

  it("does not fire on empty input", () => {
    expect(detectUncitedSpecificNumbers("")).toBe(false);
    expect(detectUncitedSpecificNumbers("   ")).toBe(false);
  });
});
