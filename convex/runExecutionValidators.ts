import { v } from "convex/values";
import { v3PipelineStageValidator } from "../src/schemas/pipelineStageSchema";

export const executionStateValidator = v.union(
  v.literal("queued"),
  v.literal("claimed"),
  v.literal("running"),
  v.literal("pending_review"),
  v.literal("resuming"),
  v.literal("success"),
  v.literal("partial"),
  v.literal("error"),
  v.literal("cancelled")
);

export const recoveryStatusValidator = v.union(
  v.literal("none"),
  v.literal("queued_recovery"),
  v.literal("resume_required"),
  v.literal("recovery_failed")
);

export const workerFileNamesValidator = v.object({
  dataMap: v.string(),
  bannerPlan: v.string(),
  dataFile: v.string(),
  survey: v.union(v.string(), v.null()),
  messageList: v.union(v.string(), v.null()),
});

export const workerInputRefsValidator = v.object({
  dataMap: v.union(v.string(), v.null()),
  bannerPlan: v.union(v.string(), v.null()),
  spss: v.string(),
  survey: v.union(v.string(), v.null()),
  messageList: v.union(v.string(), v.null()),
});

export const executionPayloadValidator = v.object({
  sessionId: v.string(),
  fileNames: workerFileNamesValidator,
  inputRefs: workerInputRefsValidator,
  loopStatTestingMode: v.optional(
    v.union(v.literal("suppress"), v.literal("complement"))
  ),
});

export const enqueueForWorkerArgsValidator = v.object({
  runId: v.id("runs"),
  executionPayload: executionPayloadValidator,
});

export const claimNextQueuedRunResultValidator = v.union(
  v.null(),
  v.object({
    runId: v.id("runs"),
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    launchedBy: v.optional(v.id("users")),
    attemptCount: v.number(),
    config: v.any(),
    executionPayload: executionPayloadValidator,
    resumeFromStage: v.optional(v3PipelineStageValidator),
  })
);
