import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  GroundedTableCard,
  getGroundedTableCardSignificanceMarkers,
  getGroundedTableCardVisibleGroups,
  getGroundedTableCardVisibleRows,
  normalizeGroundedTableCardGroups,
} from "@/components/analysis/GroundedTableCard";
import type { AnalysisTableCard } from "@/lib/analysis/types";
import { getAnalysisCellAnchorId } from "@/lib/analysis/anchors";

const groupedCard: AnalysisTableCard = {
  status: "available",
  tableId: "q1",
  title: "Q1 overall",
  questionId: "Q1",
  questionText: "How satisfied are you?",
  tableType: "frequency",
  surveySection: null,
  baseText: "All respondents",
  tableSubtitle: "Overall",
  userNote: "Support note",
  valueMode: "pct",
  columns: [
    { cutKey: "__total__::total", cutName: "Total", groupName: "Total", statLetter: "T", baseN: 120, isTotal: true },
    { cutKey: "group:gender::female", cutName: "Female", groupName: "Gender", statLetter: "A", baseN: 70, isTotal: false },
    { cutKey: "group:gender::male", cutName: "Male", groupName: "Gender", statLetter: "B", baseN: 50, isTotal: false },
    { cutKey: "group:region::east", cutName: "East", groupName: "Region", statLetter: "C", baseN: 60, isTotal: false },
  ],
  columnGroups: [
    {
      groupKey: "__total__",
      groupName: "Total",
      columns: [
        { cutKey: "__total__::total", cutName: "Total", groupName: "Total", statLetter: "T", baseN: 120, isTotal: true },
      ],
    },
    {
      groupKey: "group:gender",
      groupName: "Gender",
      columns: [
        { cutKey: "group:gender::female", cutName: "Female", groupName: "Gender", statLetter: "A", baseN: 70, isTotal: false },
        { cutKey: "group:gender::male", cutName: "Male", groupName: "Gender", statLetter: "B", baseN: 50, isTotal: false },
      ],
    },
    {
      groupKey: "group:region",
      groupName: "Region",
      columns: [
        { cutKey: "group:region::east", cutName: "East", groupName: "Region", statLetter: "C", baseN: 60, isTotal: false },
      ],
    },
  ],
  rows: [
    {
      rowKey: "row_1",
      label: "Very satisfied",
      indent: 0,
      isNet: false,
      values: [
        { cutKey: "__total__::total", cutName: "Total", rawValue: 45, displayValue: "45%", count: 54, pct: 45, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
        { cutKey: "group:gender::female", cutName: "Female", rawValue: 54, displayValue: "54%", count: 38, pct: 54.3, n: 70, mean: null, sigHigherThan: ["B"], sigVsTotal: null },
        { cutKey: "group:gender::male", cutName: "Male", rawValue: 32, displayValue: "32%", count: 16, pct: 32, n: 50, mean: null, sigHigherThan: [], sigVsTotal: "lower" },
        { cutKey: "group:region::east", cutName: "East", rawValue: 51, displayValue: "51%", count: 31, pct: 51.2, n: 60, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 45, displayValue: "45%", count: 54, pct: 45, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
        "group:gender::female": { cutKey: "group:gender::female", cutName: "Female", rawValue: 54, displayValue: "54%", count: 38, pct: 54.3, n: 70, mean: null, sigHigherThan: ["B"], sigVsTotal: null },
        "group:gender::male": { cutKey: "group:gender::male", cutName: "Male", rawValue: 32, displayValue: "32%", count: 16, pct: 32, n: 50, mean: null, sigHigherThan: [], sigVsTotal: "lower" },
        "group:region::east": { cutKey: "group:region::east", cutName: "East", rawValue: 51, displayValue: "51%", count: 31, pct: 51.2, n: 60, mean: null, sigHigherThan: [], sigVsTotal: null },
      },
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      rowKey: `row_${index + 2}`,
      label: `Option ${index + 2}`,
      indent: 0,
      isNet: false,
      values: [
        { cutKey: "__total__::total", cutName: "Total", rawValue: 10 - index, displayValue: `${10 - index}%`, count: 10 - index, pct: 10 - index, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 10 - index, displayValue: `${10 - index}%`, count: 10 - index, pct: 10 - index, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      },
    })),
  ],
  totalRows: 9,
  totalColumns: 4,
  truncatedRows: 1,
  truncatedColumns: 3,
  defaultScope: "total_only",
  initialVisibleRowCount: 8,
  initialVisibleGroupCount: 0,
  hiddenRowCount: 1,
  hiddenGroupCount: 2,
  focusedCutIds: null,
  requestedCutGroups: null,
  focusedRowKeys: null,
  focusedGroupKeys: null,
  significanceTest: "z-test",
  significanceLevel: 0.1,
  comparisonGroups: ["A/B"],
  sourceRefs: [],
};

const legacyCard: AnalysisTableCard = {
  ...groupedCard,
  columns: [
    { cutName: "Total", groupName: null, statLetter: "T", baseN: 120 },
    { cutName: "Female", groupName: "Gender", statLetter: "A", baseN: 70 },
    { cutName: "Male", groupName: "Gender", statLetter: "B", baseN: 50 },
  ],
  columnGroups: undefined,
  rows: [
    {
      rowKey: "row_1",
      label: "Very satisfied",
      indent: 0,
      isNet: false,
      values: [
        { cutName: "Total", rawValue: 45, displayValue: "45%", count: 54, pct: 45, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
        { cutName: "Female", rawValue: 54, displayValue: "54%", count: 38, pct: 54.3, n: 70, mean: null, sigHigherThan: ["B"], sigVsTotal: null },
        { cutName: "Male", rawValue: 32, displayValue: "32%", count: 16, pct: 32, n: 50, mean: null, sigHigherThan: [], sigVsTotal: "lower" },
      ],
    },
  ],
  totalRows: 1,
  totalColumns: 3,
  truncatedRows: 0,
  truncatedColumns: 0,
  defaultScope: undefined,
  initialVisibleRowCount: undefined,
  initialVisibleGroupCount: undefined,
  hiddenRowCount: undefined,
  hiddenGroupCount: undefined,
  focusedCutIds: null,
};

const frequencyCardWithStats: AnalysisTableCard = {
  ...groupedCard,
  tableSubtitle: "Bank consideration",
  rows: [
    {
      rowKey: "row_top2",
      label: "Top 2 Box",
      rowKind: "net",
      statType: null,
      indent: 0,
      isNet: true,
      values: [
        { cutKey: "__total__::total", cutName: "Total", rawValue: 20, displayValue: "20%", count: 24, pct: 20, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 20, displayValue: "20%", count: 24, pct: 20, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      },
    },
    {
      rowKey: "row_stddev",
      label: "Std Dev",
      rowKind: "stat",
      statType: "stddev",
      indent: 0,
      isNet: false,
      values: [
        { cutKey: "__total__::total", cutName: "Total", rawValue: 1.07, displayValue: "1.07", count: null, pct: null, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 1.07, displayValue: "1.07", count: null, pct: null, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      },
    },
    {
      rowKey: "row_mid",
      label: "Probably would not consider this bank",
      rowKind: "value",
      statType: null,
      indent: 1,
      isNet: false,
      values: [
        { cutKey: "__total__::total", cutName: "Total", rawValue: 16, displayValue: "16%", count: 19, pct: 16, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 16, displayValue: "16%", count: 19, pct: 16, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      },
    },
    {
      rowKey: "row_stderr",
      label: "Std Err",
      rowKind: "stat",
      statType: "stderr",
      indent: 0,
      isNet: false,
      values: [
        { cutKey: "__total__::total", cutName: "Total", rawValue: 0.07, displayValue: "0.07", count: null, pct: null, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 0.07, displayValue: "0.07", count: null, pct: null, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      },
    },
    {
      rowKey: "row_bottom2",
      label: "Bottom 2 Box",
      rowKind: "net",
      statType: null,
      indent: 0,
      isNet: true,
      values: [
        { cutKey: "__total__::total", cutName: "Total", rawValue: 43, displayValue: "43%", count: 52, pct: 43, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 43, displayValue: "43%", count: 52, pct: 43, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      },
    },
  ],
  totalRows: 5,
  initialVisibleRowCount: 8,
  hiddenRowCount: 0,
  truncatedRows: 0,
};

describe("GroundedTableCard helpers", () => {
  it("normalizes legacy column groups", () => {
    const groups = normalizeGroundedTableCardGroups(legacyCard);

    expect(groups.map((group) => group.groupName)).toEqual(["Total", "Gender"]);
    expect(groups[1]?.columns.map((column) => column.cutName)).toEqual(["Female", "Male"]);
  });

  it("shows only the total group by default for total-first preview cards", () => {
    const visibleGroups = getGroundedTableCardVisibleGroups(groupedCard, false);

    expect(visibleGroups.map((group) => group.groupName)).toEqual(["Total"]);
    expect(getGroundedTableCardVisibleGroups(groupedCard, true)).toHaveLength(3);
  });

  it("respects row preview counts until expanded", () => {
    expect(getGroundedTableCardVisibleRows(groupedCard, false)).toHaveLength(8);
    expect(getGroundedTableCardVisibleRows(groupedCard, true)).toHaveLength(9);
  });

  it("keeps stat rows in both compact and expanded views; truncation is the only row simplification", () => {
    expect(getGroundedTableCardVisibleRows(frequencyCardWithStats, false).map((row) => row.label)).toEqual([
      "Top 2 Box",
      "Std Dev",
      "Probably would not consider this bank",
      "Std Err",
      "Bottom 2 Box",
    ]);
    expect(getGroundedTableCardVisibleRows(frequencyCardWithStats, true).map((row) => row.label)).toEqual([
      "Top 2 Box",
      "Std Dev",
      "Probably would not consider this bank",
      "Std Err",
      "Bottom 2 Box",
    ]);
  });

  it("builds inline significance markers including total comparisons", () => {
    const row = groupedCard.rows[0];
    const totalColumn = groupedCard.columns[0];
    const femaleColumn = groupedCard.columns[1];
    const maleColumn = groupedCard.columns[2];

    expect(row && femaleColumn && getGroundedTableCardSignificanceMarkers(row, femaleColumn, groupedCard.columns)).toEqual(["B"]);
    expect(row && maleColumn && getGroundedTableCardSignificanceMarkers(row, maleColumn, groupedCard.columns)).toEqual([]);
    expect(row && totalColumn && getGroundedTableCardSignificanceMarkers(row, totalColumn, groupedCard.columns)).toEqual(["B"]);
  });

  it("renders the collapsed card without inline metadata prose or vs-total text", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, { card: groupedCard }),
    );
    const expandedColumnsMarkup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, { card: legacyCard }),
    );

    expect(markup).toContain("Q1. How satisfied are you?");
    expect(markup).toContain("Total");
    expect(markup).toContain("(T)");
    expect(expandedColumnsMarkup).toContain("(A)");
    expect(markup).not.toContain("Total (Percent)");
    expect(markup).toContain("Details");
    expect(markup).toContain("Expand table for deeper analysis");
    expect(markup).toContain(">Base<");
    expect(markup).not.toContain("Base: All respondents");
    expect(markup).not.toContain("vs total");
  });

  it("renders the subtitle inline and includes mixed numeric stat rows in the compact frequency card", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, { card: frequencyCardWithStats }),
    );

    expect(markup).toContain("Bank consideration");
    expect(markup).toContain("Expand table for deeper analysis");
    expect(markup).toContain("Std Dev");
    expect(markup).toContain("Std Err");
    expect(markup).toContain("1.07");
    expect(markup).toContain("0.07");
  });

  it("keeps the expanded dialog header minimal without duplicate pills or helper copy", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, { card: groupedCard }),
    );

    expect(markup).not.toContain("Full table view for this grounded result");
    expect(markup).not.toContain("Percent");
    expect(markup).not.toContain("data-slot=\"badge\"");
  });

  it("always renders the expand button on available cards, even when nothing is truncated", () => {
    const untruncatedCard: AnalysisTableCard = {
      ...groupedCard,
      rows: groupedCard.rows.slice(0, 1),
      totalRows: 1,
      truncatedRows: 0,
      truncatedColumns: 0,
      initialVisibleRowCount: 1,
      initialVisibleGroupCount: 3,
      hiddenRowCount: 0,
      hiddenGroupCount: 0,
      defaultScope: "matched_groups",
    };

    const markup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, { card: untruncatedCard }),
    );

    expect(markup).toContain("Expand table for deeper analysis");
  });

  it("leads the compact view with render-focused groups", () => {
    const visibleGroups = getGroundedTableCardVisibleGroups(groupedCard, false, {
      focusedGroupKeys: ["group:gender"],
    });
    expect(visibleGroups.map((group) => group.groupName)).toEqual(["Total", "Gender"]);
  });

  it("carries every USED group in the card payload even when focus narrows the compact view", () => {
    // The compact inline view leads with the focused Gender group; the full
    // payload (which the details disclosure and expand dialog both render
    // from) must still include every USED group on the source table.
    const focusedCard: AnalysisTableCard = {
      ...groupedCard,
      defaultScope: "matched_groups",
      initialVisibleGroupCount: 1,
      hiddenGroupCount: 1,
      focusedCutIds: ["group:gender::female", "group:gender::male"],
    };

    const allGroups = normalizeGroundedTableCardGroups(focusedCard);
    expect(allGroups.map((group) => group.groupName)).toEqual(["Total", "Gender", "Region"]);

    const compactGroups = getGroundedTableCardVisibleGroups(focusedCard, false);
    expect(compactGroups.map((group) => group.groupName)).toEqual(["Total", "Gender"]);

    const expandedGroups = getGroundedTableCardVisibleGroups(focusedCard, true);
    expect(expandedGroups.map((group) => group.groupName)).toEqual(["Total", "Gender", "Region"]);
  });

  it("preserves contract group order even when legacy focused cuts narrow the compact view", () => {
    const regionFocusedCard: AnalysisTableCard = {
      ...groupedCard,
      defaultScope: "matched_groups",
      initialVisibleGroupCount: 1,
      hiddenGroupCount: 1,
      focusedCutIds: ["group:region::east"],
    };

    expect(normalizeGroundedTableCardGroups(regionFocusedCard).map((group) => group.groupName)).toEqual([
      "Total",
      "Gender",
      "Region",
    ]);
    expect(getGroundedTableCardVisibleGroups(regionFocusedCard, false).map((group) => group.groupName)).toEqual([
      "Total",
      "Region",
    ]);
  });

  it("keeps row order contract-faithful and only highlights focused rows", () => {
    const visibleRows = getGroundedTableCardVisibleRows(groupedCard, false, {
      focusedRowKeys: ["row_3"],
    });
    expect(visibleRows[0]?.rowKey).toBe("row_1");
    expect(visibleRows[2]?.rowKey).toBe("row_3");

    const markup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, {
        card: groupedCard,
        focus: { focusedRowKeys: ["row_3"] },
      }),
    );

    expect(markup).toContain("border-l-2");
  });

  it("renders cell values from row-level format semantics and keeps citation anchors on the rendered cell", () => {
    const formattedCard: AnalysisTableCard = {
      ...groupedCard,
      rows: [
        {
          rowKey: "row_decimal",
          label: "Decimal row",
          rowKind: "value",
          statType: null,
          valueType: "stddev",
          format: { kind: "number", decimals: 2 },
          indent: 0,
          isNet: false,
          values: [
            {
              cutKey: "__total__::total",
              cutName: "Total",
              rawValue: 1.07,
              displayValue: "stale",
              count: null,
              pct: null,
              n: 120,
              mean: null,
              sigHigherThan: [],
              sigVsTotal: null,
            },
          ],
          cellsByCutKey: {
            "__total__::total": {
              cutKey: "__total__::total",
              cutName: "Total",
              rawValue: 1.07,
              displayValue: "stale",
              count: null,
              pct: null,
              n: 120,
              mean: null,
              sigHigherThan: [],
              sigVsTotal: null,
            },
          },
        },
      ],
      totalRows: 1,
      truncatedRows: 0,
      hiddenRowCount: 0,
      initialVisibleRowCount: 1,
    };

    const markup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, { card: formattedCard }),
    );

    expect(markup).toContain(">1.07<");
    expect(markup).not.toContain(">stale<");
    expect(markup).toContain(`id="${getAnalysisCellAnchorId("q1|row_decimal|__total__%3A%3Atotal")}"`);
  });

  it("renders a reserved shell footprint when the card is in shell mode", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, {
        card: groupedCard,
        displayState: "shell",
      }),
    );

    expect(markup).toContain("data-analysis-table-shell=\"true\"");
    expect(markup).not.toContain("Q1. How satisfied are you?");
  });
});
