import { describe, expect, it } from "vitest";

import {
  hydrateResultsTablesArtifactForAnalysis,
  parseResultsTablesArtifactWithHydration,
} from "@/lib/analysis/grounding";

describe("parseResultsTablesArtifactWithHydration", () => {
  it("hydrates legacy results tables with ordered columns and rows when compute package is available", () => {
    const parsed = parseResultsTablesArtifactWithHydration(
      {
        metadata: {
          generatedAt: "2026-04-24T00:00:00.000Z",
          tableCount: 1,
          cutCount: 2,
          bannerGroups: [
            {
              groupName: "Gender",
              columns: [
                { name: "Female", statLetter: "A" },
              ],
            },
          ],
        },
        tables: {
          q1_overall: {
            tableId: "q1_overall",
            questionId: "Q1",
            questionText: "Overall satisfaction",
            tableType: "frequency",
            data: {
              Total: {
                stat_letter: "T",
                B1r2_row_1: { label: "Top 2 Box", pct: 20, n: 245, isNet: true },
                B1r2_row_10: { label: "Std Dev", pct: 1.07, n: 245, isStat: true },
              },
              Female: {
                stat_letter: "A",
                B1r2_row_1: { label: "Top 2 Box", groupName: "Gender", pct: 22, n: 120, isNet: true },
                B1r2_row_10: { label: "Std Dev", groupName: "Gender", pct: 1.1, n: 120, isStat: true },
              },
            },
          },
        },
      },
      {
        rScriptInput: {
          tables: [
            {
              tableId: "q1_overall",
              rows: [
                { label: "Top 2 Box", rowKind: "net", isNet: true, indent: 0 },
                { label: "Std Dev", rowKind: "stat", statType: "stddev", isNet: false, indent: 0 },
              ],
            },
          ],
        },
      },
    );

    expect(parsed.tables.q1_overall.columns).toBeDefined();
    expect(parsed.tables.q1_overall.rows).toBeDefined();

    expect(parsed.tables.q1_overall.columns!.map((column) => column.cutKey)).toEqual([
      "__total__::total",
      "group:gender::female",
    ]);
    expect(parsed.tables.q1_overall.rows!.map((row) => ({
      rowKey: row.rowKey,
      label: row.label,
      valueType: row.valueType,
    }))).toEqual([
      { rowKey: "B1r2_row_1", label: "Top 2 Box", valueType: "pct" },
      { rowKey: "B1r2_row_10", label: "Std Dev", valueType: "stddev" },
    ]);
  });

  it("still throws when the artifact is malformed for reasons unrelated to the new contract", () => {
    expect(() =>
      parseResultsTablesArtifactWithHydration(
        {
          metadata: "bad",
          tables: {},
        },
        null,
      ),
    ).toThrow();
  });

  it("keeps the catalog available when one legacy table cannot be hydrated", () => {
    const result = hydrateResultsTablesArtifactForAnalysis(
      {
        metadata: {
          generatedAt: "2026-04-24T00:00:00.000Z",
          tableCount: 2,
          cutCount: 2,
          bannerGroups: [
            {
              groupName: "Gender",
              columns: [
                { name: "Female", statLetter: "A" },
              ],
            },
          ],
        },
        tables: {
          q1_overall: {
            tableId: "q1_overall",
            questionId: "Q1",
            questionText: "Overall satisfaction",
            tableType: "frequency",
            data: {
              Total: {
                stat_letter: "T",
                row_1: { label: "Top 2 Box", pct: 20, n: 245, isNet: true },
              },
            },
          },
          broken_legacy: {
            tableId: "broken_legacy",
            questionId: "QX",
            questionText: "Broken legacy table",
            tableType: "frequency",
            data: {
              Total: {
                stat_letter: "T",
                row_1: { label: "Only row", pct: 50, n: 100 },
              },
            },
          },
        },
      },
      {
        rScriptInput: {
          tables: [
            {
              tableId: "q1_overall",
              rows: [
                { label: "Top 2 Box", rowKind: "net", isNet: true, indent: 0 },
              ],
            },
          ],
        },
      },
    );

    expect(result.artifact.tables.q1_overall.rows).toBeDefined();
    expect(result.artifact.tables.broken_legacy.rows).toBeUndefined();
    expect(result.brokenTables.broken_legacy).toMatch(/contract mismatch/i);
  });
});
