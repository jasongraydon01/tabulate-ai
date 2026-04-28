import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisGroundingContext } from "@/lib/analysis/grounding";
import type { AnalysisTableCard, AnalysisTableCardRow } from "@/lib/analysis/types";
import { computeTableRollupArtifact, createAnalysisTableRollupProposal } from "../tableRollup";

const mocks = vi.hoisted(() => ({
  downloadFile: vi.fn(),
  mutateInternal: vi.fn(),
  fetchTable: vi.fn(),
  parseRunResult: vi.fn(),
}));

vi.mock("@/lib/r2/r2", () => ({
  downloadFile: mocks.downloadFile,
}));

vi.mock("@/lib/convex", () => ({
  mutateInternal: mocks.mutateInternal,
}));

vi.mock("@/schemas/runResultSchema", () => ({
  parseRunResult: mocks.parseRunResult,
}));

vi.mock("@/lib/analysis/grounding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analysis/grounding")>();
  return {
    ...actual,
    fetchTable: mocks.fetchTable,
  };
});

const groundingContext = {} as AnalysisGroundingContext;

function makeCell(count: number, n: number, cutKey: string, cutName: string) {
  const pct = (count / n) * 100;
  return {
    cutKey,
    cutName,
    rawValue: pct,
    displayValue: `${pct.toFixed(0)}%`,
    count,
    pct,
    n,
    mean: null,
    sigHigherThan: [],
    sigVsTotal: null,
  };
}

function sourceTable(overrides: Partial<AnalysisTableCard> = {}): AnalysisTableCard {
  const columns = [
    { cutKey: "__total__::total", cutName: "Total", groupName: null, statLetter: null, baseN: 100, isTotal: true },
    { cutKey: "age::young", cutName: "Young", groupName: "Age", statLetter: "A", baseN: 50 },
  ];
  const rows: AnalysisTableCardRow[] = [
    {
      rowKey: "row_1",
      label: "Somewhat satisfied",
      rowKind: "value",
      statType: null,
      valueType: "pct",
      format: { kind: "percent" as const, decimals: 0 },
      indent: 0,
      isNet: false,
      values: [
        makeCell(20, 100, "__total__::total", "Total"),
        makeCell(10, 50, "age::young", "Young"),
      ],
    },
    {
      rowKey: "row_2",
      label: "Very satisfied",
      rowKind: "value",
      statType: null,
      valueType: "pct",
      format: { kind: "percent" as const, decimals: 0 },
      indent: 0,
      isNet: false,
      values: [
        makeCell(30, 100, "__total__::total", "Total"),
        makeCell(15, 50, "age::young", "Young"),
      ],
    },
    {
      rowKey: "row_3",
      label: "Neutral",
      rowKind: "value",
      statType: null,
      valueType: "pct",
      format: { kind: "percent" as const, decimals: 0 },
      indent: 0,
      isNet: false,
      values: [
        makeCell(10, 100, "__total__::total", "Total"),
        makeCell(5, 50, "age::young", "Young"),
      ],
    },
    {
      rowKey: "row_4",
      label: "Dissatisfied",
      rowKind: "value",
      statType: null,
      valueType: "pct",
      format: { kind: "percent" as const, decimals: 0 },
      indent: 0,
      isNet: false,
      values: [
        makeCell(15, 100, "__total__::total", "Total"),
        makeCell(8, 50, "age::young", "Young"),
      ],
    },
  ];
  return {
    status: "available",
    tableId: "q1",
    title: "Q1 Satisfaction",
    questionId: "Q1",
    questionText: "How satisfied are you?",
    tableType: "frequency",
    surveySection: null,
    baseText: null,
    tableSubtitle: null,
    userNote: null,
    valueMode: "pct",
    columns,
    rows: rows.map((row) => ({
      ...row,
      cellsByCutKey: Object.fromEntries(row.values.map((value) => [value.cutKey, value])),
    })),
    totalRows: rows.length,
    totalColumns: columns.length,
    truncatedRows: 0,
    truncatedColumns: 0,
    sourceRefs: [],
    significanceTest: null,
    significanceLevel: 0.1,
    comparisonGroups: [],
    ...overrides,
  };
}

