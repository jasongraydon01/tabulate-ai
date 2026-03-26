import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { v3PipelineStageValidator } from "../src/schemas/pipelineStageSchema";
import { configValidator } from "./projectConfigValidators";

/** Statuses that represent an actively-running pipeline (heartbeat expected). */
const ACTIVE_STATUSES = ["in_progress", "resuming"] as const;
const ACTIVE_STATUS_SET = new Set<string>(ACTIVE_STATUSES);

export const create = internalMutation({
  args: {
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
    config: configValidator,
    launchedBy: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("runs", {
      projectId: args.projectId,
      orgId: args.orgId,
      status: "in_progress",
      stage: "uploading",
      progress: 0,
      message: "Starting pipeline...",
      config: args.config,
      cancelRequested: false,
      lastHeartbeat: Date.now(),
      ...(args.launchedBy && { launchedBy: args.launchedBy }),
    });
  },
});

export const get = query({
  args: {
    runId: v.id("runs"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    // Org-scoping: always reject cross-org access
    if (run.orgId !== args.orgId) return null;
    return run;
  },
});

export const requestCancel = internalMutation({
  args: { runId: v.id("runs") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      cancelRequested: true,
      status: "cancelled",
      message: "Pipeline cancelled by user",
    });
  },
});

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("runs")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .collect();
  },
});

export const getByProject = query({
  args: {
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
    // Org-scoping: always filter out cross-org runs
    return runs.filter((r) => r.orgId === args.orgId);
  },
});

export const updateStatus = internalMutation({
  args: {
    runId: v.id("runs"),
    status: v.union(
      v.literal("in_progress"),
      v.literal("pending_review"),
      v.literal("resuming"),
      v.literal("success"),
      v.literal("partial"),
      v.literal("error"),
      v.literal("cancelled")
    ),
    stage: v.optional(v3PipelineStageValidator),
    progress: v.optional(v.number()),
    message: v.optional(v.string()),
    result: v.optional(v.any()),
    error: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Runtime guard: if result is provided, it must be an object with a pipelineId string
    if (args.result !== undefined) {
      if (typeof args.result !== 'object' || args.result === null || Array.isArray(args.result)) {
        throw new Error("result must be a non-null, non-array object");
      }
      if (typeof (args.result as Record<string, unknown>).pipelineId !== 'string') {
        throw new Error("result.pipelineId must be a string");
      }
    }
    const { runId, ...fields } = args;
    // Auto-refresh heartbeat on active statuses (belt-and-suspenders)
    const patch = ACTIVE_STATUS_SET.has(args.status)
      ? { ...fields, lastHeartbeat: Date.now() }
      : fields;
    await ctx.db.patch(runId, patch);
  },
});

/**
 * Store or update review state inside runs.result.reviewState.
 * Called by the orchestrator when HITL review is needed and when Path B completes.
 */
export const updateReviewState = internalMutation({
  args: {
    runId: v.id("runs"),
    reviewState: v.any(),
  },
  handler: async (ctx, args) => {
    if (typeof args.reviewState !== 'object' || args.reviewState === null || Array.isArray(args.reviewState)) {
      throw new Error("reviewState must be a non-null, non-array object");
    }

    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const existingResult = (run.result ?? {}) as Record<string, unknown>;
    await ctx.db.patch(args.runId, {
      result: { ...existingResult, reviewState: args.reviewState },
    });
  },
});

export const updateConfig = internalMutation({
  args: {
    runId: v.id("runs"),
    orgId: v.id("organizations"),
    config: configValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== args.orgId) {
      throw new Error("Run not found in organization");
    }
    await ctx.db.patch(args.runId, { config: args.config });
  },
});

/**
 * Atomically merge a single key into runs.result.reviewR2Keys.
 * Eliminates race conditions when background review artifacts finish concurrently.
 */
export const mergeReviewR2Key = internalMutation({
  args: {
    runId: v.id("runs"),
    key: v.string(),
    value: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const existingResult = (run.result ?? {}) as Record<string, unknown>;
    const existingR2Keys = (existingResult.reviewR2Keys ?? {}) as Record<string, unknown>;

    await ctx.db.patch(args.runId, {
      result: {
        ...existingResult,
        reviewR2Keys: { ...existingR2Keys, [args.key]: args.value },
      },
    });
  },
});

/**
 * Atomically merge a platform export package descriptor into runs.result.exportPackages.
 * Intended for on-demand exporters that should not overwrite full run.result.
 */
export const mergeExportPackage = internalMutation({
  args: {
    runId: v.id("runs"),
    platform: v.string(),
    descriptor: v.any(),
  },
  handler: async (ctx, args) => {
    if (typeof args.descriptor !== 'object' || args.descriptor === null || Array.isArray(args.descriptor)) {
      throw new Error("descriptor must be a non-null, non-array object");
    }

    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const existingResult = (run.result ?? {}) as Record<string, unknown>;
    const existingPackages = (existingResult.exportPackages ?? {}) as Record<string, unknown>;

    await ctx.db.patch(args.runId, {
      result: {
        ...existingResult,
        exportPackages: {
          ...existingPackages,
          [args.platform]: args.descriptor,
        },
      },
    });
  },
});

