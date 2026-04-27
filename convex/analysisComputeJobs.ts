import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import { buildAnalysisComputeJobView } from "../src/lib/analysis/computeLane/jobView";
import {
  isAnalysisSelectedTableCutSpecV1,
  isAnalysisTableRollupSpecV2,
  UNSUPPORTED_SELECTED_TABLE_CUT_SPEC_MESSAGE,
  UNSUPPORTED_TABLE_ROLLUP_SPEC_MESSAGE,
} from "../src/lib/analysis/computeLane/types";

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

const tableRollupComponentValidator = v.object({
  rowKey: v.string(),
  label: v.string(),
});

const tableRollupMechanismValidator = v.union(
  v.literal("artifact_exclusive_sum"),
  v.literal("respondent_any_of"),
  v.literal("metric_row_aggregation"),
);

const tableRollupOutputRowValidator = v.object({
  label: v.string(),
  sourceRows: v.array(tableRollupComponentValidator),
  mechanism: tableRollupMechanismValidator,
});

const tableRollupSourceTableSpecValidator = v.object({
  tableId: v.string(),
  title: v.string(),
  questionId: v.union(v.string(), v.null()),
  questionText: v.union(v.string(), v.null()),
});

const tableRollupResolvedSourceRowValidator = v.object({
  rowKey: v.string(),
  label: v.string(),
  variable: v.string(),
  filterValue: v.string(),
});

const tableRollupResolvedOutputRowValidator = v.object({
  label: v.string(),
  mechanism: tableRollupMechanismValidator,
  sourceRows: v.array(tableRollupResolvedSourceRowValidator),
});

const tableRollupSpecValidator = v.object({
  schemaVersion: v.literal(2),
  derivationType: v.literal("row_rollup"),
  sourceTable: tableRollupSourceTableSpecValidator,
  outputRows: v.array(tableRollupOutputRowValidator),
  resolvedComputePlan: v.object({
    outputRows: v.array(tableRollupResolvedOutputRowValidator),
  }),
});

const selectedTableCutValidator = v.object({
  name: v.string(),
  original: v.string(),
});

const selectedTableCutSourceTableSpecValidator = v.object({
  tableId: v.string(),
  title: v.string(),
  questionId: v.union(v.string(), v.null()),
  questionText: v.union(v.string(), v.null()),
});

const selectedTableCutValidatedColumnValidator = v.object({
  name: v.string(),
  adjusted: v.string(),
  confidence: v.number(),
  reasoning: v.string(),
  userSummary: v.string(),
  alternatives: v.array(v.object({
    expression: v.string(),
    rank: v.number(),
    userSummary: v.string(),
  })),
  uncertainties: v.array(v.string()),
  expressionType: v.string(),
});

const selectedTableCutValidatedGroupValidator = v.object({
  groupName: v.string(),
  columns: v.array(selectedTableCutValidatedColumnValidator),
});

