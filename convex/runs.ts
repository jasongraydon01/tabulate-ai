import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";
import { v3PipelineStageValidator } from "../src/schemas/pipelineStageSchema";
import { configValidator } from "./projectConfigValidators";
import {
  executionPayloadValidator,
  recoveryManifestValidator,
  workerQueueClassValidator,
} from "./runExecutionValidators";
import { getRunArtifactsExpireAt } from "../src/lib/runs/artifactRetention";
import { getStaleWorkerRecoveryAction } from "../src/lib/worker/recovery";
import {
  buildClaimCandidateOrder,
  getWorkerQueueClass,
  normalizeWorkerQueueCapacity,
} from "../src/lib/worker/scheduling";

/** Statuses that represent an actively-running pipeline (heartbeat expected). */
const ACTIVE_STATUSES = ["in_progress", "resuming"] as const;
const ACTIVE_STATUS_SET = new Set<string>(ACTIVE_STATUSES);
const WORKER_ACTIVE_EXECUTION_STATES = new Set(["claimed", "running", "resuming"]);
const TERMINAL_STATUSES = new Set(["success", "partial", "error", "cancelled"]);
const TERMINAL_STATUS_VALUES = ["success", "partial", "error", "cancelled"] as const;
const WORKER_QUEUE_CAPACITY = normalizeWorkerQueueCapacity({
  maxActiveDemoRuns: Number(process.env.PIPELINE_WORKER_MAX_ACTIVE_DEMO_RUNS ?? 2),
  maxActiveRunsPerOrg: Number(process.env.PIPELINE_WORKER_MAX_ACTIVE_RUNS_PER_ORG ?? 2),
});

function patchForActiveWorkerStatus(
  existingExecutionState: string | undefined,
  now: number,
): Record<string, unknown> {
  if (existingExecutionState === "queued") {
    return {
      executionState: "queued",
      lastHeartbeat: now,
    };
  }

  if (existingExecutionState && WORKER_ACTIVE_EXECUTION_STATES.has(existingExecutionState)) {
    return {
      executionState: "running",
      lastHeartbeat: now,
      heartbeatAt: now,
    };
  }

  return { lastHeartbeat: now };
}

export function patchForStatusTransition(
  existingExecutionState: string | undefined,
  nextStatus: "in_progress" | "pending_review" | "resuming" | "success" | "partial" | "error" | "cancelled",
  now: number,
): Record<string, unknown> {
  if (TERMINAL_STATUSES.has(nextStatus)) {
    return {
      executionState: nextStatus,
      workerId: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
      resumeFromStage: undefined,
    };
  }

  if (nextStatus === "pending_review") {
    return {
      executionState: "pending_review",
      workerId: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
      lastHeartbeat: now,
      resumeFromStage: undefined,
    };
  }

  if (nextStatus === "resuming") {
    return patchForActiveWorkerStatus(existingExecutionState, now);
  }

  if (
    nextStatus === "in_progress"
    && existingExecutionState
    && (existingExecutionState === "queued" || WORKER_ACTIVE_EXECUTION_STATES.has(existingExecutionState))
  ) {
    return patchForActiveWorkerStatus(existingExecutionState, now);
  }

  if (ACTIVE_STATUS_SET.has(nextStatus)) {
    return { lastHeartbeat: now };
  }

  return {};
}

interface StaleWorkerRunRecord {
  _id: unknown;
  _creationTime: number;
  cancelRequested: boolean;
  heartbeatAt?: number;
  lastHeartbeat?: number;
  claimedAt?: number;
  recoveryManifest?: unknown;
}

