import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { v3PipelineStageValidator } from "../src/schemas/pipelineStageSchema";
import { configValidator, intakeValidator } from "./projectConfigValidators";
import {
  executionPayloadValidator,
  executionStateValidator,
  recoveryManifestValidator,
  recoveryStatusValidator,
  workerQueueClassValidator,
} from "./runExecutionValidators";

// ---------------------------------------------------------------------------
// Typed sub-validators (replaces v.any() where shape is known)
// ---------------------------------------------------------------------------

const baselineArtifactKeysValidator = v.object({
  banner: v.string(),
  crosstab: v.string(),
  verification: v.string(),
  data: v.string(),
  manifest: v.optional(v.string()),
});

const evaluationBreakdownValidator = v.object({
  banner: v.number(),
  crosstab: v.number(),
  structure: v.number(),
  data: v.number(),
  diagnostics: v.number(),
});

const evaluationTopDiffValidator = v.object({
  category: v.union(
    v.literal("banner"),
    v.literal("crosstab"),
    v.literal("structure"),
    v.literal("data")
  ),
  severity: v.union(v.literal("minor"), v.literal("major"), v.literal("critical")),
  kind: v.string(),
  message: v.string(),
  tableId: v.optional(v.string()),
  groupName: v.optional(v.string()),
  columnName: v.optional(v.string()),
  cut: v.optional(v.string()),
  rowKey: v.optional(v.string()),
  field: v.optional(v.string()),
  expected: v.optional(v.string()),
  actual: v.optional(v.string()),
});

const wincrossPreferenceProfileValidator = v.object({
  version: v.union(v.string(), v.null()),
  numericPreferenceVector: v.union(v.string(), v.null()),
  tableOptionSignature: v.union(v.string(), v.null()),
  defaultTotalLine: v.union(v.string(), v.null()),
  preferenceLines: v.optional(v.array(v.string())),
  tokenDictionary: v.record(v.string(), v.string()),
  statsDictionary: v.record(v.string(), v.string()),
  sigFooterLines: v.array(v.string()),
  bannerLines: v.array(v.string()),
  bannerMemberLines: v.optional(v.array(v.string())),
  bannerDisplayLines: v.optional(v.array(v.string())),
  bannerLayoutLines: v.optional(v.array(v.string())),
  titleLines: v.array(v.string()),
  passthroughSections: v.record(v.string(), v.array(v.string())),
  tableStyleHints: v.optional(v.object({
    sourceTableCount: v.number(),
    valueReferenceColumn: v.union(v.number(), v.null()),
    statLabelCaretColumn: v.union(v.number(), v.null()),
    netRowSuffixToken: v.union(v.string(), v.null()),
    headerLeadingSpaces: v.union(v.number(), v.null()),
    headerRowPattern: v.union(
      v.literal("none"),
      v.literal("leading_label_only"),
      v.literal("sectioned_label_only"),
      v.literal("trailing_label_only"),
      v.literal("mixed_or_unsafe"),
    ),
    notes: v.optional(v.array(v.string())),
  })),
  tablePatternHints: v.object({
    tableCount: v.number(),
    useCount: v.number(),
    afCount: v.number(),
    sbaseCount: v.number(),
  }),
});

const wincrossParseDiagnosticsValidator = v.object({
  warnings: v.array(v.string()),
  errors: v.array(v.string()),
  sectionNames: v.array(v.string()),
  encoding: v.union(v.literal("utf16le"), v.literal("utf8"), v.literal("unknown")),
});

const analysisSourceClassValidator = v.union(
  v.literal("from_tabs"),
  v.literal("assistant_synthesis"),
  v.literal("computed_derivation"),
);

const analysisGroundingRefValidator = v.object({
  claimId: v.string(),
  claimType: v.union(v.literal("numeric"), v.literal("context"), v.literal("cell")),
  evidenceKind: v.union(v.literal("table_card"), v.literal("context"), v.literal("cell")),
  refType: v.string(),
  refId: v.string(),
  label: v.string(),
  anchorId: v.optional(v.string()),
  artifactId: v.optional(v.id("analysisArtifacts")),
  sourceTableId: v.optional(v.string()),
  sourceQuestionId: v.optional(v.string()),
  rowKey: v.optional(v.string()),
  cutKey: v.optional(v.string()),
  renderedInCurrentMessage: v.optional(v.boolean()),
});

const analysisAgentMetricsValidator = v.object({
  model: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  nonCachedInputTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  cacheWriteInputTokens: v.optional(v.number()),
  durationMs: v.number(),
  estimatedCostUsd: v.optional(v.number()),
});

