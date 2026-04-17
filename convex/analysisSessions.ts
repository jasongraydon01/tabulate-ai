import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

function compareByLastMessageDesc(
  a: { lastMessageAt: number; _creationTime: number },
  b: { lastMessageAt: number; _creationTime: number },
): number {
  if (b.lastMessageAt !== a.lastMessageAt) {
    return b.lastMessageAt - a.lastMessageAt;
  }
  return b._creationTime - a._creationTime;
}

export const listByRun = query({
  args: {
    orgId: v.id("organizations"),
    runId: v.id("runs"),
  },
  handler: async (ctx, args) => {
    const sessions = await ctx.db
      .query("analysisSessions")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();

    return sessions
      .filter((session) => session.orgId === args.orgId)
      .sort(compareByLastMessageDesc);
  },
});

export const getById = query({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) return null;
    return session;
  },
});

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    projectId: v.id("projects"),
    runId: v.id("runs"),
    createdBy: v.id("users"),
    title: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const [project, run] = await Promise.all([
      ctx.db.get(args.projectId),
      ctx.db.get(args.runId),
    ]);

    if (!project || project.orgId !== args.orgId) {
      throw new Error("Project not found");
    }

    if (!run || run.orgId !== args.orgId || run.projectId !== args.projectId) {
      throw new Error("Run not found");
    }

    const existingSessions = await ctx.db
      .query("analysisSessions")
      .withIndex("by_run", (q) => q.eq("runId", args.runId))
      .collect();
    const sessionCount = existingSessions.filter((session) => session.orgId === args.orgId).length;
    const now = Date.now();
    const trimmedTitle = args.title?.trim();

    return await ctx.db.insert("analysisSessions", {
      orgId: args.orgId,
      projectId: args.projectId,
      runId: args.runId,
      createdBy: args.createdBy,
      title: trimmedTitle && trimmedTitle.length > 0
        ? trimmedTitle
        : `Analysis Session ${sessionCount + 1}`,
      status: "active",
      createdAt: now,
      lastMessageAt: now,
    });
  },
});
