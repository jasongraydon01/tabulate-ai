import { describe, expect, it } from "vitest";

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
  it("returns no refs for plain interpretation prose with no cite parts", () => {
    const result = resolveAssistantMessageTrust({
      assistantParts: [
        { type: "text", text: "I would start with overall satisfaction, then check subgroup spread." },
      ],
      responseParts: [{ type: "text", text: "I would start with overall satisfaction, then check subgroup spread." }],
      groundingEvents: [],
    });

    expect(result.hasGroundedClaims).toBe(false);
    expect(result.groundingRefs).toEqual([]);
    expect(result.contextEvidence).toEqual([]);
    expect(result.injectedTableCards).toEqual([]);
  });

  it("builds one cell ref per cited cellId", () => {
    const result = resolveAssistantMessageTrust({
      assistantParts: [
        { type: "text", text: "Awareness is 58% overall." },
        { type: "cite", cellIds: [TOTAL_CELL_ID] },
      ],
      responseParts: [{ type: "text", text: "Awareness is 58% overall." }],
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
    expect(result.groundingRefs[0]).toMatchObject({
      claimType: "cell",
      evidenceKind: "cell",
      refType: "table",
      refId: "q1",
      rowKey: "row_1_csb",
      cutKey: "__total__::total",
      sourceTableId: "q1",
      sourceQuestionId: "Q1",
    });
  });

  it("emits one ref per cellId when a multi-cell cite part is used", () => {
    const result = resolveAssistantMessageTrust({
      assistantParts: [
        { type: "text", text: "Awareness is 58% overall, higher among women." },
        { type: "cite", cellIds: [TOTAL_CELL_ID, FEMALE_CELL_ID] },
      ],
      responseParts: [{ type: "text", text: "Awareness is 58% overall, higher among women." }],
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

  it("does not mark refs renderedInCurrentMessage=true when the table was only fetched", () => {
    const result = resolveAssistantMessageTrust({
      assistantParts: [
        { type: "text", text: "Awareness is 58%." },
        { type: "cite", cellIds: [TOTAL_CELL_ID] },
      ],
      responseParts: [
        {
          type: "tool-fetchTable",
          toolCallId: "tool-1",
          state: "output-available",
          input: { tableId: "q1", cutGroups: null },
          output: makeTableCard(),
        },
        { type: "text", text: "Awareness is 58%." },
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

    expect(result.groundingRefs[0]).toMatchObject({
      renderedInCurrentMessage: false,
      anchorId: null,
    });
  });

  it("marks refs renderedInCurrentMessage=true when the cited table was explicitly rendered this turn", () => {
    const result = resolveAssistantMessageTrust({
      assistantParts: [
        { type: "text", text: "Awareness is 58%." },
        { type: "cite", cellIds: [TOTAL_CELL_ID] },
        { type: "render", tableId: "q1" },
      ],
      responseParts: [
        {
          type: "tool-fetchTable",
          toolCallId: "tool-1",
          state: "output-available",
          input: { tableId: "q1", cutGroups: null },
          output: makeTableCard(),
        },
        { type: "text", text: "Awareness is 58%." },
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

    expect(result.groundingRefs[0]).toMatchObject({
      renderedInCurrentMessage: true,
      anchorId: "tool-1",
    });
  });

  it("strips leaked placeholder citation tokens from structured assistant text", () => {
    const leakedText = [
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
      assistantParts: [{ type: "text", text: leakedText }],
      responseParts: [{ type: "text", text: leakedText }],
      groundingEvents: [],
    });

    expect(result.assistantText).toBe([
      "These three tables help flesh it out:",
      "",
      "The age story gets sharper now.",
    ].join("\n"));
  });

  it("silently ignores unparseable cellIds inside cite parts", () => {
    const result = resolveAssistantMessageTrust({
      assistantParts: [
        { type: "text", text: "Value." },
        { type: "cite", cellIds: ["not_a_real_cell_id"] },
        { type: "text", text: " End." },
      ],
      responseParts: [{ type: "text", text: "Value. End." }],
      groundingEvents: [],
    });

    expect(result.hasGroundedClaims).toBe(false);
    expect(result.groundingRefs).toEqual([]);
  });

  it("derives grounding refs from structured cite parts without rescanning prose text", () => {
    const result = resolveAssistantMessageTrust({
      assistantParts: [
        { type: "text", text: "Awareness is 58% overall." },
        { type: "cite", cellIds: [TOTAL_CELL_ID] },
      ],
      responseParts: [{ type: "text", text: "Awareness is 58% overall." }],
      groundingEvents: [
        {
          toolName: "confirmCitation",
          toolCallId: "confirm-1",
          sourceRefs: makeCellSummary().sourceRefs,
          cellSummary: makeCellSummary(),
        },
      ],
    });

    expect(result.assistantText).toBe("Awareness is 58% overall.");
    expect(result.assistantParts).toEqual([
      { type: "text", text: "Awareness is 58% overall." },
      { type: "cite", cellIds: [TOTAL_CELL_ID] },
    ]);
    expect(result.groundingRefs).toHaveLength(1);
  });

  it("keeps contextual support separate from grounded claim evidence", () => {
    const result = resolveAssistantMessageTrust({
      assistantParts: [
        { type: "text", text: "This question is about overall satisfaction." },
      ],
      responseParts: [{ type: "text", text: "This question is about overall satisfaction." }],
      groundingEvents: [
        {
          toolName: "getQuestionContext",
          toolCallId: "context-1",
          sourceRefs: [
            { refType: "table", refId: "q1", label: "Q1 overall" },
            { refType: "survey_question", refId: "Q1", label: "Q1 survey wording" },
          ],
        },
      ],
    });

    expect(result.hasGroundedClaims).toBe(false);
    expect(result.groundingRefs).toEqual([]);
    expect(result.contextEvidence).toEqual([
      expect.objectContaining({
        claimType: "context",
        evidenceKind: "context",
        refType: "survey_question",
        refId: "Q1",
      }),
    ]);
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
