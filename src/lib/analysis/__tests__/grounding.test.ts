import { describe, expect, it } from "vitest";

import {
  getQuestionContext,
  getTableCard,
  listBannerCuts,
  searchRunCatalog,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";

function buildLongTableRows() {
  return Object.fromEntries(
    Array.from({ length: 10 }, (_, index) => [
      `row_${index}_${index + 1}`,
      {
        label: `Option ${index + 1}`,
        n: 120,
        count: 12 - index,
        pct: 12 - index,
        isNet: false,
        indent: 0,
      },
    ]),
  );
}

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
        East: {
          stat_letter: "C",
          row_0_1: { label: "Very satisfied", groupName: "Region", n: 60, count: 31, pct: 51.2, isNet: false, indent: 0 },
          row_1_2: { label: "Somewhat satisfied", groupName: "Region", n: 60, count: 21, pct: 34.8, isNet: false, indent: 0 },
        },
        West: {
          stat_letter: "D",
          row_0_1: { label: "Very satisfied", groupName: "Region", n: 60, count: 23, pct: 39.1, isNet: false, indent: 0 },
          row_1_2: { label: "Somewhat satisfied", groupName: "Region", n: 60, count: 20, pct: 33.9, isNet: false, indent: 0 },
        },
      },
    },
    q2_mean: {
      tableId: "q2_mean",
      questionId: "Q2",
      questionText: "Mean agreement score",
      tableType: "mean rows",
      baseText: "All respondents",
      data: {
        Total: {
          stat_letter: "T",
          row_0_1: { label: "Mean", n: 120, mean: 3.46, isNet: false, indent: 0 },
        },
      },
    },
    q3_long: {
      tableId: "q3_long",
      questionId: "Q3",
      questionText: "Long option list",
      tableType: "frequency",
      baseText: "All respondents",
      data: {
        Total: {
          stat_letter: "T",
          ...buildLongTableRows(),
        },
        Female: {
          stat_letter: "A",
          ...Object.fromEntries(
            Array.from({ length: 10 }, (_, index) => [
              `row_${index}_${index + 1}`,
              {
                label: `Option ${index + 1}`,
                groupName: "Gender",
                n: 70,
                count: 10 - index,
                pct: 10 - index,
                isNet: false,
                indent: 0,
              },
            ]),
          ),
        },
        Male: {
          stat_letter: "B",
          ...Object.fromEntries(
            Array.from({ length: 10 }, (_, index) => [
              `row_${index}_${index + 1}`,
              {
                label: `Option ${index + 1}`,
                groupName: "Gender",
                n: 50,
                count: 8 - index,
                pct: 8 - index,
                isNet: false,
                indent: 0,
              },
            ]),
          ),
        },
      },
    },
    q4_frequency_stats: {
      tableId: "q4_frequency_stats",
      questionId: "Q4",
      questionText: "Bank consideration",
      tableType: "frequency",
      tableSubtitle: "Overall",
      baseText: "Respondents shown this item",
      data: {
        Total: {
          stat_letter: "T",
          row_0_1: { label: "Top 2 Box", rowKind: "net", n: 245, count: 49, pct: 20, isNet: true, indent: 0 },
          row_1_2: { label: "Std Dev", rowKind: "stat", statType: "stddev", n: 245, pct: 1.07, isNet: false, indent: 0 },
          row_2_3: { label: "Std Err", rowKind: "stat", statType: "stderr", n: 245, pct: 0.07, isNet: false, indent: 0 },
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
    {
      groupName: "Region",
      columns: [
        { name: "East", statLetter: "C", expression: "region == 1" },
        { name: "West", statLetter: "D", expression: "region == 2" },
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

  it("defaults to total-first preview while keeping grouped payload data available", () => {
    const card = getTableCard(context, {
      tableId: "q1_overall",
      valueMode: "pct",
    });

    expect(card.status).toBe("available");
    if (card.status !== "available") {
      throw new Error("expected table card");
    }

    expect(card.defaultScope).toBe("total_only");
    expect(card.initialVisibleGroupCount).toBe(0);
    expect(card.hiddenGroupCount).toBe(2);
    expect(card.hiddenCutCount).toBe(4);
    expect(card.columnGroups?.map((group) => group.groupName)).toEqual(["Total", "Gender", "Region"]);
    expect(card.columns.map((column) => column.cutName)).toEqual(["Total", "Female", "Male", "East", "West"]);
    expect(card.rows[0]?.cellsByCutKey?.["__total__::total"]?.displayValue).toBe("45%");
  });

  it("returns full matching groups when a cut filter is applied", () => {
    const card = getTableCard(context, {
      tableId: "q1_overall",
      cutFilter: "female",
      valueMode: "pct",
    });

    expect(card.status).toBe("available");
    if (card.status !== "available") {
      throw new Error("expected table card");
    }

    expect(card.defaultScope).toBe("matched_groups");
    expect(card.columnGroups?.map((group) => group.groupName)).toEqual(["Total", "Gender"]);
    expect(card.columns.map((column) => column.cutName)).toEqual(["Total", "Female", "Male"]);
    expect(card.rows[0]?.values.find((value) => value.cutName === "Female")).toEqual(
      expect.objectContaining({
        displayValue: "54%",
        sigHigherThan: ["B"],
      }),
    );
  });

  it("prioritizes matched rows without dropping the rest of the table", () => {
    const card = getTableCard(context, {
      tableId: "q1_overall",
      rowFilter: "somewhat",
      valueMode: "pct",
    });

    expect(card.status).toBe("available");
    if (card.status !== "available") {
      throw new Error("expected table card");
    }

    expect(card.rows.map((row) => row.label)).toEqual([
      "Somewhat satisfied",
      "Very satisfied",
    ]);
    expect(card.totalRows).toBe(2);
  });

  it("reports preview metadata for long tables", () => {
    const card = getTableCard(context, {
      tableId: "q3_long",
      valueMode: "pct",
    });

    expect(card.status).toBe("available");
    if (card.status !== "available") {
      throw new Error("expected table card");
    }

    expect(card.initialVisibleRowCount).toBe(8);
    expect(card.hiddenRowCount).toBe(2);
    expect(card.isExpandable).toBe(true);
    expect(card.truncatedRows).toBe(2);
  });

  it("uses whole numbers for percent values and one decimal for mean values by default", () => {
    const percentCard = getTableCard(context, {
      tableId: "q1_overall",
    });
    const meanCard = getTableCard(context, {
      tableId: "q2_mean",
    });

    expect(percentCard.status).toBe("available");
    expect(meanCard.status).toBe("available");
    if (percentCard.status !== "available" || meanCard.status !== "available") {
      throw new Error("expected table cards");
    }

    expect(percentCard.rows[0]?.values[0]?.displayValue).toBe("45%");
    expect(meanCard.rows[0]?.values[0]?.displayValue).toBe("3.5");
  });

  it("preserves row kind metadata for grounded table cards", () => {
    const card = getTableCard(context, {
      tableId: "q4_frequency_stats",
      valueMode: "pct",
    });

    expect(card.status).toBe("available");
    if (card.status !== "available") {
      throw new Error("expected table card");
    }

    expect(card.rows.map((row) => ({
      label: row.label,
      rowKind: row.rowKind,
      statType: row.statType,
    }))).toEqual([
      { label: "Top 2 Box", rowKind: "net", statType: null },
      { label: "Std Dev", rowKind: "stat", statType: "stddev" },
      { label: "Std Err", rowKind: "stat", statType: "stderr" },
    ]);
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