async function requeueStaleWorkerRunRecords(
  runs: StaleWorkerRunRecord[],
  staleBeforeMs: number,
  patchRun: (runId: unknown, patch: Record<string, unknown>) => Promise<void>,
): Promise<number> {
  const now = Date.now();
  let requeuedCount = 0;

  for (const run of runs) {
    const recoveryAction = getStaleWorkerRecoveryAction({
      run: run as Parameters<typeof getStaleWorkerRecoveryAction>[0]["run"],
      staleBeforeMs,
      now,
    });

    if (recoveryAction.action === "skip") continue;

    if (recoveryAction.action === "cancel") {
      await patchRun(run._id, {
        status: "cancelled",
        executionState: "cancelled",
        message: "Pipeline cancelled by user",
        workerId: undefined,
        claimedAt: undefined,
        heartbeatAt: undefined,
      });
      continue;
    }

    if (recoveryAction.action === "fail") {
      await patchRun(run._id, {
        status: "error",
        executionState: "error",
        stage: "error",
        error: recoveryAction.message,
        message: recoveryAction.message,
        workerId: undefined,
        claimedAt: undefined,
        heartbeatAt: undefined,
        recoveryStatus: "recovery_failed",
      });
      continue;
    }

    await patchRun(run._id, {
      status: recoveryAction.resumeFromStage ? "resuming" : "in_progress",
      executionState: "queued",
      message: recoveryAction.message,
      workerId: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
      resumeFromStage: recoveryAction.resumeFromStage,
      recoveryStatus: recoveryAction.resumeFromStage ? "queued_recovery" : "none",
    });
    requeuedCount++;
  }

  return requeuedCount;
}

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
      attemptCount: 0,
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
      executionState: "cancelled",
      message: "Pipeline cancelled by user",
      workerId: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
    });
  },
});

export const enqueueForWorker = internalMutation({
  args: {
    runId: v.id("runs"),
    queueClass: workerQueueClassValidator,
    executionPayload: executionPayloadValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    if (run.cancelRequested) {
      await ctx.db.patch(args.runId, {
        status: "cancelled",
        executionState: "cancelled",
        message: "Pipeline cancelled by user",
      });
      return;
    }

    await ctx.db.patch(args.runId, {
      status: "in_progress",
      stage: "uploading",
      progress: 0,
      message: "Queued for worker pickup...",
      executionState: "queued",
      queueClass: args.queueClass,
      executionPayload: args.executionPayload,
      workerId: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
      lastHeartbeat: Date.now(),
      attemptCount: run.attemptCount ?? 0,
      resumeFromStage: undefined,
      recoveryStatus: "none",
      recoveryManifest: undefined,
    });
  },
});

export const enqueueReviewResume = internalMutation({
  args: {
    runId: v.id("runs"),
    resumeFromStage: v.optional(v3PipelineStageValidator),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    if (!run.executionPayload) {
      await ctx.db.patch(args.runId, {
        status: "error",
        executionState: "error",
        stage: "error",
        error: "Review resume is missing execution payload.",
        message: "Review resume is missing execution payload.",
      });
      return;
    }

    if (run.cancelRequested) {
      await ctx.db.patch(args.runId, {
        status: "cancelled",
        executionState: "cancelled",
        message: "Pipeline cancelled by user",
        workerId: undefined,
        claimedAt: undefined,
        heartbeatAt: undefined,
      });
      return;
    }

    await ctx.db.patch(args.runId, {
      status: "resuming",
      stage: args.resumeFromStage ?? "applying_review",
      progress: 55,
      message: "Queued for worker resume...",
      executionState: "queued",
      queueClass: "review_resume",
      workerId: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
      lastHeartbeat: Date.now(),
      resumeFromStage: args.resumeFromStage ?? "applying_review",
      recoveryStatus: "none",
    });
  },
});