const selectedTableCutSpecValidator = v.object({
  schemaVersion: v.literal(1),
  derivationType: v.literal("selected_table_cut"),
  sourceTable: selectedTableCutSourceTableSpecValidator,
  groupName: v.string(),
  variable: v.string(),
  cuts: v.array(selectedTableCutValidator),
  resolvedComputePlan: v.object({
    validatedGroup: selectedTableCutValidatedGroupValidator,
  }),
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
    originClientTurnId: v.optional(v.string()),
    originUserMessageId: v.optional(v.id("analysisMessages")),
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
      ...(args.originClientTurnId ? { originClientTurnId: args.originClientTurnId } : {}),
      ...(args.originUserMessageId ? { originUserMessageId: args.originUserMessageId } : {}),
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

export const createTableRollupProposal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    parentRunId: v.id("runs"),
    sessionId: v.id("analysisSessions"),
    requestedBy: v.id("users"),
    originClientTurnId: v.optional(v.string()),
    originUserMessageId: v.optional(v.id("analysisMessages")),
    requestText: v.string(),
    frozenTableRollupSpec: tableRollupSpecValidator,
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
      ...(args.originClientTurnId ? { originClientTurnId: args.originClientTurnId } : {}),
      ...(args.originUserMessageId ? { originUserMessageId: args.originUserMessageId } : {}),
      jobType: "table_rollup_derivation",
      status: "proposed",
      requestText: args.requestText,
      frozenTableRollupSpec: args.frozenTableRollupSpec,
      reviewFlags: args.reviewFlags,
      fingerprint: args.fingerprint,
      promptSummary: args.promptSummary,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const createSelectedTableCutProposal = internalMutation({
  args: {
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    parentRunId: v.id("runs"),
    sessionId: v.id("analysisSessions"),
    requestedBy: v.id("users"),
    originClientTurnId: v.optional(v.string()),
    originUserMessageId: v.optional(v.id("analysisMessages")),
    requestText: v.string(),
    frozenSelectedTableCutSpec: selectedTableCutSpecValidator,
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
      ...(args.originClientTurnId ? { originClientTurnId: args.originClientTurnId } : {}),
      ...(args.originUserMessageId ? { originUserMessageId: args.originUserMessageId } : {}),
      jobType: "selected_table_cut_derivation",
      status: "proposed",
      requestText: args.requestText,
      frozenSelectedTableCutSpec: args.frozenSelectedTableCutSpec,
      reviewFlags: args.reviewFlags,
      fingerprint: args.fingerprint,
      promptSummary: args.promptSummary,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const confirmTableRollupJob = internalMutation({
  args: {
    orgId: v.id("organizations"),
    jobId: v.id("analysisComputeJobs"),
    parentRunId: v.id("runs"),
    expectedFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== args.orgId || job.parentRunId !== args.parentRunId) {
      throw new Error("Analysis compute job not found");
    }
    if (job.jobType !== "table_rollup_derivation") {
      throw new Error("Analysis compute job is not a table roll-up job");
    }
    if (job.fingerprint !== args.expectedFingerprint) {
      throw new Error("Analysis compute job fingerprint mismatch");
    }
    if (job.reviewFlags?.requiresClarification || job.reviewFlags?.requiresReview) {
      throw new Error("Analysis compute job requires clarification before compute");
    }
    if (!job.frozenTableRollupSpec) {
      throw new Error("Analysis compute job is missing frozen roll-up spec");
    }
    if (!isAnalysisTableRollupSpecV2(job.frozenTableRollupSpec)) {
      throw new Error(UNSUPPORTED_TABLE_ROLLUP_SPEC_MESSAGE);
    }
    if (job.status === "queued" || job.status === "running" || job.status === "success") {
      return { alreadyQueued: true, derivedArtifactId: job.derivedArtifactId };
    }
    if (job.status !== "proposed" && job.status !== "confirmed") {
      throw new Error(`Analysis compute job cannot be confirmed from status ${job.status}`);
    }

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "queued",
      confirmedAt: job.confirmedAt ?? now,
      updatedAt: now,
    });
    return { alreadyQueued: false, derivedArtifactId: job.derivedArtifactId };
  },
});

export const confirmSelectedTableCutJob = internalMutation({
  args: {
    orgId: v.id("organizations"),
    jobId: v.id("analysisComputeJobs"),
    parentRunId: v.id("runs"),
    expectedFingerprint: v.string(),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== args.orgId || job.parentRunId !== args.parentRunId) {
      throw new Error("Analysis compute job not found");
    }
    if (job.jobType !== "selected_table_cut_derivation") {
      throw new Error("Analysis compute job is not a selected-table cut job");
    }
    if (job.fingerprint !== args.expectedFingerprint) {
      throw new Error("Analysis compute job fingerprint mismatch");
    }
    if (job.reviewFlags?.requiresClarification || job.reviewFlags?.requiresReview) {
      throw new Error("Analysis compute job requires clarification before compute");
    }
    if (!job.frozenSelectedTableCutSpec) {
      throw new Error("Analysis compute job is missing frozen selected-table cut spec");
    }
    if (!isAnalysisSelectedTableCutSpecV1(job.frozenSelectedTableCutSpec)) {
      throw new Error(UNSUPPORTED_SELECTED_TABLE_CUT_SPEC_MESSAGE);
    }
    if (job.status === "queued" || job.status === "running" || job.status === "success") {
      return { alreadyQueued: true, derivedArtifactId: job.derivedArtifactId };
    }
    if (job.status !== "proposed" && job.status !== "confirmed") {
      throw new Error(`Analysis compute job cannot be confirmed from status ${job.status}`);
    }

    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: "queued",
      confirmedAt: job.confirmedAt ?? now,
      updatedAt: now,
    });
    return { alreadyQueued: false, derivedArtifactId: job.derivedArtifactId };
  },
});

