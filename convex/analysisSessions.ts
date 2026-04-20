import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

type AnalysisSessionTitleSource = "default" | "generated" | "manual";

const DEFAULT_ANALYSIS_SESSION_TITLE_RE = /^Analysis Session \d+$/;

function compareByLastMessageDesc(
  a: { lastMessageAt: number; _creationTime: number },
  b: { lastMessageAt: number; _creationTime: number },
): number {
  if (b.lastMessageAt !== a.lastMessageAt) {
    return b.lastMessageAt - a.lastMessageAt;
  }
  return b._creationTime - a._creationTime;
}

function inferSessionTitleSource(session: {
  title: string;
  titleSource?: AnalysisSessionTitleSource;
}): AnalysisSessionTitleSource {
  if (session.titleSource === "default" || session.titleSource === "generated" || session.titleSource === "manual") {
    return session.titleSource;
  }

  return DEFAULT_ANALYSIS_SESSION_TITLE_RE.test(session.title)
    ? "default"
    : "manual";
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
      .sort(compareByLastMessageDesc)
      .map((session) => ({
        ...session,
        titleSource: inferSessionTitleSource(session),
      }));
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
    return {
      ...session,
      titleSource: inferSessionTitleSource(session),
    };
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
      titleSource: trimmedTitle && trimmedTitle.length > 0 ? "manual" : "default",
      status: "active",
      createdAt: now,
      lastMessageAt: now,
    });
  },
});

export const rename = internalMutation({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) {
      throw new Error("Analysis session not found");
    }

    const title = args.title.trim();
    if (!title) {
      throw new Error("Session title is required");
    }

    await ctx.db.patch(args.sessionId, {
      title,
      titleSource: "manual",
    });
  },
});

export const applyGeneratedTitle = internalMutation({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) {
      throw new Error("Analysis session not found");
    }

    const title = args.title.trim();
    if (!title) {
      throw new Error("Session title is required");
    }

    if (inferSessionTitleSource(session) !== "default") {
      return { updated: false };
    }

    await ctx.db.patch(args.sessionId, {
      title,
      titleSource: "generated",
    });

    return { updated: true };
  },
});

export const deleteCascade = internalMutation({
  args: {
    orgId: v.id("organizations"),
    sessionId: v.id("analysisSessions"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.orgId !== args.orgId) {
      throw new Error("Analysis session not found");
    }

    const [messages, artifacts] = await Promise.all([
      ctx.db
        .query("analysisMessages")
        .withIndex("by_session_created", (q) => q.eq("sessionId", args.sessionId))
        .collect(),
      ctx.db
        .query("analysisArtifacts")
        .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
        .collect(),
    ]);

    for (const message of messages) {
      await ctx.db.delete(message._id);
    }

    for (const artifact of artifacts) {
      await ctx.db.delete(artifact._id);
    }

    await ctx.db.delete(args.sessionId);

    return {
      deletedMessages: messages.length,
      deletedArtifacts: artifacts.length,
    };
  },
});