const analysisComputeJobStatusValidator = v.union(
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

const analysisComputeJobTypeValidator = v.union(
  v.literal("banner_extension_recompute"),
  v.literal("table_rollup_derivation"),
  v.literal("selected_table_cut_derivation"),
);

const analysisComputeReviewFlagsValidator = v.object({
  requiresClarification: v.boolean(),
  requiresReview: v.boolean(),
  reasons: v.array(v.string()),
  averageConfidence: v.number(),
  policyFallbackDetected: v.boolean(),
  draftConfidence: v.optional(v.number()),
});

const analysisMessagePartValidator = v.object({
  type: v.string(),
  text: v.optional(v.string()),
  tableId: v.optional(v.string()),
  focus: v.optional(v.object({
    rowLabels: v.optional(v.array(v.string())),
    rowRefs: v.optional(v.array(v.string())),
    groupNames: v.optional(v.array(v.string())),
    groupRefs: v.optional(v.array(v.string())),
  })),
  cellIds: v.optional(v.array(v.string())),
  state: v.optional(v.string()),
  artifactId: v.optional(v.id("analysisArtifacts")),
  label: v.optional(v.string()),
  toolCallId: v.optional(v.string()),
  input: v.optional(v.any()),
  output: v.optional(v.any()),
  // Inline cell summary for tool-confirmCitation parts. Loose shape mirrors the
  // polymorphic payload policy elsewhere in the table; the TypeScript surface
  // in @/lib/analysis/types enforces the shape on read.
  cellSummary: v.optional(v.any()),
});

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export default defineSchema({
  organizations: defineTable({
    workosOrgId: v.string(),
    name: v.string(),
    slug: v.string(),
    stripeCustomerId: v.optional(v.string()),
  })
    .index("by_workos_org_id", ["workosOrgId"])
    .index("by_slug", ["slug"])
    .index("by_stripe_customer", ["stripeCustomerId"]),

  users: defineTable({
    workosUserId: v.string(),
    email: v.string(),
    name: v.string(),
    notificationPreferences: v.optional(v.object({
      pipelineEmails: v.boolean(),
    })),
  })
    .index("by_workos_user_id", ["workosUserId"])
    .index("by_email", ["email"]),

  orgMemberships: defineTable({
    userId: v.id("users"),
    orgId: v.id("organizations"),
    role: v.union(
      v.literal("admin"),
      v.literal("member"),
      v.literal("external_partner")
    ),
    removedAt: v.optional(v.number()),
  })
    .index("by_user_and_org", ["userId", "orgId"])
    .index("by_org", ["orgId"]),

  wincrossPreferenceProfiles: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    profile: wincrossPreferenceProfileValidator,
    diagnostics: v.optional(wincrossParseDiagnosticsValidator),
    sourceFileName: v.optional(v.string()),
    sourceFileHash: v.optional(v.string()),
    isDefault: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_default", ["orgId", "isDefault"]),

  projects: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    projectType: v.union(v.literal("crosstab"), v.literal("other")),
    config: configValidator,
    intake: intakeValidator,
    fileKeys: v.array(v.string()),
    createdBy: v.id("users"),
    isDeleted: v.optional(v.boolean()),
    deletedAt: v.optional(v.number()),
    billingCounted: v.optional(v.boolean()),
  }).index("by_org", ["orgId"]),

  runs: defineTable({
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
    launchedBy: v.optional(v.id("users")),
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
    config: configValidator,
    executionState: v.optional(executionStateValidator),
    queueClass: v.optional(workerQueueClassValidator),
    workerId: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    heartbeatAt: v.optional(v.number()),
    attemptCount: v.optional(v.number()),
    resumeFromStage: v.optional(v3PipelineStageValidator),
    lastDurableCheckpointAt: v.optional(v.number()),
    lastDurableCheckpointStage: v.optional(v3PipelineStageValidator),
    recoveryStatus: v.optional(recoveryStatusValidator),
    recoveryManifest: v.optional(recoveryManifestValidator),
    executionPayload: v.optional(executionPayloadValidator),
    // result is deeply polymorphic — accumulates pipelineId, outputDir, downloadUrl,
    // reviewState, feedback, r2Files, costSummary across pipeline stages.
    // Risk mitigated by internalMutation conversion (H7).
    result: v.optional(v.any()),
    error: v.optional(v.string()),
    cancelRequested: v.boolean(),
    lastHeartbeat: v.optional(v.number()),
    expiredAt: v.optional(v.number()),
    artifactsPurgedAt: v.optional(v.number()),
    lastArtifactCleanupAttemptAt: v.optional(v.number()),
    artifactCleanupError: v.optional(v.string()),
    origin: v.optional(v.union(
      v.literal("project"),
      v.literal("demo"),
      v.literal("analysis_compute"),
    )),
    parentRunId: v.optional(v.id("runs")),
    analysisComputeJobId: v.optional(v.id("analysisComputeJobs")),
    lineageKind: v.optional(v.literal("banner_extension")),
  })
    .index("by_project", ["projectId"])
    .index("by_org", ["orgId"])
    .index("by_status", ["status"])
    .index("by_execution_state", ["executionState"])
    .index("by_expired_at", ["expiredAt"]),

  goldenBaselines: defineTable({
    orgId: v.id("organizations"),
    projectId: v.optional(v.id("projects")),
    sourceRunId: v.id("runs"),
    datasetKey: v.string(),
    artifactKeys: baselineArtifactKeysValidator,
    version: v.number(),
    status: v.union(
      v.literal("draft"),
      v.literal("active"),
      v.literal("superseded"),
      v.literal("archived")
    ),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    activatedAt: v.optional(v.number()),
    supersededAt: v.optional(v.number()),
  })
    .index("by_org", ["orgId"])
    .index("by_org_dataset", ["orgId", "datasetKey"])
    .index("by_org_dataset_status", ["orgId", "datasetKey", "status"])
    .index("by_source_run", ["sourceRunId"]),

  runEvaluations: defineTable({
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    datasetKey: v.string(),
    baselineId: v.optional(v.id("goldenBaselines")),
    baselineVersion: v.optional(v.number()),
    score: v.number(),
    grade: v.union(v.literal("A"), v.literal("B"), v.literal("C"), v.literal("D")),
    divergenceLevel: v.union(v.literal("none"), v.literal("minor"), v.literal("major")),
    summary: v.string(),
    breakdown: evaluationBreakdownValidator,
    diffCounts: v.object({
      total: v.number(),
      meaningful: v.number(),
      acceptable: v.number(),
    }),
    topDiffs: v.array(evaluationTopDiffValidator),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"])
    .index("by_run", ["runId"])
    .index("by_org_created", ["orgId", "createdAt"])
    .index("by_org_score", ["orgId", "score"]),

  subscriptions: defineTable({
    orgId: v.id("organizations"),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    plan: v.union(
      v.literal("payg"),
      v.literal("starter"),
      v.literal("professional"),
      v.literal("studio"),
    ),
    status: v.union(
      v.literal("active"),
      v.literal("past_due"),
      v.literal("canceled"),
      v.literal("trialing"),
      v.literal("unpaid"),
    ),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    projectsUsed: v.number(),
    projectLimit: v.number(),
    overageRate: v.number(),
    cancelAtPeriodEnd: v.boolean(),
    billingNotifications: v.optional(v.object({
      nearLimitSentAt: v.optional(v.number()),
      overageSentAt: v.optional(v.number()),
      upgradeSuggestionSentAt: v.optional(v.number()),
    })),
  })
    .index("by_org", ["orgId"])
    .index("by_stripe_customer", ["stripeCustomerId"])
    .index("by_stripe_subscription", ["stripeSubscriptionId"]),

  tableRegenerations: defineTable({
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    tableId: v.string(),
    requestedBy: v.string(),
    feedback: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("success"),
      v.literal("failed")
    ),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    changeSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    // Snapshots are deeply polymorphic table definitions — store as v.any()
    // Risk mitigated: internalMutation only, runtime guards in mutation handlers
    beforeSnapshot: v.optional(v.any()),
    afterSnapshot: v.optional(v.any()),
  })
    .index("by_run", ["runId"])
    .index("by_run_table", ["runId", "tableId"])
    .index("by_org", ["orgId"]),

  analysisSessions: defineTable({
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    createdBy: v.id("users"),
    title: v.string(),
    titleSource: v.optional(v.union(
      v.literal("default"),
      v.literal("generated"),
      v.literal("manual"),
    )),
    status: v.union(
      v.literal("active"),
      v.literal("archived"),
    ),
    createdAt: v.number(),
    lastMessageAt: v.number(),
  })
    .index("by_run", ["runId"])
    .index("by_org", ["orgId"])
    .index("by_project", ["projectId"]),

  analysisMessages: defineTable({
    sessionId: v.id("analysisSessions"),
    orgId: v.id("organizations"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    content: v.string(),
    parts: v.optional(v.array(analysisMessagePartValidator)),
    groundingRefs: v.optional(v.array(analysisGroundingRefValidator)),
    contextEvidence: v.optional(v.array(analysisGroundingRefValidator)),
    followUpSuggestions: v.optional(v.array(v.string())),
    agentMetrics: v.optional(analysisAgentMetricsValidator),
    createdAt: v.number(),
  }).index("by_session_created", ["sessionId", "createdAt"]),

  analysisMessageFeedback: defineTable({
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    sessionId: v.id("analysisSessions"),
    messageId: v.id("analysisMessages"),
    userId: v.id("users"),
    vote: v.union(v.literal("up"), v.literal("down")),
    correctionText: v.union(v.string(), v.null()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_session_user", ["sessionId", "userId"])
    .index("by_message_user", ["messageId", "userId"])
    .index("by_org", ["orgId"])
    .index("by_run", ["runId"]),

  analysisArtifacts: defineTable({
    sessionId: v.id("analysisSessions"),
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    artifactType: v.union(
      v.literal("table_card"),
      v.literal("note"),
    ),
    sourceClass: analysisSourceClassValidator,
    title: v.string(),
    sourceTableIds: v.array(v.string()),
    sourceQuestionIds: v.array(v.string()),
    lineage: v.optional(v.object({
      sourceRunId: v.id("runs"),
      sourceTableIds: v.array(v.string()),
      analysisComputeJobId: v.optional(v.id("analysisComputeJobs")),
      derivationType: v.optional(v.string()),
    })),
    // Payload varies by rendered card type and remains internal-only for v1.
    payload: v.any(),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_run", ["runId"]),

  analysisComputeJobs: defineTable({
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    parentRunId: v.id("runs"),
    childRunId: v.optional(v.id("runs")),
    sessionId: v.id("analysisSessions"),
    requestedBy: v.id("users"),
    jobType: analysisComputeJobTypeValidator,
    status: analysisComputeJobStatusValidator,
    requestText: v.string(),
    frozenBannerGroup: v.optional(v.any()),
    frozenValidatedGroup: v.optional(v.any()),
    frozenTableRollupSpec: v.optional(v.any()),
    frozenSelectedTableCutSpec: v.optional(v.any()),
    derivedArtifactId: v.optional(v.id("analysisArtifacts")),
    reviewFlags: v.optional(analysisComputeReviewFlagsValidator),
    fingerprint: v.optional(v.string()),
    promptSummary: v.optional(v.string()),
    r2Keys: v.optional(v.any()),
    error: v.optional(v.string()),
    workerId: v.optional(v.string()),
    claimedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    confirmedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
  })
    .index("by_session", ["sessionId"])
    .index("by_parent_run", ["parentRunId"])
    .index("by_child_run", ["childRunId"])
    .index("by_org_status", ["orgId", "status"])
    .index("by_status", ["status"]),

  demoRuns: defineTable({
    name: v.string(),
    email: v.string(),
    company: v.optional(v.string()),
    projectName: v.string(),
    verificationToken: v.string(),
    emailVerified: v.boolean(),
    pipelineStatus: v.union(
      v.literal("queued"),
      v.literal("in_progress"),
      v.literal("success"),
      v.literal("partial"),
      v.literal("error"),
      v.literal("expired"),
    ),
    convexProjectId: v.optional(v.id("projects")),
    convexRunId: v.optional(v.id("runs")),
    outputTempDir: v.optional(v.string()),
    outputDeliveryState: v.union(
      v.literal("idle"),
      v.literal("sending"),
      v.literal("sent"),
    ),
    createdAt: v.number(),
    verifiedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    outputSentAt: v.optional(v.number()),
    outputDeletedAt: v.optional(v.number()),
  })
    .index("by_email", ["email"])
    .index("by_token", ["verificationToken"])
    .index("by_status", ["pipelineStatus"]),

  accessRequests: defineTable({
    name: v.string(),
    email: v.string(),
    company: v.string(),
    emailDomain: v.string(),
    initialAdminEmail: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: v.union(
      v.literal("demo_status"),
      v.literal("demo_email"),
      v.literal("pricing"),
      v.literal("auth_no_org"),
      v.literal("marketing"),
    ),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("rejected"),
    ),
    demoRunId: v.optional(v.id("demoRuns")),
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
    reviewedByEmail: v.optional(v.string()),
    reviewNotes: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_domain", ["emailDomain"])
    .index("by_status", ["status"])
    .index("by_created_at", ["createdAt"]),
});
