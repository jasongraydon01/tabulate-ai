import { v } from "convex/values";

import { internalMutation, query } from "./_generated/server";

export const listBySessionForUser = query({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) return [];

    return await ctx.db
      .query("analysisMessageFeedback")
      .withIndex("by_session_user", (q) => q.eq("sessionId", args.sessionId).eq("userId", args.userId))
      .collect();
  },
});

export const upsert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    sessionId: v.id("analysisSessions"),
    messageId: v.id("analysisMessages"),
    userId: v.id("users"),
    vote: v.union(v.literal("up"), v.literal("down")),
    correctionText: v.union(v.string(), v.null()),
  },
  handler: async (ctx, args) => {
    const [session, message] = await Promise.all([
      ctx.db.get(args.sessionId),
      ctx.db.get(args.messageId),
    ]);

    if (
      !session
      || session.orgId !== args.orgId
      || session.projectId !== args.projectId
      || session.runId !== args.runId
    ) {
      throw new Error("Analysis session not found");
    }

    if (
      !message
      || message.orgId !== args.orgId
      || message.sessionId !== args.sessionId
      || message.role !== "assistant"
    ) {
      throw new Error("Analysis message not found");
    }

    const now = Date.now();
    const existing = await ctx.db
      .query("analysisMessageFeedback")
      .withIndex("by_message_user", (q) => q.eq("messageId", args.messageId).eq("userId", args.userId))
      .unique();

    const correctionText = args.correctionText?.trim() || null;

    if (existing) {
      await ctx.db.patch(existing._id, {
        vote: args.vote,
        correctionText,
        updatedAt: now,
      });

      return existing._id;
    }

    return await ctx.db.insert("analysisMessageFeedback", {
      orgId: args.orgId,
      projectId: args.projectId,
      runId: args.runId,
      sessionId: args.sessionId,
      messageId: args.messageId,
      userId: args.userId,
      vote: args.vote,
      correctionText,
      createdAt: now,
      updatedAt: now,
    });
  },
});
