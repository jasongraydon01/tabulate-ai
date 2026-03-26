import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

const breakdownArg = v.object({
  banner: v.number(),
  crosstab: v.number(),
  structure: v.number(),
  data: v.number(),
  diagnostics: v.number(),
});

const topDiffArg = v.object({
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

export const upsertForRun = internalMutation({
  args: {
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
    breakdown: breakdownArg,
    diffCounts: v.object({
      total: v.number(),
      meaningful: v.number(),
      acceptable: v.number(),
    }),
    topDiffs: v.array(topDiffArg),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const existing = await ctx.db
      .query("runEvaluations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        orgId: args.orgId,
        projectId: args.projectId,
        runId: args.runId,
        datasetKey: args.datasetKey,
        baselineId: args.baselineId,
        baselineVersion: args.baselineVersion,
        score: args.score,
        grade: args.grade,
        divergenceLevel: args.divergenceLevel,
        summary: args.summary,
        breakdown: args.breakdown,
        diffCounts: args.diffCounts,
        topDiffs: args.topDiffs,
        createdAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("runEvaluations", {
      orgId: args.orgId,
      projectId: args.projectId,
      runId: args.runId,
      datasetKey: args.datasetKey,
      ...(args.baselineId ? { baselineId: args.baselineId } : {}),
      ...(args.baselineVersion !== undefined ? { baselineVersion: args.baselineVersion } : {}),
      score: args.score,
      grade: args.grade,
      divergenceLevel: args.divergenceLevel,
      summary: args.summary,
      breakdown: args.breakdown,
      diffCounts: args.diffCounts,
      topDiffs: args.topDiffs,
      createdAt: now,
    });
  },
});

export const getByRun = query({
  args: {
    runId: v.id("runs"),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("runEvaluations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .first();

    if (!row) return null;
    if (args.orgId && row.orgId !== args.orgId) return null;
    return row;
  },
});

export const listByProject = query({
  args: {
    projectId: v.id("projects"),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("runEvaluations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();

    if (args.orgId) {
      rows = rows.filter((r) => r.orgId === args.orgId);
    }

    return rows;
  },
});
