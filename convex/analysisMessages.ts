import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

const groundingRefValidator = v.object({
  claimId: v.string(),
  claimType: v.union(v.literal("numeric"), v.literal("context")),
  evidenceKind: v.union(v.literal("table_card"), v.literal("context")),
  refType: v.string(),
  refId: v.string(),
  label: v.string(),
  anchorId: v.optional(v.string()),
  artifactId: v.optional(v.id("analysisArtifacts")),
  sourceTableId: v.optional(v.string()),
  sourceQuestionId: v.optional(v.string()),
  renderedInCurrentMessage: v.optional(v.boolean()),
});

const agentMetricsValidator = v.object({
  model: v.string(),
  inputTokens: v.number(),
  outputTokens: v.number(),
  durationMs: v.number(),
});

const messagePartValidator = v.object({
  type: v.string(),
  text: v.optional(v.string()),
  state: v.optional(v.string()),
  artifactId: v.optional(v.id("analysisArtifacts")),
  label: v.optional(v.string()),
  toolCallId: v.optional(v.string()),
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