export const updateRecoveryManifest = internalMutation({
  args: {
    runId: v.id("runs"),
    recoveryManifest: recoveryManifestValidator,
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const existingResult = (run.result ?? {}) as Record<string, unknown>;
    await ctx.db.patch(args.runId, {
      recoveryManifest: args.recoveryManifest,
      lastDurableCheckpointAt: args.recoveryManifest.createdAt,
      lastDurableCheckpointStage: args.recoveryManifest.resumeStage,
      recoveryStatus: "none",
      resumeFromStage: undefined,
      result: {
        ...existingResult,
        formatVersion: 3,
        pipelineId: args.recoveryManifest.pipelineContext.pipelineId,
        outputDir: args.recoveryManifest.pipelineContext.outputDir,
        dataset: args.recoveryManifest.pipelineContext.datasetName,
      },
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
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const { runId, ...fields } = args;
    const now = Date.now();
    const patch = {
      ...fields,
      ...patchForStatusTransition(run.executionState, args.status, now),
    };
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

export const markExpiredRuns = internalMutation({
  handler: async (ctx) => {
    const now = Date.now();
    const candidates: Array<{ _id: unknown; _creationTime: number }> = [];

    for (const status of TERMINAL_STATUS_VALUES) {
      const runs = await ctx.db
        .query("runs")
        .withIndex("by_status", (q) => q.eq("status", status))
        .order("asc")
        .collect();

      for (const run of runs) {
        if (typeof run.expiredAt === "number") continue;
        if (getRunArtifactsExpireAt(run._creationTime) > now) continue;
        candidates.push({ _id: run._id, _creationTime: run._creationTime });
      }
    }

    const toExpire = candidates
      .sort((a, b) => a._creationTime - b._creationTime)
      .slice(0, 50);

    for (const run of toExpire) {
      await ctx.db.patch(run._id as never, {
        expiredAt: now,
        artifactCleanupError: undefined,
      });
    }

    return { expired: toExpire.length };
  },
});

export const getRunsPendingArtifactCleanup = internalQuery({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const runs = await ctx.db
      .query("runs")
      .withIndex("by_expired_at")
      .order("asc")
      .collect();

    const limit = args.limit ?? 5;
    return runs
      .filter((run) => typeof run.expiredAt === "number" && typeof run.artifactsPurgedAt !== "number")
      .slice(0, limit)
      .map((run) => ({
        _id: run._id,
        orgId: run.orgId,
        projectId: run.projectId,
        result: run.result,
      }));
  },
});

export const markRunArtifactsPurged = internalMutation({
  args: {
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    const now = Date.now();
    const existingResult = (run.result ?? {}) as Record<string, unknown>;
    const nextResult = { ...existingResult };
    delete nextResult.r2Files;
    delete nextResult.exportPackages;
    delete nextResult.reviewR2Keys;

    await ctx.db.patch(args.runId, {
      artifactsPurgedAt: now,
      lastArtifactCleanupAttemptAt: now,
      artifactCleanupError: undefined,
      result: nextResult,
    });
  },
});

export const recordArtifactCleanupFailure = internalMutation({
  args: {
    runId: v.id("runs"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found");

    await ctx.db.patch(args.runId, {
      lastArtifactCleanupAttemptAt: Date.now(),
      artifactCleanupError: args.error,
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
    workerId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;

    if (!ACTIVE_STATUS_SET.has(run.status)) return;

    const now = Date.now();

    if (args.workerId) {
      if (run.workerId !== args.workerId || !run.executionState || !WORKER_ACTIVE_EXECUTION_STATES.has(run.executionState)) {
        return;
      }
      await ctx.db.patch(args.runId, {
        lastHeartbeat: now,
        heartbeatAt: now,
        executionState: "running",
      });
      return;
    }

    await ctx.db.patch(args.runId, { lastHeartbeat: now });
  },
});

export const claimNextQueuedRun = internalMutation({
  args: {
    workerId: v.string(),
  },
  handler: async (ctx, args) => {
    const queuedRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "queued"))
      .order("asc")
      .collect();
    const claimedRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "claimed"))
      .collect();
    const runningRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "running"))
      .collect();
    const resumingRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "resuming"))
      .collect();

    const candidateRuns = buildClaimCandidateOrder(
      queuedRuns.map((run) => ({
        ...run,
        orgId: String(run.orgId),
        queueClass: getWorkerQueueClass({
          orgId: String(run.orgId),
          queueClass: run.queueClass,
          resumeFromStage: run.resumeFromStage,
        }),
      })),
      [...claimedRuns, ...runningRuns, ...resumingRuns].map((run) => ({
        orgId: String(run.orgId),
        queueClass: getWorkerQueueClass({
          orgId: String(run.orgId),
          queueClass: run.queueClass,
          resumeFromStage: run.resumeFromStage,
        }),
        resumeFromStage: run.resumeFromStage,
      })),
      WORKER_QUEUE_CAPACITY,
    );

    for (const run of candidateRuns) {
      if (run.cancelRequested) {
        await ctx.db.patch(run._id, {
          status: "cancelled",
          executionState: "cancelled",
          queueClass: run.queueClass,
          workerId: undefined,
          claimedAt: undefined,
          heartbeatAt: undefined,
          message: "Pipeline cancelled by user",
        });
        continue;
      }

      if (!run.executionPayload) {
        await ctx.db.patch(run._id, {
          status: "error",
          executionState: "error",
          queueClass: run.queueClass,
          error: "Queued run is missing execution payload.",
          stage: "error",
          message: "Queued run is missing execution payload.",
          workerId: undefined,
          claimedAt: undefined,
          heartbeatAt: undefined,
        });
        continue;
      }

      const now = Date.now();
      const attemptCount = (run.attemptCount ?? 0) + 1;
      await ctx.db.patch(run._id, {
        executionState: "claimed",
        queueClass: run.queueClass,
        workerId: args.workerId,
        claimedAt: now,
        heartbeatAt: now,
        lastHeartbeat: now,
        attemptCount,
        status: run.resumeFromStage ? "resuming" : run.status,
        message: run.resumeFromStage
          ? `Worker claimed run for recovery from ${run.resumeFromStage}.`
          : "Worker claimed run.",
      });

      return {
        runId: run._id,
        orgId: run.orgId,
        projectId: run.projectId,
        launchedBy: run.launchedBy,
        attemptCount,
        config: run.config,
        executionPayload: run.executionPayload,
        recoveryManifest: run.recoveryManifest,
        resumeFromStage: run.resumeFromStage,
      };
    }

    return null;
  },
});