export const clearExportPackages = internalMutation({
  args: {
    runId: v.id("runs"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run || run.orgId !== args.orgId) {
      throw new Error("Run not found in organization");
    }

    const existingResult = (run.result ?? {}) as Record<string, unknown>;
    const nextResult = { ...existingResult };
    delete nextResult.exportPackages;

    await ctx.db.patch(args.runId, {
      result: nextResult,
    });
  },
});

/**
 * Merge review diff summary into runs.result.reviewDiff.
 * Called after applyDecisions() to store the review diff for the UI.
 */
export const mergeReviewDiff = internalMutation({
  args: {
    runId: v.id('runs'),
    reviewDiff: v.any(),
  },
  handler: async (ctx, { runId, reviewDiff }) => {
    if (typeof reviewDiff !== 'object' || reviewDiff === null || Array.isArray(reviewDiff)) {
      throw new Error("reviewDiff must be a non-null, non-array object");
    }

    const run = await ctx.db.get(runId);
    if (!run) return;
    const result = (run.result ?? {}) as Record<string, unknown>;
    await ctx.db.patch(runId, {
      result: { ...result, reviewDiff },
    });
  },
});

/**
 * Attach a compact quality snapshot to runs.result.quality.
 * Full diff payload stays in runEvaluations table.
 */
export const setQualitySummary = internalMutation({
  args: {
    runId: v.id("runs"),
    quality: v.object({
      score: v.number(),
      grade: v.union(v.literal("A"), v.literal("B"), v.literal("C"), v.literal("D")),
      divergenceLevel: v.union(v.literal("none"), v.literal("minor"), v.literal("major")),
      evaluatedAt: v.string(),
      baselineVersion: v.optional(v.number()),
      datasetKey: v.string(),
      evaluationId: v.optional(v.id("runEvaluations")),
    }),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const existingResult = (run.result ?? {}) as Record<string, unknown>;

    await ctx.db.patch(args.runId, {
      result: { ...existingResult, quality: args.quality },
    });
  },
});

/**
 * Append a feedback entry to runs.result.feedback array.
 * Creates the array if it doesn't exist.
 */
export const addFeedbackEntry = internalMutation({
  args: {
    runId: v.id("runs"),
    entry: v.any(),
  },
  handler: async (ctx, args) => {
    if (typeof args.entry !== 'object' || args.entry === null || Array.isArray(args.entry)) {
      throw new Error("entry must be a non-null, non-array object");
    }

    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const existingResult = (run.result ?? {}) as Record<string, unknown>;
    const existingFeedback = (existingResult.feedback ?? []) as unknown[];

    await ctx.db.patch(args.runId, {
      result: {
        ...existingResult,
        feedback: [...existingFeedback, args.entry],
      },
    });
  },
});

/**
 * Heartbeat — update the lastHeartbeat timestamp for an active run.
 * Called every ~30s by the pipeline/review-completion process.
 * Only patches runs in active states; ignores terminal states silently.
 */
export const heartbeat = internalMutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    if (!ACTIVE_STATUS_SET.has(run.status)) return;

    await ctx.db.patch(args.runId, { lastHeartbeat: Date.now() });
  },
});

/**
 * Reconcile stale runs — called by a cron every 5 minutes.
 * Marks runs as "error" if they haven't sent a heartbeat within the threshold:
 *   - "resuming" runs: stale after 15 minutes
 *   - "in_progress" runs: stale after 90 minutes
 *   - "pending_review" runs: stale after 48 hours (review expired or state lost)
 * Uses `lastHeartbeat` with `_creationTime` as fallback for pre-existing runs.
 */
export const deleteByProject = internalMutation({
  args: {
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    // Verify all runs belong to the expected org
    for (const run of runs) {
      if (run.orgId !== args.orgId) {
        throw new Error("Run does not belong to the expected organization");
      }
    }
    for (const run of runs) {
      await ctx.db.delete(run._id);
    }
    return runs.length;
  },
});

/**
 * @deprecated Legacy Review Tables mutation retained only for historical compatibility.
 * Phase 6 removes all production callers.
 *
 * Merge table review metadata into runs.result.tableReview.
 */
export const mergeTableReview = internalMutation({
  args: {
    runId: v.id('runs'),
    tableReview: v.any(),
  },
  handler: async (ctx, { runId, tableReview }) => {
    if (typeof tableReview !== 'object' || tableReview === null || Array.isArray(tableReview)) {
      throw new Error("tableReview must be a non-null, non-array object");
    }

    const run = await ctx.db.get(runId);
    if (!run) return;
    const result = (run.result ?? {}) as Record<string, unknown>;
    const existing = (result.tableReview ?? {}) as Record<string, unknown>;
    await ctx.db.patch(runId, {
      result: { ...result, tableReview: { ...existing, ...tableReview } },
    });
  },
});

