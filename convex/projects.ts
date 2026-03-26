import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import { configValidator, intakeValidator } from "./projectConfigValidators";

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    projectType: v.union(v.literal("crosstab"), v.literal("other")),
    config: configValidator,
    intake: intakeValidator,
    fileKeys: v.array(v.string()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    // Belt-and-suspenders: reject duplicate project names within the same org
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();
    const nameTaken = existing.some(
      (p) => p.name.toLowerCase() === args.name.toLowerCase(),
    );
    if (nameTaken) {
      throw new Error(`A project named "${args.name}" already exists in this organization`);
    }

    return await ctx.db.insert("projects", {
      orgId: args.orgId,
      name: args.name,
      projectType: args.projectType,
      config: args.config,
      intake: args.intake,
      fileKeys: args.fileKeys,
      createdBy: args.createdBy,
    });
  },
});

export const get = query({
  args: {
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return null;
    // Org-scoping: always reject cross-org access
    if (project.orgId !== args.orgId) return null;
    return project;
  },
});

/**
 * @deprecated Input files are no longer uploaded to R2.
 * This mutation is kept for backward compatibility only.
 * As of Phase 1 cleanup, fileKeys will remain empty for new projects.
 */
export const updateFileKeys = internalMutation({
  args: {
    projectId: v.id("projects"),
    fileKeys: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.projectId, { fileKeys: args.fileKeys });
  },
});

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const projects = await ctx.db
      .query("projects")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .order("desc")
      .collect();
    return projects;
  },
});

/**
 * Hard delete a project
 * Called after all runs and R2 files have been deleted
 */
export const hardDelete = internalMutation({
  args: {
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== args.orgId) {
      throw new Error("Project not found in organization");
    }
    await ctx.db.delete(args.projectId);
  },
});

/**
 * Atomically mark a project as billing-counted on first successful run.
 * Returns true if this was the first count (caller should fire meter event),
 * false if already counted (no-op — re-runs are free).
 */
export const markBillingCounted = internalMutation({
  args: {
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== args.orgId) {
      throw new Error("Project not found in organization");
    }
    if (project.billingCounted) {
      return false; // Already counted — re-run or additional banner
    }
    await ctx.db.patch(args.projectId, { billingCounted: true });
    return true; // First successful run — count for billing
  },
});

export const updateConfig = internalMutation({
  args: {
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
    config: configValidator,
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== args.orgId) {
      throw new Error("Project not found in organization");
    }
    await ctx.db.patch(args.projectId, { config: args.config });
  },
});

/**
 * @deprecated Use hardDelete instead. Kept for backward compatibility.
 */
export const softDelete = internalMutation({
  args: {
    projectId: v.id("projects"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    // Redirect to hard delete
    const project = await ctx.db.get(args.projectId);
    if (!project || project.orgId !== args.orgId) {
      throw new Error("Project not found in organization");
    }
    await ctx.db.delete(args.projectId);
  },
});
