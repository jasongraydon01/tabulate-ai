import { describe, expect, it } from "vitest";

import {
  confirmCitation,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";
import { buildAnalysisCellId } from "@/lib/analysis/types";

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
    expect(result.valueMode).toBe("count");
    expect(result.displayValue).toBe("54");
  });
});
