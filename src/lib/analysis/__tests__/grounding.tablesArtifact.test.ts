import { describe, expect, it } from "vitest";

import {
  parseResultsTablesArtifactForAnalysis,
  validateResultsTablesArtifactForAnalysis,
} from "@/lib/analysis/grounding";

describe("parseResultsTablesArtifactForAnalysis", () => {
  it("keeps only final-contract-valid tables in the active analysis artifact", () => {
    const parsed = parseResultsTablesArtifactForAnalysis({
      metadata: {
        generatedAt: "2026-04-24T00:00:00.000Z",
        tableCount: 1,
        cutCount: 2,
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
              row_0_1: { label: "Very satisfied", n: 120, count: 54, pct: 45, isNet: false, indent: 0 },
            },
            Female: {
              stat_letter: "A",
              row_0_1: { label: "Very satisfied", groupName: "Gender", n: 70, count: 38, pct: 54.3, isNet: false, indent: 0 },
            },
          },
          columns: [
            {
              cutKey: "__total__::total",
              cutName: "Total",
              groupKey: "__total__",
              groupName: "Total",
              statLetter: "T",
              baseN: 120,
              isTotal: true,
              order: 0,
            },
            {
              cutKey: "group:gender::female",
              cutName: "Female",
              groupKey: "group:gender",
              groupName: "Gender",
              statLetter: "A",
              baseN: 70,
              isTotal: false,
              order: 1,
            },
          ],
          rows: [
            {
              rowKey: "row_0_1",
              label: "Very satisfied",
              rowKind: "value",
              statType: null,
              indent: 0,
              isNet: false,
              valueType: "pct",
              format: {
                kind: "percent",
                decimals: 0,
              },
              cells: [
                {
                  cutKey: "__total__::total",
                  value: 45,
                  metrics: {
                    pct: 45,
                    count: 54,
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
                  cutKey: "group:gender::female",
                  value: 54.3,
                  metrics: {
                    pct: 54.3,
                    count: 38,
                    n: 70,
                    mean: null,
                    median: null,
                    stddev: null,
                    stderr: null,
                  },
                  sigHigherThan: [],
                  sigVsTotal: null,
                },
              ],
            },
          ],
        },
      },
    });

    expect(parsed.tables.q1_overall.columns).toBeDefined();
    expect(parsed.tables.q1_overall.rows).toBeDefined();
    expect(parsed.tables.q1_overall.rows?.[0]?.cells).toHaveLength(2);
  });

  it("still throws when the artifact is malformed for reasons unrelated to the final contract", () => {
    expect(() =>
      parseResultsTablesArtifactForAnalysis({
        metadata: "bad",
        tables: {},
      }),
    ).toThrow();
  });
});

describe("validateResultsTablesArtifactForAnalysis", () => {
  it("keeps the catalog usable when one table is missing final-contract structure", () => {
    const result = validateResultsTablesArtifactForAnalysis({
      metadata: {
        generatedAt: "2026-04-24T00:00:00.000Z",
        tableCount: 2,
        cutCount: 2,
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
          columns: [
            {
              cutKey: "__total__::total",
              cutName: "Total",
              groupKey: "__total__",
              groupName: "Total",
              statLetter: "T",
              baseN: 245,
              isTotal: true,
              order: 0,
            },
          ],
          rows: [
            {
              rowKey: "row_1",
              label: "Top 2 Box",
              rowKind: "net",
              statType: null,
              indent: 0,
              isNet: true,
              valueType: "pct",
              format: { kind: "percent", decimals: 0 },
              cells: [
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
              ],
            },
          ],
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
    });

    expect(result.artifact.tables.q1_overall.rows).toBeDefined();
    expect(result.artifact.tables.broken_legacy).toBeUndefined();
    expect(result.brokenTables.broken_legacy).toMatch(/invalid final table contract/i);
  });

  it("quarantines non-object malformed tables instead of failing the whole artifact", () => {
    const result = validateResultsTablesArtifactForAnalysis({
      metadata: {
        generatedAt: "2026-04-24T00:00:00.000Z",
        tableCount: 2,
        cutCount: 1,
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
          columns: [
            {
              cutKey: "__total__::total",
              cutName: "Total",
              groupKey: "__total__",
              groupName: "Total",
              statLetter: "T",
              baseN: 245,
              isTotal: true,
              order: 0,
            },
          ],
          rows: [
            {
              rowKey: "row_1",
              label: "Top 2 Box",
              rowKind: "net",
              statType: null,
              indent: 0,
              isNet: true,
              valueType: "pct",
              format: { kind: "percent", decimals: 0 },
              cells: [
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
              ],
            },
          ],
        },
        broken_non_object: "oops",
      },
    });

    expect(result.artifact.tables.q1_overall.rows).toBeDefined();
    expect(result.artifact.tables.broken_non_object).toBeUndefined();
    expect(result.brokenTables.broken_non_object).toMatch(/invalid final table contract/i);
  });
});
