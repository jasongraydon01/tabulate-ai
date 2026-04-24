import { describe, expect, it } from "vitest";

import {
  confirmCitation,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";
import { buildAnalysisCellId } from "@/lib/analysis/types";

function buildContractColumns(
  columns: Array<{
    cutKey: string;
    cutName: string;
    groupKey: string;
    groupName: string | null;
    statLetter: string | null;
    baseN: number | null;
    isTotal: boolean;
  }>,
) {
  return columns.map((column, order) => ({
    ...column,
    order,
  }));
}

function buildContractRows(
  rows: Array<{
    rowKey: string;
    label: string;
    rowKind: string;
    statType: string | null;
    valueType: "pct" | "count" | "n" | "mean" | "median" | "stddev" | "stderr";
    format: {
      kind: "percent" | "number";
      decimals: number;
    };
  }>,
) {
  return rows.map((row) => ({
    indent: 0,
    isNet: false,
    ...row,
  }));
}

function makeContext(overrides: Partial<AnalysisGroundingContext> = {}): AnalysisGroundingContext {
  return {
    availability: "available",
    missingArtifacts: [],
    tables: {
      q1_overall: {
        tableId: "q1_overall",
        questionId: "Q1",
        questionText: "Overall satisfaction with TabulateAI",
        tableType: "frequency",
        baseText: "All respondents",
        tableSubtitle: "Overall",
        columns: buildContractColumns([
          { cutKey: "__total__::total", cutName: "Total", groupKey: "__total__", groupName: "Total", statLetter: "T", baseN: 120, isTotal: true },
          { cutKey: "group:gender::female", cutName: "Female", groupKey: "group:gender", groupName: "Gender", statLetter: "A", baseN: 70, isTotal: false },
          { cutKey: "group:gender::male", cutName: "Male", groupKey: "group:gender", groupName: "Gender", statLetter: "B", baseN: 50, isTotal: false },
        ]),
        rows: buildContractRows([
          { rowKey: "row_0_1", label: "Very satisfied", rowKind: "value", statType: null, valueType: "pct", format: { kind: "percent", decimals: 0 } },
          { rowKey: "row_1_2", label: "Somewhat satisfied", rowKind: "value", statType: null, valueType: "pct", format: { kind: "percent", decimals: 0 } },
        ]),
        data: {
          Total: {
            stat_letter: "T",
            row_0_1: { label: "Very satisfied", n: 120, count: 54, pct: 45, isNet: false, indent: 0 },
            row_1_2: { label: "Somewhat satisfied", n: 120, count: 42, pct: 35, isNet: false, indent: 0 },
          },
          Female: {
            stat_letter: "A",
            row_0_1: { label: "Very satisfied", groupName: "Gender", n: 70, count: 38, pct: 54.3, isNet: false, indent: 0, sig_higher_than: ["B"] },
            row_1_2: { label: "Somewhat satisfied", groupName: "Gender", n: 70, count: 18, pct: 25.7, isNet: false, indent: 0 },
          },
          Male: {
            stat_letter: "B",
            row_0_1: { label: "Very satisfied", groupName: "Gender", n: 50, count: 16, pct: 32, isNet: false, indent: 0, sig_vs_total: "lower" },
            row_1_2: { label: "Somewhat satisfied", groupName: "Gender", n: 50, count: 24, pct: 48, isNet: false, indent: 0 },
          },
        },
      },
      q2_ambiguous: {
        tableId: "q2_ambiguous",
        questionId: "Q2",
        questionText: "Familiarity follow-up",
        tableType: "frequency",
        baseText: "All respondents",
        columns: buildContractColumns([
          { cutKey: "__total__::total", cutName: "Total", groupKey: "__total__", groupName: "Total", statLetter: "T", baseN: 100, isTotal: true },
          { cutKey: "group:gender::agree", cutName: "Agree", groupKey: "group:gender", groupName: "Gender", statLetter: "A", baseN: 55, isTotal: false },
          { cutKey: "group:region::agree", cutName: "Agree!", groupKey: "group:region", groupName: "Region", statLetter: "B", baseN: 45, isTotal: false },
        ]),
        rows: buildContractRows([
          { rowKey: "row_0_1", label: "Familiarity", rowKind: "value", statType: null, valueType: "pct", format: { kind: "percent", decimals: 0 } },
          { rowKey: "row_1_2", label: "Familiarity", rowKind: "value", statType: null, valueType: "pct", format: { kind: "percent", decimals: 0 } },
        ]),
        data: {
          Total: {
            stat_letter: "T",
            row_0_1: { label: "Familiarity", n: 100, count: 40, pct: 40, isNet: false, indent: 0 },
            row_1_2: { label: "Familiarity", n: 100, count: 25, pct: 25, isNet: false, indent: 0 },
          },
          Agree: {
            stat_letter: "A",
            row_0_1: { label: "Familiarity", groupName: "Gender", n: 55, count: 26, pct: 47.3, isNet: false, indent: 0 },
            row_1_2: { label: "Familiarity", groupName: "Gender", n: 55, count: 13, pct: 23.6, isNet: false, indent: 0 },
          },
          "Agree!": {
            stat_letter: "B",
            row_0_1: { label: "Familiarity", groupName: "Region", n: 45, count: 14, pct: 31.1, isNet: false, indent: 0 },
            row_1_2: { label: "Familiarity", groupName: "Region", n: 45, count: 12, pct: 26.7, isNet: false, indent: 0 },
          },
        },
      },
    },
    questions: [],
    bannerGroups: [
      {
        groupName: "Gender",
        columns: [
          { name: "Female", statLetter: "A", expression: "gender == 1" },
          { name: "Male", statLetter: "B", expression: "gender == 2" },
        ],
      },
      {
        groupName: "Gender",
        columns: [
          { name: "Agree", statLetter: "A", expression: "gender == 1" },
        ],
      },
      {
        groupName: "Region",
        columns: [
          { name: "Agree!", statLetter: "B", expression: "region == 1" },
        ],
      },
    ],
    bannerPlanGroups: [],
    bannerRouteMetadata: null,
    surveyMarkdown: null,
    surveyQuestions: [],
    projectContext: {
      projectName: null,
      runStatus: null,
      studyMethodology: null,
      analysisMethod: null,
      bannerSource: null,
      bannerMode: null,
      tableCount: null,
      bannerGroupCount: null,
      totalCuts: null,
      bannerGroupNames: [],
      researchObjectives: null,
      bannerHints: null,
      intakeFiles: {
        dataFile: null,
        survey: null,
        bannerPlan: null,
        messageList: null,
      },
    },
    tablesMetadata: {
      significanceTest: null,
      significanceLevel: null,
      comparisonGroups: [],
    },
    ...overrides,
  };
}

// cutKey format is `${groupKey}::${normalizedCutName}` per deriveCutKey.
// For the Total cut, groupKey is "__total__". For a non-total cut, groupKey
// is "group:<normalizedGroupName>".
const TOTAL_CUT_KEY = "__total__::total";
const FEMALE_CUT_KEY = "group:gender::female";
const AGREE_GENDER_CUT_KEY = "group:gender::agree";
const AGREE_REGION_CUT_KEY = "group:region::agree";

describe("confirmCitation", () => {
  it("returns a confirmed cell summary for the Total cut", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q1_overall",
      rowKey: "row_0_1",
      cutKey: TOTAL_CUT_KEY,
    });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;

    expect(result.tableId).toBe("q1_overall");
    expect(result.rowKey).toBe("row_0_1");
    expect(result.cutKey).toBe(TOTAL_CUT_KEY);
    expect(result.rowLabel).toBe("Very satisfied");
    expect(result.cutName).toBe("Total");
    expect(result.valueMode).toBe("pct");
    expect(result.pct).toBe(45);
    expect(result.count).toBe(54);
    expect(result.baseN).toBe(120);
    expect(result.displayValue).toBe("45%");
    expect(result.questionId).toBe("Q1");
    expect(result.cellId).toBe(buildAnalysisCellId({
      tableId: "q1_overall",
      rowKey: "row_0_1",
      cutKey: TOTAL_CUT_KEY,
      valueMode: "pct",
    }));
    expect(result.sourceRefs.some((ref) => ref.refType === "table")).toBe(true);
    expect(result.sourceRefs.some((ref) => ref.refType === "question")).toBe(true);
    expect(result.sourceRefs.some((ref) => ref.refType === "banner_cut")).toBe(true);
  });

  it("propagates sigHigherThan on a Female cell", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q1_overall",
      rowKey: "row_0_1",
      cutKey: FEMALE_CUT_KEY,
    });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;

    expect(result.sigHigherThan).toEqual(["B"]);
    expect(result.cutName).toBe("Female");
    expect(result.groupName).toBe("Gender");
    expect(result.baseN).toBe(70);
  });

  it("returns not_found for an unknown tableId", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "does_not_exist",
      rowKey: "row_0_1",
      cutKey: TOTAL_CUT_KEY,
    });

    expect(result.status).toBe("not_found");
    if (result.status !== "not_found") return;
    expect(result.tableId).toBe("does_not_exist");
    expect(result.message).toMatch(/not found/i);
  });

  it("returns unavailable when the context itself is unavailable and the table isn't loaded", () => {
    const result = confirmCitation(
      makeContext({ availability: "unavailable", missingArtifacts: ["results/tables.json"], tables: {} }),
      { tableId: "q1_overall", rowKey: "row_0_1", cutKey: TOTAL_CUT_KEY },
    );

    expect(result.status).toBe("unavailable");
  });

  it("returns unavailable when the requested table failed structured hydration", () => {
    const result = confirmCitation(
      makeContext({
        brokenTables: {
          q1_overall: "Final table contract mismatch for q1_overall",
        },
      }),
      { tableId: "q1_overall", rowKey: "row_0_1", cutKey: TOTAL_CUT_KEY },
    );

    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.message).toMatch(/structured metadata could not be loaded/i);
  });

  it("returns invalid_row with allowedRowKeys when the rowKey is wrong", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q1_overall",
      rowKey: "row_not_there",
      cutKey: TOTAL_CUT_KEY,
    });

    expect(result.status).toBe("invalid_row");
    if (result.status !== "invalid_row") return;
    expect(result.allowedRowKeys).toBeDefined();
    expect(result.allowedRowKeys!.length).toBeGreaterThan(0);
    expect(result.allowedRowKeys).toContain("row_0_1");
  });

  it("returns invalid_cut with allowedCutKeys when the cutKey is wrong", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q1_overall",
      rowKey: "row_0_1",
      cutKey: "totally_wrong_cut_key",
    });

    expect(result.status).toBe("invalid_cut");
    if (result.status !== "invalid_cut") return;
    expect(result.allowedCutKeys).toBeDefined();
    expect(result.allowedCutKeys!).toContain(TOTAL_CUT_KEY);
    expect(result.allowedCutKeys!).toContain(FEMALE_CUT_KEY);
  });

  it("respects the requested valueMode when supplied", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q1_overall",
      rowKey: "row_0_1",
      cutKey: TOTAL_CUT_KEY,
      valueMode: "count",
    });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.valueMode).toBe("pct");
    expect(result.displayValue).toBe("45%");
  });

  it("confirms a cell from semantic row and column labels", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q1_overall",
      rowLabel: "Very satisfied",
      columnLabel: "Female",
    });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.rowKey).toBe("row_0_1");
    expect(result.cutKey).toBe(FEMALE_CUT_KEY);
    expect(result.displayValue).toBe("54%");
  });

  it("returns ambiguous_row with rowRef candidates when duplicate row labels exist", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q2_ambiguous",
      rowLabel: "Familiarity",
      columnLabel: "Total",
    });

    expect(result.status).toBe("ambiguous_row");
    if (result.status !== "ambiguous_row") return;
    expect(result.candidateRows).toEqual([
      { rowLabel: "Familiarity", rowRef: "row_0_1" },
      { rowLabel: "Familiarity", rowRef: "row_1_2" },
    ]);
  });

  it("resolves an ambiguous row when rowRef is supplied", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q2_ambiguous",
      rowLabel: "Familiarity",
      rowRef: "row_1_2",
      columnLabel: "Total",
    });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.rowKey).toBe("row_1_2");
    expect(result.cutKey).toBe(TOTAL_CUT_KEY);
    expect(result.displayValue).toBe("25%");
  });

  it("returns invalid_row when rowRef does not resolve the matched semantic row", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q2_ambiguous",
      rowLabel: "Familiarity",
      rowRef: "row_not_real",
      columnLabel: "Total",
    });

    expect(result.status).toBe("invalid_row");
    if (result.status !== "invalid_row") return;
    expect(result.candidateRows).toEqual([
      { rowLabel: "Familiarity", rowRef: "row_0_1" },
      { rowLabel: "Familiarity", rowRef: "row_1_2" },
    ]);
  });

  it("returns ambiguous_column with columnRef candidates when duplicate column labels exist", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q2_ambiguous",
      rowLabel: "Familiarity",
      rowRef: "row_0_1",
      columnLabel: "Agree",
    });

    expect(result.status).toBe("ambiguous_column");
    if (result.status !== "ambiguous_column") return;
    expect(result.candidateColumns).toEqual([
      { columnLabel: "Agree", columnRef: AGREE_GENDER_CUT_KEY, statLetter: "A" },
      { columnLabel: "Agree!", columnRef: AGREE_REGION_CUT_KEY, statLetter: "B" },
    ]);
  });

  it("resolves an ambiguous column when columnRef is supplied", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q2_ambiguous",
      rowLabel: "Familiarity",
      rowRef: "row_0_1",
      columnLabel: "Agree",
      columnRef: AGREE_REGION_CUT_KEY,
    });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.rowKey).toBe("row_0_1");
    expect(result.cutKey).toBe(AGREE_REGION_CUT_KEY);
    expect(result.displayValue).toBe("31%");
  });

  it("returns invalid_column when columnRef does not resolve the matched semantic column", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q2_ambiguous",
      rowLabel: "Familiarity",
      rowRef: "row_0_1",
      columnLabel: "Agree",
      columnRef: "group:gender::not-real",
    });

    expect(result.status).toBe("invalid_column");
    if (result.status !== "invalid_column") return;
    expect(result.candidateColumns).toEqual([
      { columnLabel: "Agree", columnRef: AGREE_GENDER_CUT_KEY, statLetter: "A" },
      { columnLabel: "Agree!", columnRef: AGREE_REGION_CUT_KEY, statLetter: "B" },
    ]);
  });

  it("respects valueMode on the semantic path when supplied", () => {
    const result = confirmCitation(makeContext(), {
      tableId: "q1_overall",
      rowLabel: "Very satisfied",
      columnLabel: "Total",
      valueMode: "count",
    });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.valueMode).toBe("pct");
    expect(result.displayValue).toBe("45%");
  });

  it("returns numeric display values for stat rows even when the source metric lives on pct", () => {
    const statContext = makeContext({
      tables: {
        q4_frequency_stats: {
          tableId: "q4_frequency_stats",
          questionId: "Q4",
          questionText: "Bank consideration",
          tableType: "frequency",
          columns: buildContractColumns([
            { cutKey: "__total__::total", cutName: "Total", groupKey: "__total__", groupName: "Total", statLetter: "T", baseN: 245, isTotal: true },
          ]),
          rows: buildContractRows([
            { rowKey: "B1r2_row_10", label: "Std Dev", rowKind: "stat", statType: "stddev", valueType: "stddev", format: { kind: "number", decimals: 2 } },
          ]),
          data: {
            Total: {
              stat_letter: "T",
              B1r2_row_10: { label: "Std Dev", rowKind: "stat", statType: "stddev", n: 245, pct: 1.07, isStat: true, indent: 0 },
            },
          },
        },
      },
    });

    const result = confirmCitation(statContext, {
      tableId: "q4_frequency_stats",
      rowKey: "B1r2_row_10",
      cutKey: "__total__::total",
    });

    expect(result.status).toBe("confirmed");
    if (result.status !== "confirmed") return;
    expect(result.displayValue).toBe("1.07");
    expect(result.valueMode).toBe("mean");
    expect(result.cellId).toBe(buildAnalysisCellId({
      tableId: "q4_frequency_stats",
      rowKey: "B1r2_row_10",
      cutKey: "__total__::total",
      valueMode: "mean",
    }));
  });
});