function canonicalArtifact(rows = [
  { variable: "Q1", label: "Somewhat satisfied", filterValue: "4", rowKind: "value", isNet: false },
  { variable: "Q1", label: "Very satisfied", filterValue: "5", rowKind: "value", isNet: false },
  { variable: "Q1", label: "Neutral", filterValue: "3", rowKind: "value", isNet: false },
  { variable: "Q1", label: "Dissatisfied", filterValue: "2", rowKind: "value", isNet: false },
]) {
  return {
    tables: [{
      tableId: "q1",
      rows,
    }],
  };
}

function baseParams() {
  return {
    orgId: "org-1" as never,
    projectId: "project-1" as never,
    parentRunId: "run-1" as never,
    sessionId: "session-1" as never,
    requestedBy: "user-1" as never,
    requestText: "Create row roll-ups on Q1",
    parentRun: {
      _id: "run-1" as never,
      status: "success",
      result: {},
    },
    groundingContext,
  };
}

describe("createAnalysisTableRollupProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.parseRunResult.mockReturnValue({
      r2Files: {
        outputs: {
          "tables/13e-table-enriched.json": "r2://canonical-table-key",
        },
      },
    });
    mocks.downloadFile.mockResolvedValue(Buffer.from(JSON.stringify(canonicalArtifact())));
    mocks.fetchTable.mockReturnValue(sourceTable());
    mocks.mutateInternal.mockResolvedValue("job-1");
  });

  it("creates a sanitized proposal with multiple artifact-safe output rows", async () => {
    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        outputRows: [
          {
            label: "Top 2 Box",
            sourceRows: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
          },
          {
            label: "Bottom Box",
            sourceRows: [{ rowKey: "row_3" }, { rowKey: "row_4" }],
          },
        ],
      }],
    });

    expect(result).toMatchObject({
      status: "validated_proposal",
      jobId: "job-1",
      jobType: "table_rollup_derivation",
      sourceTable: {
        tableId: "q1",
      },
      outputRows: [
        {
          label: "Top 2 Box",
          mechanism: "artifact_exclusive_sum",
          sourceRows: [
            { rowKey: "row_1", label: "Somewhat satisfied" },
            { rowKey: "row_2", label: "Very satisfied" },
          ],
        },
        {
          label: "Bottom Box",
          mechanism: "artifact_exclusive_sum",
          sourceRows: [
            { rowKey: "row_3", label: "Neutral" },
            { rowKey: "row_4", label: "Dissatisfied" },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("r2://canonical-table-key");
    expect(JSON.stringify(result)).not.toContain("fingerprint");
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal.mock.calls[0]?.[1]).toMatchObject({
      requestText: "Create row roll-ups on Q1",
      frozenTableRollupSpec: {
        schemaVersion: 2,
        derivationType: "row_rollup",
        sourceTable: { tableId: "q1" },
        outputRows: [
          { label: "Top 2 Box", mechanism: "artifact_exclusive_sum" },
          { label: "Bottom Box", mechanism: "artifact_exclusive_sum" },
        ],
        resolvedComputePlan: {
          outputRows: [
            {
              label: "Top 2 Box",
              mechanism: "artifact_exclusive_sum",
              sourceRows: [
                { rowKey: "row_1", label: "Somewhat satisfied", variable: "Q1", filterValue: "4" },
                { rowKey: "row_2", label: "Very satisfied", variable: "Q1", filterValue: "5" },
              ],
            },
            {
              label: "Bottom Box",
              mechanism: "artifact_exclusive_sum",
              sourceRows: [
                { rowKey: "row_3", label: "Neutral", variable: "Q1", filterValue: "3" },
                { rowKey: "row_4", label: "Dissatisfied", variable: "Q1", filterValue: "2" },
              ],
            },
          ],
        },
      },
    });
  });

  it("returns repair feedback and creates no job for a wrong table id", async () => {
    mocks.fetchTable.mockReturnValueOnce({ status: "not_found", tableId: "missing" });

    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "missing",
        outputRows: [{
          label: "Top 2 Box",
          sourceRows: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
        }],
      }],
    });

    expect(result.status).toBe("rejected_candidate");
    if (result.status === "rejected_candidate") {
      expect(result.invalidTableIds).toEqual(["missing"]);
      expect(result.repairHints.join(" ")).toContain("Search or fetch the table again");
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("returns repair feedback and creates no job for a wrong row ref", async () => {
    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        outputRows: [{
          label: "Top 2 Box",
          sourceRows: [{ rowKey: "row_1" }, { rowKey: "row_missing" }],
        }],
      }],
    });

    expect(result.status).toBe("rejected_candidate");
    if (result.status === "rejected_candidate") {
      expect(result.invalidRowRefs).toEqual([{ tableId: "q1", rowRef: "row_missing" }]);
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("classifies multi-variable binary rows as respondent any-of but creates no job until respondent-level compute is available", async () => {
    mocks.downloadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(canonicalArtifact([
      { variable: "Q1_A", label: "Somewhat satisfied", filterValue: "1", rowKind: "value", isNet: false },
      { variable: "Q1_B", label: "Very satisfied", filterValue: "1", rowKind: "value", isNet: false },
      { variable: "Q1_C", label: "Neutral", filterValue: "1", rowKind: "value", isNet: false },
      { variable: "Q1_D", label: "Dissatisfied", filterValue: "1", rowKind: "value", isNet: false },
    ]))));

    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        outputRows: [{
          label: "Any satisfied",
          sourceRows: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
        }],
      }],
    });

    expect(result.status).toBe("rejected_candidate");
    if (result.status === "rejected_candidate") {
      expect(result.blockedMechanisms).toEqual([expect.objectContaining({
        label: "Any satisfied",
        mechanism: "respondent_any_of",
      })]);
      expect(result.unsupportedCombinations.join(" ")).not.toContain("spans multiple variables");
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("classifies mean-row tables as metric aggregation but creates no job until metric compute is available", async () => {
    mocks.fetchTable.mockReturnValueOnce(sourceTable({ tableType: "mean_rows" }));
    mocks.downloadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(canonicalArtifact([
      { variable: "Q1_A", label: "Somewhat satisfied", filterValue: "", rowKind: "value", isNet: false },
      { variable: "Q1_B", label: "Very satisfied", filterValue: "", rowKind: "value", isNet: false },
      { variable: "Q1_C", label: "Neutral", filterValue: "", rowKind: "value", isNet: false },
      { variable: "Q1_D", label: "Dissatisfied", filterValue: "", rowKind: "value", isNet: false },
    ]))));

    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        outputRows: [{
          label: "Pfizer medications",
          sourceRows: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
        }],
      }],
    });

    expect(result.status).toBe("rejected_candidate");
    if (result.status === "rejected_candidate") {
      expect(result.blockedMechanisms).toEqual([expect.objectContaining({
        label: "Pfizer medications",
        mechanism: "metric_row_aggregation",
      })]);
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("rejects duplicate source rows within and across output rows before persistence", async () => {
    const duplicateWithin = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        outputRows: [{
          label: "Duplicated Top Box",
          sourceRows: [{ rowKey: "row_1" }, { rowKey: "row_1" }],
        }],
      }],
    });
    expect(duplicateWithin.status).toBe("rejected_candidate");
    if (duplicateWithin.status === "rejected_candidate") {
      expect(duplicateWithin.unsupportedCombinations.join(" ")).toContain("repeats the same source row");
    }

    const duplicateAcross = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        outputRows: [
          { label: "Top 2 Box", sourceRows: [{ rowKey: "row_1" }, { rowKey: "row_2" }] },
          { label: "Also top", sourceRows: [{ rowKey: "row_2" }, { rowKey: "row_3" }] },
        ],
      }],
    });
    expect(duplicateAcross.status).toBe("rejected_candidate");
    if (duplicateAcross.status === "rejected_candidate") {
      expect(duplicateAcross.unsupportedCombinations.join(" ")).toContain("reuses source rows");
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("computes artifact-safe output rows from the resolved plan and keeps unmentioned source rows", async () => {
    mocks.fetchTable.mockReturnValueOnce(sourceTable());

    const artifact = await computeTableRollupArtifact({
      groundingContext,
      jobId: "job-1",
      runResultValue: {},
      spec: {
        schemaVersion: 2,
        derivationType: "row_rollup",
        sourceTable: {
          tableId: "q1",
          title: "Q1 Satisfaction",
          questionId: "Q1",
          questionText: "How satisfied are you?",
        },
        outputRows: [{
          label: "Top 2 Box",
          mechanism: "artifact_exclusive_sum",
          sourceRows: [
            { rowKey: "row_1", label: "Somewhat satisfied" },
            { rowKey: "row_2", label: "Very satisfied" },
          ],
        }],
        resolvedComputePlan: {
          outputRows: [{
            label: "Top 2 Box",
            mechanism: "artifact_exclusive_sum",
            sourceRows: [
              { rowKey: "row_1", label: "Somewhat satisfied", variable: "Q1", filterValue: "4" },
              { rowKey: "row_2", label: "Very satisfied", variable: "Q1", filterValue: "5" },
            ],
          }],
        },
      },
    });

    expect(artifact.rows[0]).toMatchObject({
      label: "Top 2 Box",
      isNet: true,
    });
    expect(artifact.rows[0]?.values).toEqual(expect.arrayContaining([
      expect.objectContaining({ count: 50, pct: 50 }),
    ]));
    expect(artifact.rows.map((row) => row.label)).toEqual([
      "Top 2 Box",
      "Neutral",
      "Dissatisfied",
    ]);
    expect(artifact.focusedRowKeys).toEqual(["derived_rollup_1"]);
    expect(artifact.userNote).toContain("for this analysis session");
    expect(artifact.userNote).toContain("not added to the run's permanent table set");
    expect(artifact.userNote).toContain("Significance markers are not shown");
    expect(artifact.rows[0]?.values.every((cell) => cell.sigHigherThan.length === 0 && cell.sigVsTotal === null)).toBe(true);
  });

  it("allows zero-base columns instead of rejecting an otherwise valid same-variable roll-up", async () => {
    const zeroBaseColumn = { cutKey: "gender::other", cutName: "Gender: Other", groupName: "Gender", statLetter: "B", baseN: 0 };
    const table = sourceTable({
      columns: [
        ...sourceTable().columns,
        zeroBaseColumn,
      ],
      rows: sourceTable().rows.map((row) => {
        const zeroBaseCell = {
          cutKey: zeroBaseColumn.cutKey,
          cutName: zeroBaseColumn.cutName,
          rawValue: 0,
          displayValue: "0%",
          count: 0,
          pct: 0,
          n: 0,
          mean: null,
          sigHigherThan: [],
          sigVsTotal: null,
        };
        const values = [...row.values, zeroBaseCell];
        return {
          ...row,
          values,
          cellsByCutKey: Object.fromEntries(values.map((value) => [value.cutKey, value])),
        };
      }),
      totalColumns: sourceTable().columns.length + 1,
    });
    mocks.fetchTable.mockReturnValue(table);

    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        outputRows: [{
          label: "Top 2 Box",
          sourceRows: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
        }],
      }],
    });

    expect(result.status).toBe("validated_proposal");
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);

    mocks.fetchTable.mockReturnValueOnce(table);
    const artifact = await computeTableRollupArtifact({
      groundingContext,
      jobId: "job-1",
      runResultValue: {},
      spec: mocks.mutateInternal.mock.calls[0]?.[1].frozenTableRollupSpec,
    });

    expect(artifact.rows[0]?.cellsByCutKey?.["gender::other"]).toMatchObject({
      count: 0,
      pct: 0,
      n: 0,
      displayValue: "0%",
    });
  });

  it("rejects frozen specs whose proposal rows do not match the resolved compute plan", async () => {
    await expect(computeTableRollupArtifact({
      groundingContext,
      jobId: "job-1",
      runResultValue: {},
      spec: {
        schemaVersion: 2,
        derivationType: "row_rollup",
        sourceTable: {
          tableId: "q1",
          title: "Q1 Satisfaction",
          questionId: "Q1",
          questionText: "How satisfied are you?",
        },
        outputRows: [{
          label: "Top 2 Box",
          mechanism: "artifact_exclusive_sum",
          sourceRows: [
            { rowKey: "row_3", label: "Neutral" },
            { rowKey: "row_4", label: "Dissatisfied" },
          ],
        }],
        resolvedComputePlan: {
          outputRows: [{
            label: "Top 2 Box",
            mechanism: "artifact_exclusive_sum",
            sourceRows: [
              { rowKey: "row_1", label: "Somewhat satisfied", variable: "Q1", filterValue: "4" },
              { rowKey: "row_2", label: "Very satisfied", variable: "Q1", filterValue: "5" },
            ],
          }],
        },
      },
    })).rejects.toThrow("older roll-up contract");
  });

  it("rejects stale row labels and canonical semantics before computing", async () => {
    mocks.fetchTable.mockReturnValueOnce(sourceTable({
      rows: sourceTable().rows.map((row) => row.rowKey === "row_1" ? { ...row, label: "Changed label" } : row),
    }));

    const spec = {
      schemaVersion: 2 as const,
      derivationType: "row_rollup" as const,
      sourceTable: {
        tableId: "q1",
        title: "Q1 Satisfaction",
        questionId: "Q1",
        questionText: "How satisfied are you?",
      },
      outputRows: [{
        label: "Top 2 Box",
        mechanism: "artifact_exclusive_sum" as const,
        sourceRows: [
          { rowKey: "row_1", label: "Somewhat satisfied" },
          { rowKey: "row_2", label: "Very satisfied" },
        ],
      }],
      resolvedComputePlan: {
        outputRows: [{
          label: "Top 2 Box",
          mechanism: "artifact_exclusive_sum" as const,
          sourceRows: [
            { rowKey: "row_1", label: "Somewhat satisfied", variable: "Q1", filterValue: "4" },
            { rowKey: "row_2", label: "Very satisfied", variable: "Q1", filterValue: "5" },
          ],
        }],
      },
    };

    await expect(computeTableRollupArtifact({
      groundingContext,
      jobId: "job-1",
      runResultValue: {},
      spec,
    })).rejects.toThrow("validated label");

    mocks.fetchTable.mockReturnValueOnce(sourceTable());
    mocks.downloadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify(canonicalArtifact([
      { variable: "Q1", label: "Somewhat satisfied", filterValue: "999", rowKind: "value", isNet: false },
      { variable: "Q1", label: "Very satisfied", filterValue: "5", rowKind: "value", isNet: false },
      { variable: "Q1", label: "Neutral", filterValue: "3", rowKind: "value", isNet: false },
      { variable: "Q1", label: "Dissatisfied", filterValue: "2", rowKind: "value", isNet: false },
    ]))));
    await expect(computeTableRollupArtifact({
      groundingContext,
      jobId: "job-1",
      runResultValue: {},
      spec,
    })).rejects.toThrow("validated row semantics");
  });
});
