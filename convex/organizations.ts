import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

export const getByWorkosId = internalQuery({
  args: { workosOrgId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("organizations")
      .withIndex("by_workos_org_id", (q) => q.eq("workosOrgId", args.workosOrgId))
      .unique();
  },
});

export const get = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.orgId);
  },
});

export const getByStripeCustomerId = internalQuery({
  args: { stripeCustomerId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("organizations")
      .withIndex("by_stripe_customer", (q) => q.eq("stripeCustomerId", args.stripeCustomerId))
      .unique();
  },
});

export const setStripeCustomerId = internalMutation({
  args: {
    orgId: v.id("organizations"),
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, args) => {
    const org = await ctx.db.get(args.orgId);
    if (!org) {
      throw new Error("Organization not found");
    }
    await ctx.db.patch(args.orgId, { stripeCustomerId: args.stripeCustomerId });
  },
});

export const upsert = internalMutation({
  args: {
    workosOrgId: v.string(),
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_workos_org_id", (q) => q.eq("workosOrgId", args.workosOrgId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, { name: args.name, slug: args.slug });
      return existing._id;
    }

    return await ctx.db.insert("organizations", {
      workosOrgId: args.workosOrgId,
      name: args.name,
      slug: args.slug,
    });
  },
});
