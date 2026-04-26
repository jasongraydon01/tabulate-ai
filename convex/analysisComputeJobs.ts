import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import { buildAnalysisComputeJobView } from "../src/lib/analysis/computeLane/jobView";

const jobStatusValidator = v.union(
  v.literal("drafting"),
  v.literal("proposed"),
  v.literal("needs_clarification"),
  v.literal("confirmed"),
  v.literal("queued"),
  v.literal("running"),
  v.literal("success"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("expired"),
);

const reviewFlagsValidator = v.object({
  requiresClarification: v.boolean(),
  requiresReview: v.boolean(),
  reasons: v.array(v.string()),
  averageConfidence: v.number(),
  policyFallbackDetected: v.boolean(),
  draftConfidence: v.optional(v.number()),
});

export const getById = internalQuery({
  args: {
    orgId: v.id("organizations"),
    jobId: v.id("analysisComputeJobs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== args.orgId) return null;
    return job;
  },
});

export const listForSession = query({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
    parentRunId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const [session, parentRun] = await Promise.all([
      ctx.db.get(args.sessionId),
      ctx.db.get(args.parentRunId),
    ]);

    if (
      !session
      || session.orgId !== args.orgId
      || session.runId !== args.parentRunId
      || !parentRun
      || parentRun.orgId !== args.orgId
    ) {
      return [];
    }

    const jobs = await ctx.db
      .query("analysisComputeJobs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    const scopedJobs = jobs
      .filter((job) => job.orgId === args.orgId && job.parentRunId === args.parentRunId)
      .sort((left, right) => left.createdAt - right.createdAt);

    const views = [];
    for (const job of scopedJobs) {
      const childRun = job.childRunId ? await ctx.db.get(job.childRunId) : null;
      const safeChildRun = childRun && childRun.orgId === args.orgId && childRun.parentRunId === args.parentRunId
        ? childRun
        : null;

      let childAnalysisSessionId: string | null = null;
      if (safeChildRun) {
        const childSessions = await ctx.db
          .query("analysisSessions")
          .withIndex("by_run", (q) => q.eq("runId", safeChildRun._id))
          .collect();
        const firstActiveSession = childSessions
          .filter((entry) => entry.orgId === args.orgId && entry.status === "active")
          .sort((left, right) => right.lastMessageAt - left.lastMessageAt)[0];
        childAnalysisSessionId = firstActiveSession ? String(firstActiveSession._id) : null;
      }

      views.push(buildAnalysisComputeJobView({
        job,
        childRun: safeChildRun,
        childAnalysisSessionId,
        parentRunExpired: !safeChildRun && (typeof parentRun.expiredAt === "number" || typeof parentRun.artifactsPurgedAt === "number"),
      }));
    }

    return views;
  },
});

export const createFromPreflight = internalMutation({
  args: {
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    parentRunId: v.id("runs"),
    sessionId: v.id("analysisSessions"),
    requestedBy: v.id("users"),
    requestText: v.string(),
    status: v.union(v.literal("proposed"), v.literal("needs_clarification")),
    frozenBannerGroup: v.any(),
    frozenValidatedGroup: v.any(),
    reviewFlags: reviewFlagsValidator,
    fingerprint: v.string(),
    promptSummary: v.string(),
  },
  handler: async (ctx, args) => {
    const [project, run, session] = await Promise.all([
      ctx.db.get(args.projectId),
      ctx.db.get(args.parentRunId),
      ctx.db.get(args.sessionId),
    ]);

    if (!project || project.orgId !== args.orgId) throw new Error("Project not found");
    if (!run || run.orgId !== args.orgId || run.projectId !== args.projectId) throw new Error("Parent run not found");
    if (!session || session.orgId !== args.orgId || session.runId !== args.parentRunId) {
      throw new Error("Analysis session not found");
    }

    const now = Date.now();
    return await ctx.db.insert("analysisComputeJobs", {
      orgId: args.orgId,
      projectId: args.projectId,
      parentRunId: args.parentRunId,
      sessionId: args.sessionId,
      requestedBy: args.requestedBy,
      jobType: "banner_extension_recompute",
      status: args.status,
      requestText: args.requestText,
      frozenBannerGroup: args.frozenBannerGroup,
      frozenValidatedGroup: args.frozenValidatedGroup,
      reviewFlags: args.reviewFlags,
      fingerprint: args.fingerprint,
      promptSummary: args.promptSummary,
      createdAt: now,
      updatedAt: now,
    });
  },
});

/**
 * @deprecated Use runs.confirmAndEnqueueAnalysisChild so child creation,
 * job attachment, and queueing happen atomically.
 */
export const attachChildRun = internalMutation({
  args: {
    orgId: v.id("organizations"),
    jobId: v.id("analysisComputeJobs"),
    childRunId: v.id("runs"),
    expectedFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== args.orgId) throw new Error("Analysis compute job not found");
    if (job.fingerprint !== args.expectedFingerprint) {
      throw new Error("Analysis compute job fingerprint mismatch");
    }
    if (job.status !== "proposed" && job.status !== "confirmed" && job.status !== "queued") {
      throw new Error(`Analysis compute job cannot be confirmed from status ${job.status}`);
    }
    if (job.childRunId) {
      return { childRunId: job.childRunId, alreadyAttached: true };
    }

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      childRunId: args.childRunId,
      status: "confirmed",
      confirmedAt: now,
      updatedAt: now,
    });
    return { childRunId: args.childRunId, alreadyAttached: false };
  },
});