export const attachOriginAssistantMessageForTurn = internalMutation({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
    originClientTurnId: v.string(),
    originAssistantMessageId: v.id("analysisMessages"),
  },
  handler: async (ctx, args) => {
    const [session, assistantMessage] = await Promise.all([
      ctx.db.get(args.sessionId),
      ctx.db.get(args.originAssistantMessageId),
    ]);
    if (!session || session.orgId !== args.orgId) {
      throw new Error("Analysis session not found");
    }
    if (
      !assistantMessage
      || assistantMessage.orgId !== args.orgId
      || assistantMessage.sessionId !== args.sessionId
      || assistantMessage.role !== "assistant"
    ) {
      throw new Error("Origin assistant message not found");
    }

    const jobs = await ctx.db
      .query("analysisComputeJobs")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const matchingJobs = jobs.filter((job) =>
      job.orgId === args.orgId
      && job.originClientTurnId === args.originClientTurnId
      && !job.originAssistantMessageId
    );
    const now = Date.now();
    for (const job of matchingJobs) {
      await ctx.db.patch(job._id, {
        originAssistantMessageId: args.originAssistantMessageId,
        updatedAt: now,
      });
    }

    return { updated: matchingJobs.length };
  },
});

export const claimNextQueuedTableRollupJob = internalMutation({
  args: {
    workerId: v.string(),
  },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("analysisComputeJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    const now = Date.now();
    const tableRollupJobs = jobs
      .filter((entry) => entry.jobType === "table_rollup_derivation")
      .sort((left, right) => left.updatedAt - right.updatedAt);

    for (const job of tableRollupJobs) {
      if (!isAnalysisTableRollupSpecV2(job.frozenTableRollupSpec)) {
        await ctx.db.patch(job._id, {
          status: "failed",
          error: UNSUPPORTED_TABLE_ROLLUP_SPEC_MESSAGE,
          updatedAt: now,
          completedAt: now,
          workerId: undefined,
          claimedAt: undefined,
        });
        continue;
      }

      await ctx.db.patch(job._id, {
        status: "running",
        workerId: args.workerId,
        claimedAt: now,
        updatedAt: now,
      });

      return {
        jobId: job._id,
        orgId: job.orgId,
        projectId: job.projectId,
        parentRunId: job.parentRunId,
        sessionId: job.sessionId,
        requestedBy: job.requestedBy,
        requestText: job.requestText,
        frozenTableRollupSpec: job.frozenTableRollupSpec,
        fingerprint: job.fingerprint,
      };
    }

    return null;
  },
});

