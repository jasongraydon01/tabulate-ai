import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

export const getByWorkosId = internalQuery({
  args: { workosUserId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", args.workosUserId))
      .unique();
  },
});

export const get = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.userId);
  },
});

export const updateNotificationPreferences = internalMutation({
  args: {
    userId: v.id("users"),
    notificationPreferences: v.object({
      pipelineEmails: v.boolean(),
    }),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.userId, {
      notificationPreferences: args.notificationPreferences,
    });
  },
});

export const upsert = internalMutation({
  args: {
    workosUserId: v.string(),
    email: v.string(),
    name: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_workos_user_id", (q) => q.eq("workosUserId", args.workosUserId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { email: args.email, name: args.name });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      workosUserId: args.workosUserId,
      email: args.email,
      name: args.name,
    });
  },
});
