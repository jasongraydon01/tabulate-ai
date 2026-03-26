/**
 * @deprecated Legacy Review Tables storage retained only for historical reads and reference.
 * Phase 6 removes all production writes to this table.
 */
import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

/**
 * Create a new table regeneration record.
 * Called when a user queues a table for regeneration with feedback.
 */
export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    tableId: v.string(),
    requestedBy: v.string(),
    feedback: v.string(),
    beforeSnapshot: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Runtime guard on beforeSnapshot
    if (args.beforeSnapshot !== undefined) {
      if (typeof args.beforeSnapshot !== 'object' || args.beforeSnapshot === null || Array.isArray(args.beforeSnapshot)) {
        throw new Error("beforeSnapshot must be a non-null, non-array object");
      }
    }

    return await ctx.db.insert("tableRegenerations", {
      orgId: args.orgId,
      projectId: args.projectId,
      runId: args.runId,
      tableId: args.tableId,
      requestedBy: args.requestedBy,
      feedback: args.feedback,
      status: "pending",
      startedAt: Date.now(),
      beforeSnapshot: args.beforeSnapshot,
    });
  },
});

/**
 * Update the status of a table regeneration record.
 * Called during and after regeneration to track progress.
 */
export const updateStatus = internalMutation({
  args: {
    id: v.id("tableRegenerations"),
    status: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("success"),
      v.literal("failed")
    ),
    completedAt: v.optional(v.number()),
    changeSummary: v.optional(v.string()),
    error: v.optional(v.string()),
    afterSnapshot: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    // Runtime guard on afterSnapshot
    if (args.afterSnapshot !== undefined) {
      if (typeof args.afterSnapshot !== 'object' || args.afterSnapshot === null || Array.isArray(args.afterSnapshot)) {
        throw new Error("afterSnapshot must be a non-null, non-array object");
      }
    }

    const { id, ...fields } = args;
    await ctx.db.patch(id, fields);
  },
});

/**
 * List all regeneration records for a run.
 * Public query for real-time UI subscription via useQuery.
 */
export const listByRun = query({
  args: {
    runId: v.id("runs"),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("tableRegenerations")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .order("desc")
      .collect();

    // Org-scoping: filter out cross-org records
    if (args.orgId) {
      return records.filter((r) => r.orgId === args.orgId);
    }
    return records;
  },
});

/**
 * List regeneration records for a specific table within a run.
 * Public query for revision history UI.
 */
export const listByRunAndTable = query({
  args: {
    runId: v.id("runs"),
    tableId: v.string(),
    orgId: v.optional(v.id("organizations")),
  },
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("tableRegenerations")
      .withIndex("by_run_table", (q) =>
        q.eq("runId", args.runId).eq("tableId", args.tableId)
      )
      .order("desc")
      .collect();

    // Org-scoping
    if (args.orgId) {
      return records.filter((r) => r.orgId === args.orgId);
    }
    return records;
  },
});
