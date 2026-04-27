import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AnalysisGroundingContext } from "@/lib/analysis/grounding";
import { createAnalysisSelectedTableCutProposal } from "../selectedTableCut";

const mocks = vi.hoisted(() => ({
  mutateInternal: vi.fn(),
  fetchTable: vi.fn(),
  parseRunResult: vi.fn(),
  processGroupV2: vi.fn(),
}));

vi.mock("@/lib/convex", () => ({
  mutateInternal: mocks.mutateInternal,
}));

vi.mock("@/schemas/runResultSchema", () => ({
  parseRunResult: mocks.parseRunResult,
}));

vi.mock("@/agents/CrosstabAgentV2", () => ({
  processGroupV2: mocks.processGroupV2,
}));

vi.mock("@/lib/analysis/grounding", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analysis/grounding")>();
  return {
    ...actual,
    fetchTable: mocks.fetchTable,
  };
});

const groundingContext = {
  tables: {
    q1: { tableId: "q1" },
  },
  questions: [{
    questionId: "S3",
    questionText: "Region",
    normalizedType: "single_select",
    analyticalSubtype: "single_select",
    items: [{ column: "REGION", label: "Region", valueLabels: { "1": "Northeast", "2": "South" } }],
  }],
} as unknown as AnalysisGroundingContext;

function baseParams() {
  return {
    orgId: "org-1" as never,
    projectId: "project-1" as never,
    parentRunId: "run-1" as never,
    sessionId: "session-1" as never,
    requestedBy: "user-1" as never,
    requestText: "Show Q1 by region",
    candidate: {
      sourceTableId: "q1",
      groupName: "Region",
      variable: "REGION",
      cuts: [
        { name: "Northeast", original: "REGION = 1" },
        { name: "South", original: "REGION = 2" },
      ],
    },
    parentRun: {
      _id: "run-1" as never,
      status: "success",
      result: {},
    },
    groundingContext,
  };
}

describe("createAnalysisSelectedTableCutProposal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchTable.mockReturnValue({
      status: "available",
      tableId: "q1",
      title: "Q1 Satisfaction",
      questionId: "Q1",
      questionText: "How satisfied are you?",
    });
    mocks.parseRunResult.mockReturnValue({
      r2Files: {
        outputs: {
          "results/tables.json": "r2://tables",
        },
      },
    });
    mocks.processGroupV2.mockResolvedValue({
      groupName: "Region",
      columns: [
        {
          name: "Northeast",
          adjusted: "`REGION` == 1",
          confidence: 1,
          reasoning: "Matched REGION.",
          userSummary: "Respondents in the Northeast.",
          alternatives: [],
          uncertainties: [],
          expressionType: "direct_variable",
        },
        {
          name: "South",
          adjusted: "`REGION` == 2",
          confidence: 1,
          reasoning: "Matched REGION.",
          userSummary: "Respondents in the South.",
          alternatives: [],
          uncertainties: [],
          expressionType: "direct_variable",
        },
      ],
    });
    mocks.mutateInternal.mockResolvedValue("job-cut-1");
  });

  it("creates a durable proposal only after table, variable, and cuts validate", async () => {
    const result = await createAnalysisSelectedTableCutProposal(baseParams());

    expect(result).toMatchObject({
      status: "validated_proposal",
      jobId: "job-cut-1",
      jobType: "selected_table_cut_derivation",
      sourceTable: {
        tableId: "q1",
        title: "Q1 Satisfaction",
      },
      groupName: "Region",
      variable: "REGION",
    });
    expect(mocks.processGroupV2).toHaveBeenCalledWith(
      groundingContext.questions,
      expect.any(Set),
      {
        groupName: "Region",
        columns: [
          { name: "Northeast", original: "REGION: REGION = 1" },
          { name: "South", original: "REGION: REGION = 2" },
        ],
      },
      expect.objectContaining({ loopCount: 0 }),
    );
    expect(mocks.mutateInternal).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      requestText: "Show Q1 by region",
      frozenSelectedTableCutSpec: expect.objectContaining({
        derivationType: "selected_table_cut",
        sourceTable: expect.objectContaining({ tableId: "q1" }),
        groupName: "Region",
        variable: "REGION",
        cuts: baseParams().candidate.cuts,
      }),
      fingerprint: expect.any(String),
    }));
  });

  it("rejects unknown variables without creating a job", async () => {
    const result = await createAnalysisSelectedTableCutProposal({
      ...baseParams(),
      candidate: {
        ...baseParams().candidate,
        variable: "MISSING_REGION",
      },
    });

    expect(result).toMatchObject({
      status: "rejected_candidate",
      invalidVariables: ["MISSING_REGION"],
    });
    expect(mocks.processGroupV2).not.toHaveBeenCalled();
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("rejects resolved cuts that do not use the requested variable", async () => {
    mocks.processGroupV2.mockResolvedValueOnce({
      groupName: "Region",
      columns: [{
        name: "Northeast",
        adjusted: "`AGE` == 1",
        confidence: 1,
        reasoning: "Matched another variable.",
        userSummary: "Wrong variable.",
        alternatives: [],
        uncertainties: [],
        expressionType: "direct_variable",
      }],
    });

    const result = await createAnalysisSelectedTableCutProposal({
      ...baseParams(),
      candidate: {
        ...baseParams().candidate,
        cuts: [{ name: "Northeast", original: "REGION = 1" }],
      },
    });

    expect(result).toMatchObject({
      status: "rejected_candidate",
      invalidCuts: [expect.objectContaining({
        name: "Northeast",
        reason: expect.stringContaining("REGION"),
      })],
    });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("rejects computed derived table sources before creating a job", async () => {
    const result = await createAnalysisSelectedTableCutProposal({
      ...baseParams(),
      candidate: {
        ...baseParams().candidate,
        sourceTableId: "q1__rollup_job",
      },
      groundingContext: {
        ...groundingContext,
        tables: {},
      } as unknown as AnalysisGroundingContext,
    });

    expect(result).toMatchObject({
      status: "rejected_candidate",
      invalidTableIds: ["q1__rollup_job"],
      repairHints: [expect.stringContaining("original parent-run table")],
    });
    expect(mocks.processGroupV2).not.toHaveBeenCalled();
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("rejects looped source tables because the narrow worker path does not hydrate loop policy", async () => {
    mocks.fetchTable.mockReturnValueOnce({
      status: "available",
      tableId: "loop_q1",
      title: "Looped Q1",
      questionId: "QLOOP",
      questionText: "Looped question",
    });

    const result = await createAnalysisSelectedTableCutProposal({
      ...baseParams(),
      candidate: {
        ...baseParams().candidate,
        sourceTableId: "loop_q1",
      },
      groundingContext: {
        ...groundingContext,
        tables: {
          loop_q1: { tableId: "loop_q1" },
        },
        questions: [
          ...groundingContext.questions,
          {
            questionId: "QLOOP",
            questionText: "Looped question",
            normalizedType: "single_select",
            analyticalSubtype: "single_select",
            items: [{ column: "REGION", label: "Region", valueLabels: {} }],
            loop: { iterationCount: 3 },
          },
        ],
      } as unknown as AnalysisGroundingContext,
    });

    expect(result).toMatchObject({
      status: "rejected_candidate",
      reasons: [expect.stringContaining("looped source tables")],
    });
    expect(mocks.processGroupV2).not.toHaveBeenCalled();
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });
});