/**
 * @deprecated Legacy Review Tables mutation retained only for historical compatibility.
 * Phase 6 removes all production callers.
 *
 * Acquire a regeneration lock for a run.
 */
export const acquireRegenerationLock = internalMutation({
  args: {
    runId: v.id("runs"),
    lockedBy: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const result = (run.result ?? {}) as Record<string, unknown>;
    const tableReview = (result.tableReview ?? {}) as Record<string, unknown>;
    const existingLock = tableReview.regenerationLock as
      | { lockedBy: string; lockedAt: number }
      | undefined;

    const STALE_LOCK_MS = 15 * 60 * 1000; // 15 minutes
    const now = Date.now();

    // Check if lock is held and not stale
    if (existingLock && (now - existingLock.lockedAt) < STALE_LOCK_MS) {
      throw new Error(
        `Regeneration lock held by ${existingLock.lockedBy} since ${new Date(existingLock.lockedAt).toISOString()}`
      );
    }

    // Acquire lock (or recover stale lock)
    await ctx.db.patch(args.runId, {
      result: {
        ...result,
        tableReview: {
          ...tableReview,
          regenerationLock: {
            lockedBy: args.lockedBy,
            lockedAt: now,
          },
        },
      },
    });
  },
});

/**
 * @deprecated Legacy Review Tables mutation retained only for historical compatibility.
 * Phase 6 removes all production callers.
 *
 * Release the regeneration lock for a run.
 */
export const releaseRegenerationLock = internalMutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    const result = (run.result ?? {}) as Record<string, unknown>;
    const tableReview = (result.tableReview ?? {}) as Record<string, unknown>;

    // Remove the lock field
    const { regenerationLock: _, ...cleanTableReview } = tableReview;
    void _;

    await ctx.db.patch(args.runId, {
      result: {
        ...result,
        tableReview: cleanTableReview,
      },
    });
  },
});

export const reconcileStaleRuns = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const RESUMING_STALE_MS = 15 * 60 * 1000;          // 15 minutes
    const IN_PROGRESS_STALE_MS = 90 * 60 * 1000;       // 90 minutes
    const PENDING_REVIEW_STALE_MS = 48 * 60 * 60 * 1000; // 48 hours

    let reconciledCount = 0;

    // Check resuming runs
    const resumingRuns = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "resuming"))
      .collect();

    for (const run of resumingRuns) {
      const lastAlive = run.lastHeartbeat ?? run._creationTime;
      if (now - lastAlive > RESUMING_STALE_MS) {
        const staleMins = Math.round((now - lastAlive) / 60_000);
        console.warn(
          `[reconcileStaleRuns] Marking stale run as error: runId=${run._id} orgId=${run.orgId} projectId=${run.projectId} status=resuming staleMins=${staleMins}`,
        );
        await ctx.db.patch(run._id, {
          status: "error",
          error: "Pipeline interrupted — please re-run your project.",
          stage: "error",
          message: "Pipeline interrupted — please re-run your project.",
        });
        reconciledCount++;
      }
    }

    // Check in_progress runs
    const inProgressRuns = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "in_progress"))
      .collect();

    for (const run of inProgressRuns) {
      const lastAlive = run.lastHeartbeat ?? run._creationTime;
      if (now - lastAlive > IN_PROGRESS_STALE_MS) {
        const staleMins = Math.round((now - lastAlive) / 60_000);
        console.warn(
          `[reconcileStaleRuns] Marking stale run as error: runId=${run._id} orgId=${run.orgId} projectId=${run.projectId} status=in_progress staleMins=${staleMins}`,
        );
        await ctx.db.patch(run._id, {
          status: "error",
          error: "Pipeline interrupted — please re-run your project.",
          stage: "error",
          message: "Pipeline interrupted — please re-run your project.",
        });
        reconciledCount++;
      }
    }

    // Check pending_review runs (no heartbeat expected — use _creationTime / last status update)
    const pendingReviewRuns = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "pending_review"))
      .collect();

    for (const run of pendingReviewRuns) {
      const lastAlive = run.lastHeartbeat ?? run._creationTime;
      if (now - lastAlive > PENDING_REVIEW_STALE_MS) {
        const staleHours = Math.round((now - lastAlive) / (60 * 60_000));
        console.warn(
          `[reconcileStaleRuns] Marking expired review as error: runId=${run._id} orgId=${run.orgId} projectId=${run.projectId} status=pending_review staleHours=${staleHours}`,
        );
        await ctx.db.patch(run._id, {
          status: "error",
          error: "Review expired — please re-run your project.",
          stage: "error",
          message: "Review expired — please re-run your project.",
        });
        reconciledCount++;
      }
    }

    if (reconciledCount > 0) {
      console.warn(`[reconcileStaleRuns] Reconciled ${reconciledCount} stale run(s)`);
    }
  },
});
