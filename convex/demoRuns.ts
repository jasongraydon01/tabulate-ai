import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

const pipelineStatusValidator = v.union(
  v.literal("queued"),
  v.literal("in_progress"),
  v.literal("success"),
  v.literal("partial"),
  v.literal("error"),
  v.literal("expired"),
);

// ---------------------------------------------------------------------------
// Queries (public — for client-side status polling)
// ---------------------------------------------------------------------------

/**
 * Public query for the demo status page to poll pipeline progress.
 * Returns only non-sensitive fields — no email, no file paths.
 */
export const getStatusByToken = query({
  args: { verificationToken: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("demoRuns")
      .withIndex("by_token", (q) => q.eq("verificationToken", args.verificationToken))
      .unique();

    if (!run) return null;

    return {
      projectName: run.projectName,
      pipelineStatus: run.pipelineStatus,
      emailVerified: run.emailVerified,
      outputSentAt: run.outputSentAt,
      createdAt: run.createdAt,
    };
  },
});

// ---------------------------------------------------------------------------
// Queries (internal — for server-side API routes)
// ---------------------------------------------------------------------------

export const getByToken = internalQuery({
  args: { verificationToken: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("demoRuns")
      .withIndex("by_token", (q) => q.eq("verificationToken", args.verificationToken))
      .unique();
  },
});

export const getByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("demoRuns")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();
  },
});

export const getByRunId = internalQuery({
  args: { convexRunId: v.id("runs") },
  handler: async (ctx, args) => {
    // No index — demo runs are low volume, full scan is fine
    const all = await ctx.db.query("demoRuns").collect();
    return all.find(r => r.convexRunId === args.convexRunId) ?? null;
  },
});

export const getById = internalQuery({
  args: { demoRunId: v.id("demoRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.demoRunId);
  },
});

export const listAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("demoRuns").collect();
  },
});

export const countTotal = internalQuery({
  args: {},
  handler: async (ctx) => {
    const all = await ctx.db.query("demoRuns").collect();
    return all.length;
  },
});

// ---------------------------------------------------------------------------
// Mutations (all internalMutation — server-only)
// ---------------------------------------------------------------------------

export const create = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    company: v.optional(v.string()),
    projectName: v.string(),
    verificationToken: v.string(),
    convexProjectId: v.optional(v.id("projects")),
    convexRunId: v.optional(v.id("runs")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("demoRuns", {
      name: args.name,
      email: args.email,
      company: args.company,
      projectName: args.projectName,
      verificationToken: args.verificationToken,
      emailVerified: false,
      pipelineStatus: "queued",
      convexProjectId: args.convexProjectId,
      convexRunId: args.convexRunId,
      outputDeliveryState: "idle",
      createdAt: Date.now(),
    });
  },
});

export const markVerified = internalMutation({
  args: { verificationToken: v.string() },
  handler: async (ctx, args) => {
    const run = await ctx.db
      .query("demoRuns")
      .withIndex("by_token", (q) => q.eq("verificationToken", args.verificationToken))
      .unique();

    if (!run) throw new Error("Demo run not found");
    if (run.emailVerified) return run; // Already verified — idempotent

    await ctx.db.patch(run._id, {
      emailVerified: true,
      verifiedAt: Date.now(),
    });

    return { ...run, emailVerified: true, verifiedAt: Date.now() };
  },
});

export const updatePipelineStatus = internalMutation({
  args: {
    demoRunId: v.id("demoRuns"),
    pipelineStatus: pipelineStatusValidator,
    outputTempDir: v.optional(v.string()),
    completedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      pipelineStatus: args.pipelineStatus,
    };
    if (args.outputTempDir !== undefined) {
      patch.outputTempDir = args.outputTempDir;
    }
    if (args.completedAt !== undefined) {
      patch.completedAt = args.completedAt;
    }
    await ctx.db.patch(args.demoRunId, patch);
  },
});

export const markOutputSent = internalMutation({
  args: {
    demoRunId: v.id("demoRuns"),
    outputDeletedAt: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = {
      outputSentAt: Date.now(),
      outputDeliveryState: "sent",
    };
    if (args.outputDeletedAt !== undefined) {
      patch.outputDeletedAt = args.outputDeletedAt;
    }
    await ctx.db.patch(args.demoRunId, patch);
  },
});

export const claimOutputDelivery = internalMutation({
  args: { demoRunId: v.id("demoRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.demoRunId);
    if (!run) return { claimed: false };
    if (run.outputSentAt || run.outputDeliveryState === "sending" || run.outputDeliveryState === "sent") {
      return { claimed: false };
    }
    await ctx.db.patch(args.demoRunId, {
      outputDeliveryState: "sending",
    });
    return { claimed: true };
  },
});

export const releaseOutputDelivery = internalMutation({
  args: { demoRunId: v.id("demoRuns") },
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.demoRunId);
    if (!run || run.outputDeliveryState !== "sending" || run.outputSentAt) {
      return;
    }
    await ctx.db.patch(args.demoRunId, {
      outputDeliveryState: "idle",
    });
  },
});

export const markExpired = internalMutation({
  args: { demoRunId: v.id("demoRuns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.demoRunId, {
      pipelineStatus: "expired",
    });
  },
});
