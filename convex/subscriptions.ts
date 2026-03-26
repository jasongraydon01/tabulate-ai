import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const planValidator = v.union(
  v.literal("payg"),
  v.literal("starter"),
  v.literal("professional"),
  v.literal("studio"),
);

const statusValidator = v.union(
  v.literal("active"),
  v.literal("past_due"),
  v.literal("canceled"),
  v.literal("trialing"),
  v.literal("unpaid"),
);

const notificationKindValidator = v.union(
  v.literal("near_limit"),
  v.literal("overage"),
  v.literal("upgrade_suggestion"),
);

// ---------------------------------------------------------------------------
// Queries (internal — for server-side API routes)
// ---------------------------------------------------------------------------

export const getByOrgInternal = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();
  },
});

export const getByStripeSubscription = internalQuery({
  args: { stripeSubscriptionId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .unique();
  },
});

// ---------------------------------------------------------------------------
// Mutations (all internalMutation — server-only)
// ---------------------------------------------------------------------------

export const upsert = internalMutation({
  args: {
    orgId: v.id("organizations"),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.string(),
    plan: planValidator,
    status: statusValidator,
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
    projectLimit: v.number(),
    overageRate: v.number(),
    cancelAtPeriodEnd: v.boolean(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeCustomerId: args.stripeCustomerId,
        stripeSubscriptionId: args.stripeSubscriptionId,
        plan: args.plan,
        status: args.status,
        currentPeriodStart: args.currentPeriodStart,
        currentPeriodEnd: args.currentPeriodEnd,
        projectLimit: args.projectLimit,
        overageRate: args.overageRate,
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      });
      return existing._id;
    }

    return await ctx.db.insert("subscriptions", {
      orgId: args.orgId,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      plan: args.plan,
      status: args.status,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      projectLimit: args.projectLimit,
      overageRate: args.overageRate,
      projectsUsed: 0,
      cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      billingNotifications: {},
    });
  },
});

export const updateStatus = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    status: statusValidator,
    cancelAtPeriodEnd: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .unique();

    if (!subscription) {
      throw new Error(`Subscription not found: ${args.stripeSubscriptionId}`);
    }

    await ctx.db.patch(subscription._id, {
      status: args.status,
      ...(args.cancelAtPeriodEnd !== undefined && {
        cancelAtPeriodEnd: args.cancelAtPeriodEnd,
      }),
    });
  },
});

export const incrementProjectCount = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();

    if (!subscription) {
      throw new Error("No subscription found for organization");
    }

    await ctx.db.patch(subscription._id, {
      projectsUsed: subscription.projectsUsed + 1,
    });

    return {
      projectsUsed: subscription.projectsUsed + 1,
      projectLimit: subscription.projectLimit,
      isOverage: subscription.projectsUsed + 1 > subscription.projectLimit,
    };
  },
});

export const recordProjectUsage = internalMutation({
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
      const existingSubscription = await ctx.db
        .query("subscriptions")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .unique();

      return {
        counted: false,
        subscription: existingSubscription
          ? {
              plan: existingSubscription.plan,
              projectsUsed: existingSubscription.projectsUsed,
              projectLimit: existingSubscription.projectLimit,
              overageRate: existingSubscription.overageRate,
              stripeCustomerId: existingSubscription.stripeCustomerId,
              billingNotifications: existingSubscription.billingNotifications,
            }
          : null,
      };
    }

    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();

    if (!subscription) {
      throw new Error("No subscription found for organization");
    }

    const nextProjectsUsed = subscription.projectsUsed + 1;

    await ctx.db.patch(args.projectId, { billingCounted: true });
    await ctx.db.patch(subscription._id, {
      projectsUsed: nextProjectsUsed,
    });

    return {
      counted: true,
      subscription: {
        plan: subscription.plan,
        projectsUsed: nextProjectsUsed,
        projectLimit: subscription.projectLimit,
        overageRate: subscription.overageRate,
        stripeCustomerId: subscription.stripeCustomerId,
        billingNotifications: subscription.billingNotifications,
      },
    };
  },
});

export const reserveBillingNotification = internalMutation({
  args: {
    orgId: v.id("organizations"),
    kind: notificationKindValidator,
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .unique();

    if (!subscription) {
      throw new Error("No subscription found for organization");
    }

    const billingNotifications = subscription.billingNotifications ?? {};
    const field =
      args.kind === "near_limit"
        ? "nearLimitSentAt"
        : args.kind === "overage"
          ? "overageSentAt"
          : "upgradeSuggestionSentAt";

    if (billingNotifications[field]) {
      return false;
    }

    await ctx.db.patch(subscription._id, {
      billingNotifications: {
        ...billingNotifications,
        [field]: Date.now(),
      },
    });

    return true;
  },
});

export const resetPeriod = internalMutation({
  args: {
    stripeSubscriptionId: v.string(),
    currentPeriodStart: v.number(),
    currentPeriodEnd: v.number(),
  },
  handler: async (ctx, args) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("by_stripe_subscription", (q) =>
        q.eq("stripeSubscriptionId", args.stripeSubscriptionId)
      )
      .unique();

    if (!subscription) {
      throw new Error(`Subscription not found: ${args.stripeSubscriptionId}`);
    }

    await ctx.db.patch(subscription._id, {
      projectsUsed: 0,
      currentPeriodStart: args.currentPeriodStart,
      currentPeriodEnd: args.currentPeriodEnd,
      billingNotifications: {},
    });
  },
});