export const claimNextQueuedSelectedTableCutJob = internalMutation({
  args: {
    workerId: v.string(),
  },
  handler: async (ctx, args) => {
    const jobs = await ctx.db
      .query("analysisComputeJobs")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
    const now = Date.now();
    const selectedTableCutJobs = jobs
      .filter((entry) => entry.jobType === "selected_table_cut_derivation")
      .sort((left, right) => left.updatedAt - right.updatedAt);

    for (const job of selectedTableCutJobs) {
      if (!isAnalysisSelectedTableCutSpecV1(job.frozenSelectedTableCutSpec)) {
        await ctx.db.patch(job._id, {
          status: "failed",
          error: UNSUPPORTED_SELECTED_TABLE_CUT_SPEC_MESSAGE,
          updatedAt: now,
          completedAt: now,
          workerId: undefined,
          claimedAt: undefined,
        });
        continue;
      }

      await ctx.db.patch(job._id, {
        status: "running",
        workerId: args.workerId,
        claimedAt: now,
        updatedAt: now,
      });

      return {
        jobId: job._id,
        orgId: job.orgId,
        projectId: job.projectId,
        parentRunId: job.parentRunId,
        sessionId: job.sessionId,
        requestedBy: job.requestedBy,
        requestText: job.requestText,
        frozenSelectedTableCutSpec: job.frozenSelectedTableCutSpec,
        fingerprint: job.fingerprint,
      };
    }

    return null;
  },
});

export const requeueStaleTableRollupJobs = internalMutation({
  args: {
    staleBeforeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.staleBeforeMs;
    const jobs = await ctx.db
      .query("analysisComputeJobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();

    const staleJobs = jobs.filter((job) =>
      job.jobType === "table_rollup_derivation"
      && typeof job.claimedAt === "number"
      && job.claimedAt < cutoff
    );

    const now = Date.now();
    for (const job of staleJobs) {
      await ctx.db.patch(job._id, {
        status: "queued",
        workerId: undefined,
        claimedAt: undefined,
        updatedAt: now,
      });
    }

    return { requeued: staleJobs.length };
  },
});

export const requeueStaleSelectedTableCutJobs = internalMutation({
  args: {
    staleBeforeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.staleBeforeMs;
    const jobs = await ctx.db
      .query("analysisComputeJobs")
      .withIndex("by_status", (q) => q.eq("status", "running"))
      .collect();

    const staleJobs = jobs.filter((job) =>
      job.jobType === "selected_table_cut_derivation"
      && typeof job.claimedAt === "number"
      && job.claimedAt < cutoff
    );

    const now = Date.now();
    for (const job of staleJobs) {
      await ctx.db.patch(job._id, {
        status: "queued",
        workerId: undefined,
        claimedAt: undefined,
        updatedAt: now,
      });
    }

    return { requeued: staleJobs.length };
  },
});

export const attachDerivedArtifact = internalMutation({
  args: {
    orgId: v.id("organizations"),
    jobId: v.id("analysisComputeJobs"),
    artifactId: v.id("analysisArtifacts"),
  },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job || job.orgId !== args.orgId) throw new Error("Analysis compute job not found");
    if (job.status === "cancelled" || job.status === "failed" || job.status === "expired") {
      return { status: job.status, skipped: true };
    }
    const artifact = await ctx.db.get(args.artifactId);
    if (!artifact || artifact.orgId !== args.orgId || artifact.runId !== job.parentRunId || artifact.sessionId !== job.sessionId) {
      throw new Error("Derived artifact lineage is invalid");
    }
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      derivedArtifactId: args.artifactId,
      status: "success",
      updatedAt: now,
      completedAt: now,
      workerId: undefined,
      claimedAt: undefined,
    });
    return { status: "success", skipped: false };
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
    if (
      args.status === "failed"
      && (job.status === "success" || job.status === "cancelled" || job.status === "expired")
    ) {
      return;
    }
    const now = Date.now();
    await ctx.db.patch(args.jobId, {
      status: args.status,
      updatedAt: now,
      ...(args.error !== undefined ? { error: args.error } : {}),
      ...(args.r2Keys !== undefined ? { r2Keys: args.r2Keys } : {}),
      ...(["success", "failed", "cancelled"].includes(args.status)
        ? { completedAt: now, workerId: undefined, claimedAt: undefined }
        : {}),
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
      workerId: undefined,
      claimedAt: undefined,
    });

    return {
      status: "cancelled",
      childRunId,
      alreadyTerminal: false,
    };
  },
});
