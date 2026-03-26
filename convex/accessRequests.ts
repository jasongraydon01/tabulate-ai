import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const sourceValidator = v.union(
  v.literal("demo_status"),
  v.literal("demo_email"),
  v.literal("pricing"),
  v.literal("auth_no_org"),
  v.literal("marketing"),
);

const statusValidator = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("rejected"),
);

export const getPendingByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    const requests = await ctx.db
      .query("accessRequests")
      .withIndex("by_email", (q) => q.eq("email", args.email))
      .collect();

    return requests.find((request) => request.status === "pending") ?? null;
  },
});

export const getById = internalQuery({
  args: { accessRequestId: v.id("accessRequests") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.accessRequestId);
  },
});

export const listAll = internalQuery({
  args: {},
  handler: async (ctx) => {
    const requests = await ctx.db.query("accessRequests").collect();

    return requests.sort((a, b) => {
      if (a.status !== b.status) {
        if (a.status === "pending") return -1;
        if (b.status === "pending") return 1;
      }

      return b.createdAt - a.createdAt;
    });
  },
});

export const create = internalMutation({
  args: {
    name: v.string(),
    email: v.string(),
    company: v.string(),
    emailDomain: v.string(),
    initialAdminEmail: v.optional(v.string()),
    notes: v.optional(v.string()),
    source: sourceValidator,
    demoRunId: v.optional(v.id("demoRuns")),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("accessRequests", {
      name: args.name,
      email: args.email,
      company: args.company,
      emailDomain: args.emailDomain,
      initialAdminEmail: args.initialAdminEmail,
      notes: args.notes,
      source: args.source,
      status: "pending",
      demoRunId: args.demoRunId,
      createdAt: Date.now(),
    });
  },
});

export const updateReviewStatus = internalMutation({
  args: {
    accessRequestId: v.id("accessRequests"),
    status: statusValidator,
    reviewedByEmail: v.string(),
    reviewNotes: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.accessRequestId);
    if (!request) {
      throw new Error("Access request not found");
    }

    await ctx.db.patch(args.accessRequestId, {
      status: args.status,
      reviewedAt: Date.now(),
      reviewedByEmail: args.reviewedByEmail,
      reviewNotes: args.reviewNotes,
    });
  },
});
