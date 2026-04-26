import { v } from "convex/values";
import { v3PipelineStageValidator } from "../src/schemas/pipelineStageSchema";

export const workerRecoveryBoundaryValidator = v.union(
  v.literal("question_id"),
  v.literal("fork_join"),
  v.literal("review_checkpoint"),
  v.literal("compute")
);

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

export const workerQueueClassValidator = v.union(
  v.literal("review_resume"),
  v.literal("project"),
  v.literal("demo")
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

export const workerPipelineContextValidator = v.object({
  pipelineId: v.string(),
  datasetName: v.string(),
  outputDir: v.string(),
});

export const workerInputRefsValidator = v.object({
  dataMap: v.union(v.string(), v.null()),
  bannerPlan: v.union(v.string(), v.null()),
  spss: v.string(),
  survey: v.union(v.string(), v.null()),
  messageList: v.union(v.string(), v.null()),
});

export const analysisExtensionPayloadValidator = v.object({
  kind: v.literal("banner_extension"),
  jobId: v.string(),
  parentRunId: v.string(),
  parentPipelineId: v.string(),
  parentDatasetName: v.string(),
  parentR2Outputs: v.record(v.string(), v.string()),
  frozenBannerGroup: v.any(),
  frozenValidatedGroup: v.any(),
  fingerprint: v.string(),
});

export const recoveryArtifactRefsValidator = v.object({
  checkpoint: v.optional(v.string()),
  questionIdFinal: v.optional(v.string()),
  tableCanonical: v.optional(v.string()),
  tableEnriched: v.optional(v.string()),
  crosstabPlan: v.optional(v.string()),
  computePackage: v.optional(v.string()),
  reviewState: v.optional(v.string()),
  pipelineSummary: v.optional(v.string()),
  dataFileSav: v.optional(v.string()),
});

export const recoveryManifestValidator = v.object({
  schemaVersion: v.number(),
  boundary: workerRecoveryBoundaryValidator,
  resumeStage: v3PipelineStageValidator,
  pipelineContext: workerPipelineContextValidator,
  artifactRefs: recoveryArtifactRefsValidator,
  requiredArtifacts: v.array(v.string()),
  missingArtifacts: v.array(v.string()),
  isComplete: v.boolean(),
  createdAt: v.number(),
  manifestKey: v.optional(v.string()),
});

export const executionPayloadValidator = v.object({
  sessionId: v.string(),
  pipelineContext: workerPipelineContextValidator,
  fileNames: workerFileNamesValidator,
  inputRefs: workerInputRefsValidator,
  loopStatTestingMode: v.optional(
    v.union(v.literal("suppress"), v.literal("complement"))
  ),
  analysisExtension: v.optional(analysisExtensionPayloadValidator),
});

export const enqueueForWorkerArgsValidator = v.object({
  runId: v.id("runs"),
  queueClass: workerQueueClassValidator,
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
    recoveryManifest: v.optional(recoveryManifestValidator),
    resumeFromStage: v.optional(v3PipelineStageValidator),
  })
);