export const updateStatus = internalMutation({
  args: {
    jobId: v.id("analysisComputeJobs"),
    status: jobStatusValidator,
    error: v.optional(v.string()),
    r2Keys: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Analysis compute job not found");
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: args.status,
      updatedAt: now,
      ...(args.error !== undefined ? { error: args.error } : {}),
      ...(args.r2Keys !== undefined ? { r2Keys: args.r2Keys } : {}),
      ...(["success", "failed", "cancelled"].includes(args.status) ? { completedAt: now } : {}),
    });
  },
});

export const cancelJob = internalMutation({
  args: {
    orgId: v.id("organizations"),
    jobId: v.id("analysisComputeJobs"),
    parentRunId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== args.orgId || job.parentRunId !== args.parentRunId) {
      throw new Error("Analysis compute job not found");
    }

    if (["success", "failed", "cancelled", "expired"].includes(job.status)) {
      return {
        status: job.status,
        childRunId: job.childRunId,
        alreadyTerminal: true,
      };
    }

    let childRunId = job.childRunId;
    if (childRunId) {
      const childRun = await ctx.db.get(childRunId);
      if (!childRun || childRun.orgId !== args.orgId || childRun.parentRunId !== args.parentRunId) {
        throw new Error("Analysis compute job child run lineage is invalid");
      }

      if (childRun.status === "success" || childRun.status === "partial" || childRun.status === "error" || childRun.status === "cancelled") {
        const terminalStatus = childRun.status === "success" || childRun.status === "partial"
          ? "success"
          : childRun.status === "error"
            ? "failed"
            : "cancelled";
        const now = Date.now();
        await ctx.db.patch(args.jobId, {
          status: terminalStatus,
          updatedAt: now,
          completedAt: job.completedAt ?? now,
        });
        return {
          status: terminalStatus,
          childRunId,
          alreadyTerminal: true,
        };
      }

      await ctx.db.patch(childRunId, {
        cancelRequested: true,
        status: "cancelled",
        executionState: "cancelled",
        message: "Pipeline cancelled by user",
        workerId: undefined,
        claimedAt: undefined,
        heartbeatAt: undefined,
      });
    }

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "cancelled",
      updatedAt: now,
      completedAt: now,
    });

    return {
      status: "cancelled",
      childRunId,
      alreadyTerminal: false,
    };
  },
});
