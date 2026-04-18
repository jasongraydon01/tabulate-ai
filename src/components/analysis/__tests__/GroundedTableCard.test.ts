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
  truncatedColumns: 1,
  defaultScope: "total_only",
  initialVisibleRowCount: 8,
  initialVisibleGroupCount: 0,
  hiddenRowCount: 1,
  hiddenGroupCount: 2,
  hiddenCutCount: 3,
  isExpandable: true,
  requestedRowFilter: null,
  requestedCutFilter: null,
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
  hiddenCutCount: undefined,
  isExpandable: undefined,
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
        { cutKey: "__total__::total", cutName: "Total", rawValue: 1.07, displayValue: "1%", count: null, pct: null, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 1.07, displayValue: "1%", count: null, pct: null, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
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
        { cutKey: "__total__::total", cutName: "Total", rawValue: 0.07, displayValue: "0%", count: null, pct: null, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
      ],
      cellsByCutKey: {
        "__total__::total": { cutKey: "__total__::total", cutName: "Total", rawValue: 0.07, displayValue: "0%", count: null, pct: null, n: 120, mean: null, sigHigherThan: [], sigVsTotal: null },
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

  it("hides stat rows from compact frequency previews while preserving them in expanded view", () => {
    expect(getGroundedTableCardVisibleRows(frequencyCardWithStats, false).map((row) => row.label)).toEqual([
      "Top 2 Box",
      "Probably would not consider this bank",
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

  it("renders the subtitle inline and omits stat rows from the compact frequency card", () => {
    const markup = renderToStaticMarkup(
      React.createElement(GroundedTableCard, { card: frequencyCardWithStats }),
    );

    expect(markup).toContain("Bank consideration");
    expect(markup).toContain("Additional rows available. Expand table for deeper analysis.");
    expect(markup).not.toContain("Std Dev");
    expect(markup).not.toContain("Std Err");
  });
});