export const releaseRun = internalMutation({
  args: {
    runId: v.id("runs"),
    workerId: v.string(),
    reason: v.union(
      v.literal("requeue"),
      v.literal("failed"),
      v.literal("cancelled"),
      v.literal("completed")
    ),
    message: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return;
    if (run.workerId !== args.workerId) return;

    const patch: Record<string, unknown> = {
      workerId: undefined,
      claimedAt: undefined,
      heartbeatAt: undefined,
    };

    if (args.reason === "requeue") {
      patch.executionState = run.cancelRequested ? "cancelled" : "queued";
      if (run.cancelRequested) {
        patch.status = "cancelled";
        patch.message = "Pipeline cancelled by user";
      } else {
        patch.status = "in_progress";
        patch.message = args.message ?? "Run requeued after worker interruption.";
      }
    } else if (args.reason === "failed") {
      patch.executionState = "error";
      patch.status = "error";
      patch.stage = "error";
      patch.error = args.message ?? "Worker released run after an unrecoverable failure.";
      patch.message = args.message ?? "Worker released run after an unrecoverable failure.";
      patch.recoveryStatus = run.resumeFromStage ? "recovery_failed" : run.recoveryStatus;
    } else if (args.reason === "cancelled") {
      patch.executionState = "cancelled";
      patch.status = "cancelled";
      patch.message = args.message ?? "Pipeline cancelled by user";
    } else if (!TERMINAL_STATUSES.has(run.status)) {
      patch.executionState = "error";
      patch.status = "error";
      patch.stage = "error";
      patch.error = args.message ?? "Worker released run without a terminal status.";
      patch.message = args.message ?? "Worker released run without a terminal status.";
    }

    await ctx.db.patch(args.runId, patch);
  },
});

export const requeueStaleRuns = internalMutation({
  args: {
    staleBeforeMs: v.number(),
  },
  handler: async (ctx, args) => {
    const staleWorkerRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "claimed"))
      .collect();
    const runningWorkerRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "running"))
      .collect();
    const resumingWorkerRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "resuming"))
      .collect();
    return requeueStaleWorkerRunRecords(
      [...staleWorkerRuns, ...runningWorkerRuns, ...resumingWorkerRuns],
      args.staleBeforeMs,
      (runId, patch) => ctx.db.patch(runId as never, patch),
    );
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

    const claimedRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "claimed"))
      .collect();
    const runningRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "running"))
      .collect();
    const resumingExecutionRuns = await ctx.db
      .query("runs")
      .withIndex("by_execution_state", (q) => q.eq("executionState", "resuming"))
      .collect();

    reconciledCount += await requeueStaleWorkerRunRecords(
      [...claimedRuns, ...runningRuns, ...resumingExecutionRuns],
      IN_PROGRESS_STALE_MS,
      (runId, patch) => ctx.db.patch(runId as never, patch),
    );

    // Check resuming runs
    const resumingRuns = await ctx.db
      .query("runs")
      .withIndex("by_status", (q) => q.eq("status", "resuming"))
      .collect();

    for (const run of resumingRuns) {
      if (run.workerId) continue;
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
      if (run.executionState === "queued" || WORKER_ACTIVE_EXECUTION_STATES.has(run.executionState ?? "")) {
        continue;
      }
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
