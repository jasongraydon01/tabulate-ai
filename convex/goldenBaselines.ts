import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

const artifactKeysArg = v.object({
  banner: v.string(),
  crosstab: v.string(),
  verification: v.string(),
  data: v.string(),
  manifest: v.optional(v.string()),
});

export const getActiveForDataset = query({
  args: {
    orgId: v.id("organizations"),
    datasetKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.datasetKeys.length === 0) return null;

    const matches = [];

    for (const datasetKey of args.datasetKeys) {
      const candidates = await ctx.db
        .query("goldenBaselines")
        .withIndex("by_org_dataset_status", (q) =>
          q.eq("orgId", args.orgId).eq("datasetKey", datasetKey).eq("status", "active")
        )
        .collect();

      matches.push(...candidates);
    }

    if (matches.length === 0) return null;
    matches.sort((a, b) => b.version - a.version);
    return matches[0];
  },
});

export const listByOrg = query({
  args: {
    orgId: v.id("organizations"),
    datasetKey: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    let rows = await ctx.db
      .query("goldenBaselines")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .collect();

    if (args.datasetKey) {
      rows = rows.filter((r) => r.datasetKey === args.datasetKey);
    }

    return rows;
  },
});

export const getNextVersion = query({
  args: {
    orgId: v.id("organizations"),
    datasetKey: v.string(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("goldenBaselines")
      .withIndex("by_org_dataset", (q) => q.eq("orgId", args.orgId).eq("datasetKey", args.datasetKey))
      .collect();

    const maxVersion = rows.reduce((max, row) => Math.max(max, row.version), 0);
    return maxVersion + 1;
  },
});

export const register = internalMutation({
  args: {
    orgId: v.id("organizations"),
    projectId: v.optional(v.id("projects")),
    sourceRunId: v.id("runs"),
    datasetKey: v.string(),
    artifactKeys: artifactKeysArg,
    version: v.number(),
    status: v.union(v.literal("draft"), v.literal("active")),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const now = Date.now();

    if (args.status === "active") {
      const activeRows = await ctx.db
        .query("goldenBaselines")
        .withIndex("by_org_dataset_status", (q) =>
          q.eq("orgId", args.orgId).eq("datasetKey", args.datasetKey).eq("status", "active")
        )
        .collect();

      for (const row of activeRows) {
        await ctx.db.patch(row._id, {
          status: "superseded",
          supersededAt: now,
        });
      }
    }

    const id = await ctx.db.insert("goldenBaselines", {
      orgId: args.orgId,
      ...(args.projectId ? { projectId: args.projectId } : {}),
      sourceRunId: args.sourceRunId,
      datasetKey: args.datasetKey,
      artifactKeys: args.artifactKeys,
      version: args.version,
      status: args.status,
      ...(args.notes ? { notes: args.notes } : {}),
      createdBy: args.createdBy,
      createdAt: now,
      ...(args.status === "active" ? { activatedAt: now } : {}),
    });

    return id;
  },
});
