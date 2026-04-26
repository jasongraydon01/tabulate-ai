import { describe, expect, it } from "vitest";

import {
  cancelJob,
  getById,
  listForSession,
  requeueStaleTableRollupJobs,
  updateStatus,
} from "../../../../../convex/analysisComputeJobs";

type TestRecord = Record<string, unknown>;
type TestConvexFunction<Result = unknown> = {
  isInternal?: boolean;
  _handler: (ctx: { db: ReturnType<typeof createDb>["db"] }, args: Record<string, unknown>) => Promise<Result>;
};

function createDb(records: Record<string, TestRecord>, tableRows: Record<string, TestRecord[]>) {
  const patches: Array<{ id: string; patch: Record<string, unknown> }> = [];

  return {
    patches,
    db: {
      get: async (id: string) => records[id] ?? null,
      patch: async (id: string, patch: Record<string, unknown>) => {
        patches.push({ id, patch });
        records[id] = { ...(records[id] ?? {}), ...patch };
      },
      query: (tableName: string) => ({
        withIndex: () => ({
          collect: async () => tableRows[tableName] ?? [],
        }),
      }),
    },
  };
}

describe("analysisComputeJobs Convex functions", () => {
  it("keeps raw job lookup internal-only", () => {
    expect((getById as unknown as TestConvexFunction).isInternal).toBe(true);
  });

  it("listForSession returns a scoped sanitized view", async () => {
    const records = {
      "session-1": {
        _id: "session-1",
        orgId: "org-1",
        runId: "run-1",
      },
      "run-1": {
        _id: "run-1",
        orgId: "org-1",
      },
      "child-run-1": {
        _id: "child-run-1",
        orgId: "org-1",
        parentRunId: "run-1",
        status: "in_progress",
        executionState: "running",
        progress: 55,
      },
    };
    const { db } = createDb(records, {
      analysisComputeJobs: [
        {
          _id: "job-1",
          orgId: "org-1",
          projectId: "project-1",
          parentRunId: "run-1",
          sessionId: "session-1",
          requestedBy: "user-1",
          jobType: "banner_extension_recompute",
          status: "queued",
          requestText: "Add region",
          frozenBannerGroup: {
            groupName: "Region",
            columns: [{ name: "North", original: "REGION=1" }],
          },
          frozenValidatedGroup: {
            groupName: "Region",
            columns: [{
              name: "North",
              adjusted: "REGION == 1",
              confidence: 0.95,
              reasoning: "Direct match",
              userSummary: "Matched directly.",
              expressionType: "direct_variable",
            }],
          },
          reviewFlags: {
            requiresClarification: false,
            requiresReview: false,
            reasons: [],
            averageConfidence: 0.95,
            policyFallbackDetected: false,
          },
          fingerprint: "opaque-token",
          r2Keys: { output: "r2/private/key.json" },
          promptSummary: "private reasoning",
          childRunId: "child-run-1",
          createdAt: 100,
          updatedAt: 200,
        },
        {
          _id: "cross-parent-job",
          orgId: "org-1",
          projectId: "project-1",
          parentRunId: "other-run",
          sessionId: "session-1",
          requestedBy: "user-1",
          jobType: "banner_extension_recompute",
          status: "proposed",
          requestText: "Wrong parent",
          createdAt: 90,
          updatedAt: 90,
        },
      ],
      analysisSessions: [
        {
          _id: "child-session-1",
          orgId: "org-1",
          runId: "child-run-1",
          status: "active",
          lastMessageAt: 300,
        },
      ],
    });

    const views = await (listForSession as unknown as TestConvexFunction<TestRecord[]>)._handler(
      { db },
      { orgId: "org-1", sessionId: "session-1", parentRunId: "run-1" },
    );

    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      id: "job-1",
      effectiveStatus: "running",
      childRun: {
        id: "child-run-1",
        analysisSessionId: "child-session-1",
      },
    });
    expect(views[0]).not.toHaveProperty("r2Keys");
    expect(views[0]).not.toHaveProperty("frozenBannerGroup");
    expect(views[0]).not.toHaveProperty("frozenValidatedGroup");
    expect(views[0]).not.toHaveProperty("promptSummary");
    expect(views[0].confirmToken).toBeUndefined();
  });

  it("listForSession returns nothing when session and parent run do not align", async () => {
    const { db } = createDb({
      "session-1": {
        _id: "session-1",
        orgId: "org-1",
        runId: "other-run",
      },
      "run-1": {
        _id: "run-1",
        orgId: "org-1",
      },
    }, {
      analysisComputeJobs: [{
        _id: "job-1",
        orgId: "org-1",
        parentRunId: "run-1",
        sessionId: "session-1",
      }],
    });

    await expect((listForSession as unknown as TestConvexFunction<TestRecord[]>)._handler(
      { db },
      { orgId: "org-1", sessionId: "session-1", parentRunId: "run-1" },
    )).resolves.toEqual([]);
  });

  it("listForSession marks unconfirmed jobs expired when parent artifacts are expired", async () => {
    const { db } = createDb({
      "session-1": {
        _id: "session-1",
        orgId: "org-1",
        runId: "run-1",
      },
      "run-1": {
        _id: "run-1",
        orgId: "org-1",
        expiredAt: 500,
      },
    }, {
      analysisComputeJobs: [{
        _id: "job-1",
        orgId: "org-1",
        projectId: "project-1",
        parentRunId: "run-1",
        sessionId: "session-1",
        requestedBy: "user-1",
        jobType: "banner_extension_recompute",
        status: "proposed",
        requestText: "Add region",
        fingerprint: "opaque-token",
        createdAt: 100,
        updatedAt: 100,
      }],
    });

    const views = await (listForSession as unknown as TestConvexFunction<TestRecord[]>)._handler(
      { db },
      { orgId: "org-1", sessionId: "session-1", parentRunId: "run-1" },
    );

    expect(views[0].effectiveStatus).toBe("expired");
    expect(views[0].confirmToken).toBeUndefined();
  });

  it("cancelJob does not overwrite a terminal child run when job state is stale", async () => {
    const { db, patches } = createDb({
      "job-1": {
        _id: "job-1",
        orgId: "org-1",
        parentRunId: "run-1",
        status: "queued",
        childRunId: "child-run-1",
        createdAt: 100,
        updatedAt: 200,
      },
      "child-run-1": {
        _id: "child-run-1",
        orgId: "org-1",
        parentRunId: "run-1",
        status: "success",
        executionState: "success",
      },
    }, {});

    const result = await (cancelJob as unknown as TestConvexFunction<TestRecord>)._handler(
      { db },
      { orgId: "org-1", jobId: "job-1", parentRunId: "run-1" },
    );

    expect(result).toMatchObject({
      status: "success",
      childRunId: "child-run-1",
      alreadyTerminal: true,
    });
    expect(patches).toHaveLength(1);
    expect(patches[0].id).toBe("job-1");
    expect(patches[0].patch).toMatchObject({ status: "success" });
  });

  it("requeues stale running table roll-up jobs and clears worker lease fields", async () => {
    const { db, patches } = createDb({}, {
      analysisComputeJobs: [
        {
          _id: "stale-rollup",
          orgId: "org-1",
          jobType: "table_rollup_derivation",
          status: "running",
          workerId: "worker-old",
          claimedAt: 100,
          updatedAt: 100,
        },
        {
          _id: "fresh-rollup",
          orgId: "org-1",
          jobType: "table_rollup_derivation",
          status: "running",
          workerId: "worker-new",
          claimedAt: Date.now(),
          updatedAt: Date.now(),
        },
        {
          _id: "banner-job",
          orgId: "org-1",
          jobType: "banner_extension_recompute",
          status: "running",
          workerId: "worker-old",
          claimedAt: 100,
          updatedAt: 100,
        },
      ],
    });

    const result = await (requeueStaleTableRollupJobs as unknown as TestConvexFunction<TestRecord>)._handler(
      { db },
      { staleBeforeMs: 1_000 },
    );

    expect(result).toEqual({ requeued: 1 });
    expect(patches).toHaveLength(1);
    expect(patches[0]).toMatchObject({
      id: "stale-rollup",
      patch: {
        status: "queued",
        workerId: undefined,
        claimedAt: undefined,
      },
    });
  });

  it("does not let a late worker failure overwrite a cancelled job", async () => {
    const { db, patches } = createDb({
      "job-1": {
        _id: "job-1",
        orgId: "org-1",
        parentRunId: "run-1",
        status: "cancelled",
        workerId: undefined,
        claimedAt: undefined,
        createdAt: 100,
        updatedAt: 200,
      },
    }, {});

    await (updateStatus as unknown as TestConvexFunction<void>)._handler(
      { db },
      { jobId: "job-1", status: "failed", error: "Late worker failure" },
    );

    expect(patches).toEqual([]);
  });
});
