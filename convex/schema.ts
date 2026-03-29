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
