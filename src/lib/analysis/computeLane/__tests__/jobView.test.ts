import { describe, expect, it } from "vitest";

import { buildAnalysisComputeJobView } from "../jobView";

const proposedJob = {
  _id: "job-1",
  projectId: "project-1",
  jobType: "banner_extension_recompute",
  status: "proposed" as const,
  requestText: "Add region",
  fingerprint: "opaque-token",
  frozenBannerGroup: {
    groupName: "Region",
    columns: [{ name: "North", original: "REGION=1" }],
  },
  frozenValidatedGroup: {
    groupName: "Region",
    columns: [{
      name: "North",
      adjusted: "REGION == 1",
      confidence: 0.96,
      reasoning: "Direct match",
      userSummary: "Matched the region variable.",
      expressionType: "direct_variable",
    }],
  },
  reviewFlags: {
    requiresClarification: false,
    requiresReview: false,
    reasons: [],
    averageConfidence: 0.96,
    policyFallbackDetected: false,
  },
  r2Keys: { unsafe: "hidden" },
  createdAt: 100,
  updatedAt: 120,
};

describe("buildAnalysisComputeJobView", () => {
  it("projects a proposed job into a client-safe view with an opaque confirm token", () => {
    const view = buildAnalysisComputeJobView({ job: proposedJob });

    expect(view).toMatchObject({
      id: "job-1",
      jobType: "banner_extension_recompute",
      status: "proposed",
      effectiveStatus: "proposed",
      confirmToken: "opaque-token",
      proposedGroup: {
        groupName: "Region",
        cuts: [{
          name: "North",
          original: "REGION=1",
          rawExpression: "REGION == 1",
          confidence: 0.96,
        }],
      },
    });
    expect(view).not.toHaveProperty("r2Keys");
    expect(view).not.toHaveProperty("frozenBannerGroup");
  });

  it("omits confirmToken when review flags block confirmation", () => {
    const view = buildAnalysisComputeJobView({
      job: {
        ...proposedJob,
        reviewFlags: {
          requiresClarification: true,
          requiresReview: true,
          reasons: ["Needs review"],
          averageConfidence: 0.4,
          policyFallbackDetected: false,
        },
      },
    });

    expect(view.confirmToken).toBeUndefined();
    expect(view.reviewFlags?.reasons).toEqual(["Needs review"]);
  });

  it("includes child run state and session id when available", () => {
    const view = buildAnalysisComputeJobView({
      job: { ...proposedJob, status: "queued" },
      childRun: {
        _id: "child-run-1",
        status: "in_progress",
        executionState: "running",
        stage: "v3_compute",
        progress: 55,
        message: "Running compute",
      },
      childAnalysisSessionId: "child-session-1",
    });

    expect(view.effectiveStatus).toBe("running");
    expect(view.childRun).toMatchObject({
      id: "child-run-1",
      status: "in_progress",
      executionState: "running",
      stage: "v3_compute",
      progress: 55,
      message: "Running compute",
      analysisUrl: "/projects/project-1/runs/child-run-1/analysis",
      analysisSessionId: "child-session-1",
    });
  });

  it("marks stale proposals expired when parent artifacts are expired and suppresses confirm token", () => {
    const view = buildAnalysisComputeJobView({
      job: proposedJob,
      parentRunExpired: true,
    });

    expect(view.effectiveStatus).toBe("expired");
    expect(view.confirmToken).toBeUndefined();
  });

  it("marks completed child runs expired when child artifacts are expired", () => {
    const view = buildAnalysisComputeJobView({
      job: { ...proposedJob, status: "success" },
      childRun: {
        _id: "child-run-1",
        status: "success",
        executionState: "success",
        expiredAt: 500,
      },
    });

    expect(view.effectiveStatus).toBe("expired");
    expect(view.childRun?.expiredAt).toBe(500);
  });

  it("projects table roll-up jobs into sanitized proposal views", () => {
    const rollupJob = {
      _id: "job-rollup-1",
      projectId: "project-1",
      jobType: "table_rollup_derivation" as const,
      status: "proposed" as const,
      requestText: "Create Top 2 Box",
      fingerprint: "rollup-token",
      frozenTableRollupSpec: {
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
            { rowKey: "row_4", label: "Somewhat satisfied" },
            { rowKey: "row_5", label: "Very satisfied" },
          ],
        }],
        resolvedComputePlan: {
          outputRows: [],
        },
      },
      r2Keys: { unsafe: "hidden" },
      promptSummary: "private reasoning",
      createdAt: 100,
      updatedAt: 120,
    };

    const view = buildAnalysisComputeJobView({
      job: rollupJob,
    });

    expect(view).toMatchObject({
      id: "job-rollup-1",
      jobType: "table_rollup_derivation",
      confirmToken: "rollup-token",
      proposedTableRollup: {
        sourceTables: [{
          tableId: "q1",
          title: "Q1 Satisfaction",
          rollups: [{
            label: "Top 2 Box",
            components: [
              { rowKey: "row_4", label: "Somewhat satisfied" },
              { rowKey: "row_5", label: "Very satisfied" },
            ],
          }],
        }],
      },
    });
    expect(view).not.toHaveProperty("frozenTableRollupSpec");
    expect(view).not.toHaveProperty("r2Keys");
    expect(view).not.toHaveProperty("promptSummary");
  });
});
