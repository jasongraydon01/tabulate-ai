import { describe, expect, it } from "vitest";

import {
  getQuestionContext,
  getTableCard,
  listBannerCuts,
  searchRunCatalog,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";

const context: AnalysisGroundingContext = {
  availability: "available",
  missingArtifacts: [],
  tablesMetadata: {
    significanceTest: "unpooled z-test for column proportions",
    significanceLevel: 0.1,
    comparisonGroups: ["A/B"],
  },
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
  questions: [
    {
      questionId: "Q1",
      questionText: "Overall satisfaction with TabulateAI",
      normalizedType: "single_punch",
      analyticalSubtype: "standard_overview",
      disposition: "reportable",
      isHidden: false,
      hiddenLink: null,
      loop: null,
      loopQuestionId: null,
      surveyMatch: "How satisfied are you overall?",
      baseSummary: {
        situation: "all_respondents",
        signals: ["reported"],
        questionBase: 120,
        totalN: 120,
        itemBaseRange: [120, 120],
      },
      items: [
        {
          column: "Q1",
          label: "Overall satisfaction",
          normalizedType: "single_punch",
          valueLabels: [
            { value: 1, label: "Very satisfied" },
            { value: 2, label: "Somewhat satisfied" },
          ],
        },
      ],
    },
  ],
  bannerGroups: [
    {
      groupName: "Gender",
      columns: [
        { name: "Female", statLetter: "A", expression: "gender == 1" },
        { name: "Male", statLetter: "B", expression: "gender == 2" },
      ],
    },
  ],
};

describe("analysis grounding helpers", () => {
  it("searches questions, tables, and cuts from grounded artifacts", () => {
    const result = searchRunCatalog(context, "female satisfaction");

    expect(result.status).toBe("available");
    expect(result.questions[0]?.questionId).toBe("Q1");
    expect(result.tables[0]?.tableId).toBe("q1_overall");
    expect(result.cuts[0]).toEqual(expect.objectContaining({ cutName: "Female" }));
  });

  it("builds a renderable table card with filtered cuts", () => {
    const card = getTableCard(context, {
      tableId: "q1_overall",
      cutFilter: "female",
      valueMode: "pct",
    });

    expect(card.status).toBe("available");
    if (card.status !== "available") {
      throw new Error("expected table card");
    }

    expect(card.columns).toEqual([
      expect.objectContaining({
        cutName: "Female",
        statLetter: "A",
      }),
    ]);
    expect(card.rows[0]?.values[0]).toEqual(expect.objectContaining({
      displayValue: "54.3%",
      sigHigherThan: ["B"],
    }));
    expect(card.significanceTest).toBe("unpooled z-test for column proportions");
  });

  it("returns grounded question context with related tables", () => {
    const result = getQuestionContext(context, "Q1");

    expect(result.status).toBe("available");
    expect(result.relatedTableIds).toEqual(["q1_overall"]);
    expect(result.items[0]?.valueLabels).toHaveLength(2);
  });

  it("lists banner cuts with expression details", () => {
    const result = listBannerCuts(context, "female");

    expect(result.status).toBe("available");
    expect(result.totalGroups).toBe(1);
    expect(result.groups[0]?.cuts).toEqual([
      {
        name: "Female",
        statLetter: "A",
        expression: "gender == 1",
      },
    ]);
  });
});
