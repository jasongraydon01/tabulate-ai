import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisGroundingContext } from "@/lib/analysis/grounding";
import type { AnalysisTableCard } from "@/lib/analysis/types";
import { createAnalysisTableRollupProposal } from "../tableRollup";

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

function sourceTable(): AnalysisTableCard {
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
    columns: [
      { cutKey: "__total__::total", cutName: "Total", groupName: null, statLetter: null, baseN: 100, isTotal: true },
      { cutKey: "age::young", cutName: "Young", groupName: "Age", statLetter: "A", baseN: 50 },
    ],
    rows: [
      {
        rowKey: "row_1",
        label: "Somewhat satisfied",
        rowKind: "value",
        statType: null,
        valueType: "pct",
        format: { kind: "percent", decimals: 0 },
        indent: 0,
        isNet: false,
        values: [
          {
            cutKey: "__total__::total",
            cutName: "Total",
            rawValue: 20,
            displayValue: "20%",
            count: 20,
            pct: 20,
            n: 100,
            mean: null,
            sigHigherThan: [],
            sigVsTotal: null,
          },
          {
            cutKey: "age::young",
            cutName: "Young",
            rawValue: 20,
            displayValue: "20%",
            count: 10,
            pct: 20,
            n: 50,
            mean: null,
            sigHigherThan: [],
            sigVsTotal: null,
          },
        ],
      },
      {
        rowKey: "row_2",
        label: "Very satisfied",
        rowKind: "value",
        statType: null,
        valueType: "pct",
        format: { kind: "percent", decimals: 0 },
        indent: 0,
        isNet: false,
        values: [
          {
            cutKey: "__total__::total",
            cutName: "Total",
            rawValue: 30,
            displayValue: "30%",
            count: 30,
            pct: 30,
            n: 100,
            mean: null,
            sigHigherThan: [],
            sigVsTotal: null,
          },
          {
            cutKey: "age::young",
            cutName: "Young",
            rawValue: 30,
            displayValue: "30%",
            count: 15,
            pct: 30,
            n: 50,
            mean: null,
            sigHigherThan: [],
            sigVsTotal: null,
          },
        ],
      },
    ],
    totalRows: 2,
    totalColumns: 2,
    truncatedRows: 0,
    truncatedColumns: 0,
    sourceRefs: [],
    significanceTest: null,
    significanceLevel: 0.1,
    comparisonGroups: [],
  };
}

function canonicalArtifact(variable = "Q1") {
  return {
    tables: [{
      tableId: "q1",
      rows: [
        { variable, label: "Somewhat satisfied", filterValue: "4", rowKind: "value", isNet: false },
        { variable, label: "Very satisfied", filterValue: "5", rowKind: "value", isNet: false },
      ],
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
    requestText: "Create Top 2 Box on Q1",
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

  it("creates one sanitized proposal for a valid same-variable roll-up", async () => {
    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        rollups: [{
          label: "Top 2 Box",
          components: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
        }],
      }],
    });

    expect(result).toMatchObject({
      status: "validated_proposal",
      jobId: "job-1",
      jobType: "table_rollup_derivation",
      sourceTables: [{
        tableId: "q1",
        rollups: [{
          label: "Top 2 Box",
          components: [
            { rowKey: "row_1", label: "Somewhat satisfied" },
            { rowKey: "row_2", label: "Very satisfied" },
          ],
        }],
      }],
    });
    expect(JSON.stringify(result)).not.toContain("r2://canonical-table-key");
    expect(JSON.stringify(result)).not.toContain("fingerprint");
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal.mock.calls[0]?.[1]).toMatchObject({
      requestText: "Create Top 2 Box on Q1",
      frozenTableRollupSpec: {
        schemaVersion: 1,
        derivationType: "answer_option_rollup",
      },
    });
  });

  it("returns repair feedback and creates no job for a wrong table id", async () => {
    mocks.fetchTable.mockReturnValueOnce({ status: "not_found", tableId: "missing" });

    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "missing",
        rollups: [{
          label: "Top 2 Box",
          components: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
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
        rollups: [{
          label: "Top 2 Box",
          components: [{ rowKey: "row_1" }, { rowKey: "row_missing" }],
        }],
      }],
    });

    expect(result.status).toBe("rejected_candidate");
    if (result.status === "rejected_candidate") {
      expect(result.invalidRowRefs).toEqual([{ tableId: "q1", rowRef: "row_missing" }]);
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("rejects unsupported cross-variable roll-ups before persistence", async () => {
    mocks.downloadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify({
      tables: [{
        tableId: "q1",
        rows: [
          { variable: "Q1_A", label: "Somewhat satisfied", filterValue: "1", rowKind: "value", isNet: false },
          { variable: "Q1_B", label: "Very satisfied", filterValue: "1", rowKind: "value", isNet: false },
        ],
      }],
    })));

    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        rollups: [{
          label: "Any satisfied",
          components: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
        }],
      }],
    });

    expect(result.status).toBe("rejected_candidate");
    if (result.status === "rejected_candidate") {
      expect(result.unsupportedCombinations.join(" ")).toContain("spans multiple variables");
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("rejects duplicate component rows before persistence", async () => {
    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        rollups: [{
          label: "Duplicated Top Box",
          components: [{ rowKey: "row_1" }, { rowKey: "row_1" }],
        }],
      }],
    });

    expect(result.status).toBe("rejected_candidate");
    if (result.status === "rejected_candidate") {
      expect(result.unsupportedCombinations.join(" ")).toContain("repeats the same source row");
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("rejects existing grouped filter values before persistence", async () => {
    mocks.downloadFile.mockResolvedValueOnce(Buffer.from(JSON.stringify({
      tables: [{
        tableId: "q1",
        rows: [
          { variable: "Q1", label: "Somewhat satisfied", filterValue: "4,5", rowKind: "value", isNet: false },
          { variable: "Q1", label: "Very satisfied", filterValue: "5", rowKind: "value", isNet: false },
        ],
      }],
    })));

    const result = await createAnalysisTableRollupProposal({
      ...baseParams(),
      candidates: [{
        tableId: "q1",
        rollups: [{
          label: "Top 2 Box",
          components: [{ rowKey: "row_1" }, { rowKey: "row_2" }],
        }],
      }],
    });

    expect(result.status).toBe("rejected_candidate");
    if (result.status === "rejected_candidate") {
      expect(result.ineligibleRows[0]?.reason).toContain("atomic answer-option values");
    }
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });
});
