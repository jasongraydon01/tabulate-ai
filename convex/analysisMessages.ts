import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

const groundingRefValidator = v.object({
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

const agentMetricsValidator = v.object({
  model: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  nonCachedInputTokens: v.optional(v.number()),
  cachedInputTokens: v.optional(v.number()),
  cacheWriteInputTokens: v.optional(v.number()),
  durationMs: v.number(),
  estimatedCostUsd: v.optional(v.number()),
});

const messagePartValidator = v.object({
  type: v.string(),
  text: v.optional(v.string()),
  state: v.optional(v.string()),
  artifactId: v.optional(v.id("analysisArtifacts")),
  label: v.optional(v.string()),
  toolCallId: v.optional(v.string()),
  input: v.optional(v.any()),
  output: v.optional(v.any()),
  // Inline cell summary for tool-confirmCitation parts. Kept loose
  // (`v.any`) to mirror how other polymorphic tool payloads stay additive
  // here — the TypeScript surface in @/lib/analysis/types enforces shape.
  cellSummary: v.optional(v.any()),
});

export const listBySession = query({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) return [];

    return await ctx.db
      .query("analysisMessages")
      .withIndex("by_session_created", (q) => q.eq("sessionId", args.sessionId))
      .collect();
  },
});

export const getById = query({
  args: {
    orgId: v.id("organizations"),
    messageId: v.id("analysisMessages"),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.messageId);
    if (!message || message.orgId !== args.orgId) return null;
    return message;
  },
});

/**
 * Delete the target message and every message after it in the session,
 * along with the feedback records attached to those messages and any
 * artifacts created at or after the target's timestamp.
 *
 * Used by the edit-user-message flow: truncate forward from the edited
 * message, then the client resends the edited text as a fresh turn.
 *
 * Idempotent: if the target message is already gone, returns zeros.
 */
export const truncateFromMessage = internalMutation({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
    messageId: v.id("analysisMessages"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) {
      throw new Error("Analysis session not found");
    }

    const target = await ctx.db.get(args.messageId);
    if (!target || target.sessionId !== args.sessionId || target.orgId !== args.orgId) {
      return {
        deletedMessages: 0,
        deletedFeedback: 0,
        deletedArtifacts: 0,
      };
    }

    const messagesToDelete = await ctx.db
      .query("analysisMessages")
      .withIndex("by_session_created", (q) =>
        q.eq("sessionId", args.sessionId).gte("createdAt", target.createdAt),
      )
      .collect();

    const messageIdsToDelete = new Set(messagesToDelete.map((message) => message._id));

    const sessionFeedback = await ctx.db
      .query("analysisMessageFeedback")
      .withIndex("by_session_user", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const feedbackToDelete = sessionFeedback.filter((entry) =>
      messageIdsToDelete.has(entry.messageId),
    );

    const sessionArtifacts = await ctx.db
      .query("analysisArtifacts")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    const artifactsToDelete = sessionArtifacts.filter(
      (artifact) => artifact.createdAt >= target.createdAt,
    );

    for (const message of messagesToDelete) {
      await ctx.db.delete(message._id);
    }
    for (const entry of feedbackToDelete) {
      await ctx.db.delete(entry._id);
    }
    for (const artifact of artifactsToDelete) {
      await ctx.db.delete(artifact._id);
    }

    const remainingMessages = await ctx.db
      .query("analysisMessages")
      .withIndex("by_session_created", (q) => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    const newLastMessageAt = remainingMessages[0]?.createdAt ?? session.createdAt;
    await ctx.db.patch(args.sessionId, {
      lastMessageAt: newLastMessageAt,
    });

    return {
      deletedMessages: messagesToDelete.length,
      deletedFeedback: feedbackToDelete.length,
      deletedArtifacts: artifactsToDelete.length,
    };
  },
});

export const create = internalMutation({
  args: {
    sessionId: v.id("analysisSessions"),
    orgId: v.id("organizations"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    content: v.string(),
    parts: v.optional(v.array(messagePartValidator)),
    groundingRefs: v.optional(v.array(groundingRefValidator)),
    followUpSuggestions: v.optional(v.array(v.string())),
    agentMetrics: v.optional(agentMetricsValidator),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) {
      throw new Error("Analysis session not found");
    }

    const createdAt = Date.now();
    const messageId = await ctx.db.insert("analysisMessages", {
      sessionId: args.sessionId,
      orgId: args.orgId,
      role: args.role,
      content: args.content,
      createdAt,
      ...(args.parts ? { parts: args.parts } : {}),
      ...(args.groundingRefs ? { groundingRefs: args.groundingRefs } : {}),
      ...(args.followUpSuggestions ? { followUpSuggestions: args.followUpSuggestions } : {}),
      ...(args.agentMetrics ? { agentMetrics: args.agentMetrics } : {}),
    });

    await ctx.db.patch(args.sessionId, {
      lastMessageAt: createdAt,
    });

    return messageId;
  },
});
