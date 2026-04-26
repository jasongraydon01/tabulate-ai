import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

export const listBySession = query({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) return [];

    return await ctx.db
      .query("analysisArtifacts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

export const listByRun = query({
  args: {
    orgId: v.id("organizations"),
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const artifacts = await ctx.db
      .query("analysisArtifacts")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();

    return artifacts.filter((artifact) => artifact.orgId === args.orgId);
  },
});

export const create = internalMutation({
  args: {
    sessionId: v.id("analysisSessions"),
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    artifactType: v.union(
      v.literal("table_card"),
      v.literal("note"),
    ),
    sourceClass: v.union(
      v.literal("from_tabs"),
      v.literal("assistant_synthesis"),
      v.literal("computed_derivation"),
    ),
    title: v.string(),
    sourceTableIds: v.array(v.string()),
    sourceQuestionIds: v.array(v.string()),
    lineage: v.optional(v.object({
      sourceRunId: v.id("runs"),
      sourceTableIds: v.array(v.string()),
      analysisComputeJobId: v.optional(v.id("analysisComputeJobs")),
      derivationType: v.optional(v.string()),
    })),
    payload: v.any(),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const [session, project, run] = await Promise.all([
      ctx.db.get(args.sessionId),
      ctx.db.get(args.projectId),
      ctx.db.get(args.runId),
    ]);

    if (!session || session.orgId !== args.orgId) {
      throw new Error("Analysis session not found");
    }

    if (!project || project.orgId !== args.orgId) {
      throw new Error("Project not found");
    }

    if (!run || run.orgId !== args.orgId || run.projectId !== args.projectId) {
      throw new Error("Run not found");
    }

    if (session.projectId !== args.projectId || session.runId !== args.runId) {
      throw new Error("Analysis session scope mismatch");
    }

    return await ctx.db.insert("analysisArtifacts", {
      sessionId: args.sessionId,
      orgId: args.orgId,
      projectId: args.projectId,
      runId: args.runId,
      artifactType: args.artifactType,
      sourceClass: args.sourceClass,
      title: args.title,
      sourceTableIds: args.sourceTableIds,
      sourceQuestionIds: args.sourceQuestionIds,
      ...(args.lineage ? { lineage: args.lineage } : {}),
      payload: args.payload,
      createdBy: args.createdBy,
      createdAt: Date.now(),
    });
  },
});

export const getByAnalysisComputeJob = internalQuery({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
    jobId: v.id("analysisComputeJobs"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) return null;

    const artifacts = await ctx.db
      .query("analysisArtifacts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();

    return artifacts.find((artifact) =>
      artifact.orgId === args.orgId
      && artifact.sourceClass === "computed_derivation"
      && artifact.lineage?.analysisComputeJobId === args.jobId
    ) ?? null;
  },
});
