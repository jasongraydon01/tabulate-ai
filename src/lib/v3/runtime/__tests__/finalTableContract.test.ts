import { describe, expect, it } from "vitest";

import { buildFinalTablesContract } from "@/lib/v3/runtime/finalTableContract";

describe("buildFinalTablesContract", () => {
  it("enriches results tables with ordered columns and mixed-format row metadata", () => {
    const result = buildFinalTablesContract(
      {
        metadata: {
          generatedAt: "2026-04-24T00:00:00.000Z",
          tableCount: 1,
          cutCount: 3,
          bannerGroups: [
            {
              groupName: "Gender",
              columns: [
                { name: "Female", statLetter: "A" },
                { name: "Male", statLetter: "B" },
              ],
            },
          ],
        },
        tables: {
          b1__scale_item_detail_full_b1r2: {
            tableId: "b1__scale_item_detail_full_b1r2",
            questionId: "B1",
            questionText: "Bank consideration",
            tableType: "frequency",
            data: {
              Total: {
                stat_letter: "T",
                B1r2_row_1: { label: "Top 2 Box", pct: 20, n: 245, isNet: true },
                B1r2_row_2: { label: "Probably would not consider this bank", pct: 16, n: 245, indent: 1 },
                B1r2_row_3: { label: "Mean", mean: 2.7, n: 245, isStat: true },
                B1r2_row_4: { label: "Median", median: 3, n: 245, isStat: true },
                B1r2_row_10: { label: "Std Dev", pct: 1.07, n: 245, isStat: true },
                B1r2_row_11: { label: "Std Err", pct: 0.07, n: 245, isStat: true },
              },
              Female: {
                stat_letter: "A",
                B1r2_row_1: { label: "Top 2 Box", groupName: "Gender", pct: 22, n: 120, isNet: true },
                B1r2_row_2: { label: "Probably would not consider this bank", groupName: "Gender", pct: 14, n: 120, indent: 1 },
                B1r2_row_3: { label: "Mean", groupName: "Gender", mean: 2.8, n: 120, isStat: true },
                B1r2_row_4: { label: "Median", groupName: "Gender", median: 3, n: 120, isStat: true },
                B1r2_row_10: { label: "Std Dev", groupName: "Gender", pct: 1.1, n: 120, isStat: true },
                B1r2_row_11: { label: "Std Err", groupName: "Gender", pct: 0.1, n: 120, isStat: true },
              },
              Male: {
                stat_letter: "B",
                B1r2_row_1: { label: "Top 2 Box", groupName: "Gender", pct: 18, n: 125, isNet: true },
                B1r2_row_2: { label: "Probably would not consider this bank", groupName: "Gender", pct: 17, n: 125, indent: 1 },
                B1r2_row_3: { label: "Mean", groupName: "Gender", mean: 2.6, n: 125, isStat: true },
                B1r2_row_4: { label: "Median", groupName: "Gender", median: 3, n: 125, isStat: true },
                B1r2_row_10: { label: "Std Dev", groupName: "Gender", pct: 1.04, n: 125, isStat: true },
                B1r2_row_11: { label: "Std Err", groupName: "Gender", pct: 0.09, n: 125, isStat: true },
              },
            },
          },
        },
      },
      {
        rScriptInput: {
          tables: [
            {
              tableId: "b1__scale_item_detail_full_b1r2",
              tableType: "frequency",
              rows: [
                { label: "Top 2 Box", rowKind: "net", isNet: true, indent: 0 },
                { label: "Probably would not consider this bank", rowKind: "value", isNet: false, indent: 1 },
                { label: "Mean", rowKind: "stat", statType: "mean", isNet: false, indent: 0 },
                { label: "Median", rowKind: "stat", statType: "median", isNet: false, indent: 0 },
                { label: "Std Dev", rowKind: "stat", statType: "stddev", isNet: false, indent: 0 },
                { label: "Std Err", rowKind: "stat", statType: "stderr", isNet: false, indent: 0 },
              ],
            },
          ],
        },
      },
    );

    const table = result.tables.b1__scale_item_detail_full_b1r2;
    expect(table.columns.map((column) => column.cutKey)).toEqual([
      "__total__::total",
      "group:gender::female",
      "group:gender::male",
    ]);
    expect(table.rows.map((row) => row.rowKey)).toEqual([
      "B1r2_row_1",
      "B1r2_row_2",
      "B1r2_row_3",
      "B1r2_row_4",
      "B1r2_row_10",
      "B1r2_row_11",
    ]);
    expect(table.rows.map((row) => ({
      label: row.label,
      rowKind: row.rowKind,
      statType: row.statType,
      valueType: row.valueType,
      format: row.format,
    }))).toEqual([
      {
        label: "Top 2 Box",
        rowKind: "net",
        statType: null,
        valueType: "pct",
        format: { kind: "percent", decimals: 0 },
      },
      {
        label: "Probably would not consider this bank",
        rowKind: "value",
        statType: null,
        valueType: "pct",
        format: { kind: "percent", decimals: 0 },
      },
      {
        label: "Mean",
        rowKind: "stat",
        statType: "mean",
        valueType: "mean",
        format: { kind: "number", decimals: 1 },
      },
      {
        label: "Median",
        rowKind: "stat",
        statType: "median",
        valueType: "median",
        format: { kind: "number", decimals: 1 },
      },
      {
        label: "Std Dev",
        rowKind: "stat",
        statType: "stddev",
        valueType: "stddev",
        format: { kind: "number", decimals: 2 },
      },
      {
        label: "Std Err",
        rowKind: "stat",
        statType: "stderr",
        valueType: "stderr",
        format: { kind: "number", decimals: 2 },
      },
    ]);
    expect(table.rows[0]?.cells).toEqual([
      {
        cutKey: "__total__::total",
        value: 20,
        metrics: {
          pct: 20,
          count: null,
          n: 245,
          mean: null,
          median: null,
          stddev: null,
          stderr: null,
        },
        sigHigherThan: [],
        sigVsTotal: null,
      },
      {
        cutKey: "group:gender::female",
        value: 22,
        metrics: {
          pct: 22,
          count: null,
          n: 120,
          mean: null,
          median: null,
          stddev: null,
          stderr: null,
        },
        sigHigherThan: [],
        sigVsTotal: null,
      },
      {
        cutKey: "group:gender::male",
        value: 18,
        metrics: {
          pct: 18,
          count: null,
          n: 125,
          mean: null,
          median: null,
          stddev: null,
          stderr: null,
        },
        sigHigherThan: [],
        sigVsTotal: null,
      },
    ]);
    expect(table.rows[4]?.cells[0]).toEqual({
      cutKey: "__total__::total",
      value: 1.07,
      metrics: {
        pct: 1.07,
        count: null,
        n: 245,
        mean: null,
        median: null,
        stddev: null,
        stderr: null,
      },
      sigHigherThan: [],
      sigVsTotal: null,
    });
  });

  it("uses compute cut ordering and preserves numeric mean_rows display semantics", () => {
    const result = buildFinalTablesContract(
      {
        metadata: {
          generatedAt: "2026-04-24T00:00:00.000Z",
          tableCount: 1,
          cutCount: 3,
          bannerGroups: [
            {
              groupName: "Segments",
              columns: [
                { name: "Segment B", statLetter: "B" },
                { name: "Segment A", statLetter: "A" },
              ],
            },
          ],
        },
        tables: {
          q5_mean_rows: {
            tableId: "q5_mean_rows",
            questionId: "Q5",
            questionText: "Mean score by item",
            tableType: "mean_rows",
            data: {
              "Segment B": {
                stat_letter: "B",
                Q5_1: { label: "Item A", groupName: "Segments", n: 40, mean: 3.1, median: 3.0, sd: 1.2, std_err: 0.19 },
                Q5_2: { label: "Item B", groupName: "Segments", n: 40, mean: 4.4, median: 4.0, sd: 1.1, std_err: 0.17 },
              },
              Total: {
                stat_letter: "T",
                Q5_1: { label: "Item A", groupName: "Total", n: 100, mean: 3.7, median: 4.0, sd: 1.0, std_err: 0.1 },
                Q5_2: { label: "Item B", groupName: "Total", n: 100, mean: 4.1, median: 4.0, sd: 0.9, std_err: 0.09 },
              },
              "Segment A": {
                stat_letter: "A",
                Q5_1: { label: "Item A", groupName: "Segments", n: 60, mean: 4.0, median: 4.0, sd: 0.8, std_err: 0.1 },
                Q5_2: { label: "Item B", groupName: "Segments", n: 60, mean: 3.9, median: 4.0, sd: 0.7, std_err: 0.09 },
              },
            },
          },
        },
      },
      {
        rScriptInput: {
          cuts: [
            { name: "Total", statLetter: "T", groupName: "Total" },
            { name: "Segment A", statLetter: "A", groupName: "Segments" },
            { name: "Segment B", statLetter: "B", groupName: "Segments" },
          ],
          tables: [
            {
              tableId: "q5_mean_rows",
              tableType: "mean_rows",
              rows: [
                { label: "Item A", rowKind: "value", isNet: false, indent: 0 },
                { label: "Item B", rowKind: "value", isNet: false, indent: 0 },
              ],
            },
          ],
        },
      },
    );

    const table = result.tables.q5_mean_rows;
    expect(table.columns.map((column) => column.cutName)).toEqual([
      "Total",
      "Segment A",
      "Segment B",
    ]);
    expect(table.rows.map((row) => ({
      rowKey: row.rowKey,
      label: row.label,
      rowKind: row.rowKind,
      statType: row.statType,
      indent: row.indent,
      isNet: row.isNet,
      valueType: row.valueType,
      format: row.format,
    }))).toEqual([
      {
        rowKey: "Q5_1",
        label: "Item A",
        rowKind: "value",
        statType: null,
        indent: 0,
        isNet: false,
        valueType: "mean",
        format: { kind: "number", decimals: 1 },
      },
      {
        rowKey: "Q5_2",
        label: "Item B",
        rowKind: "value",
        statType: null,
        indent: 0,
        isNet: false,
        valueType: "mean",
        format: { kind: "number", decimals: 1 },
      },
    ]);
    expect(table.rows[0]?.cells).toEqual([
      {
        cutKey: "__total__::total",
        value: 3.7,
        metrics: {
          pct: null,
          count: null,
          n: 100,
          mean: 3.7,
          median: 4,
          stddev: 1,
          stderr: 0.1,
        },
        sigHigherThan: [],
        sigVsTotal: null,
      },
      {
        cutKey: "group:segments::segment a",
        value: 4,
        metrics: {
          pct: null,
          count: null,
          n: 60,
          mean: 4,
          median: 4,
          stddev: 0.8,
          stderr: 0.1,
        },
        sigHigherThan: [],
        sigVsTotal: null,
      },
      {
        cutKey: "group:segments::segment b",
        value: 3.1,
        metrics: {
          pct: null,
          count: null,
          n: 40,
          mean: 3.1,
          median: 3,
          stddev: 1.2,
          stderr: 0.19,
        },
        sigHigherThan: [],
        sigVsTotal: null,
      },
    ]);
  });

  it("hydrates the derived demo banner table from compute cuts when compute rows are absent", () => {
    const result = buildFinalTablesContract(
      {
        metadata: {
          generatedAt: "2026-04-24T00:00:00.000Z",
          tableCount: 1,
          cutCount: 3,
          bannerGroups: [
            {
              groupName: "Gender",
              columns: [
                { name: "Female", statLetter: "A" },
                { name: "Male", statLetter: "B" },
              ],
            },
          ],
        },
        tables: {
          _demo_banner_x_banner: {
            tableId: "_demo_banner_x_banner",
            questionId: "",
            questionText: "Banner Profile",
            tableType: "frequency",
            data: {
              Total: {
                stat_letter: "T",
                row_0_Total: { label: "Total", groupName: "Total", pct: 100, n: 200 },
                row_1_T: { label: "Total", groupName: "Total", pct: 100, n: 200 },
                row_2_A: { label: "Female", groupName: "Gender", pct: 55, n: 200 },
                row_3_B: { label: "Male", groupName: "Gender", pct: 45, n: 200 },
              },
              Female: {
                stat_letter: "A",
                row_0_Total: { label: "Total", groupName: "Total", pct: 100, n: 110 },
                row_1_T: { label: "Total", groupName: "Total", pct: 100, n: 110 },
                row_2_A: { label: "Female", groupName: "Gender", pct: 100, n: 110 },
                row_3_B: { label: "Male", groupName: "Gender", pct: 0, n: 110 },
              },
              Male: {
                stat_letter: "B",
                row_0_Total: { label: "Total", groupName: "Total", pct: 100, n: 90 },
                row_1_T: { label: "Total", groupName: "Total", pct: 100, n: 90 },
                row_2_A: { label: "Female", groupName: "Gender", pct: 0, n: 90 },
                row_3_B: { label: "Male", groupName: "Gender", pct: 100, n: 90 },
              },
            },
          },
        },
      },
      {
        rScriptInput: {
          tables: [],
          cuts: [
            { name: "Total", statLetter: "T", groupName: "Total" },
            { name: "Female", statLetter: "A", groupName: "Gender" },
            { name: "Male", statLetter: "B", groupName: "Gender" },
          ],
        },
      },
    );

    const rows = result.tables._demo_banner_x_banner.rows;
    expect(rows.map((row) => ({
      rowKey: row.rowKey,
      label: row.label,
      rowKind: row.rowKind,
      statType: row.statType,
      indent: row.indent,
      isNet: row.isNet,
      valueType: row.valueType,
      format: row.format,
    }))).toEqual([
      {
        rowKey: "row_0_Total",
        label: "Total",
        rowKind: "value",
        statType: null,
        indent: 0,
        isNet: false,
        valueType: "pct",
        format: { kind: "percent", decimals: 0 },
      },
      {
        rowKey: "row_1_T",
        label: "Total",
        rowKind: "value",
        statType: null,
        indent: 0,
        isNet: false,
        valueType: "pct",
        format: { kind: "percent", decimals: 0 },
      },
      {
        rowKey: "row_2_A",
        label: "Female",
        rowKind: "value",
        statType: null,
        indent: 0,
        isNet: false,
        valueType: "pct",
        format: { kind: "percent", decimals: 0 },
      },
      {
        rowKey: "row_3_B",
        label: "Male",
        rowKind: "value",
        statType: null,
        indent: 0,
        isNet: false,
        valueType: "pct",
        format: { kind: "percent", decimals: 0 },
      },
    ]);
    expect(rows[2]?.cells.map((cell) => ({
      cutKey: cell.cutKey,
      value: cell.value,
    }))).toEqual([
      { cutKey: "__total__::total", value: 55 },
      { cutKey: "group:gender::female", value: 100 },
      { cutKey: "group:gender::male", value: 0 },
    ]);
  });
});
