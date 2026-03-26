import { v } from "convex/values";
import { query, internalMutation, internalQuery } from "./_generated/server";

export const getByUserAndOrg = internalQuery({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user_and_org", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId)
      )
      .unique();

    // Filter out removed memberships
    if (membership?.removedAt) return null;
    return membership;
  },
});

export const listByOrg = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    // Filter out removed memberships, then join with users
    const results = await Promise.all(
      memberships
        .filter((m) => !m.removedAt)
        .map(async (m) => {
          const user = await ctx.db.get(m.userId);
          return {
            _id: m._id,
            role: m.role,
            userId: m.userId,
            name: user?.name ?? "Unknown",
            email: user?.email ?? "",
          };
        })
    );

    return results;
  },
});

export const listBillingContacts = internalQuery({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, args) => {
    const memberships = await ctx.db
      .query("orgMemberships")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    const contacts = await Promise.all(
      memberships
        .filter((m) => m.role === "admin" && !m.removedAt)
        .map(async (membership) => {
          const user = await ctx.db.get(membership.userId);
          if (!user?.email) return null;
          return {
            userId: membership.userId,
            email: user.email,
            name: user.name,
            notificationPreferences: user.notificationPreferences,
          };
        })
    );

    return contacts.filter((contact): contact is NonNullable<typeof contact> => Boolean(contact));
  },
});

/**
 * Remove a member from the organization (soft-delete).
 * All safety guards run inside this mutation for atomicity (no TOCTOU races).
 */
export const remove = internalMutation({
  args: {
    membershipId: v.id("orgMemberships"),
    orgId: v.id("organizations"),
    actorUserId: v.id("users"),
  },
  handler: async (ctx, args) => {
    const membership = await ctx.db.get(args.membershipId);

    // Verify membership exists and belongs to the specified org
    if (!membership || membership.orgId !== args.orgId) {
      throw new Error("Membership not found in organization");
    }

    // Already removed
    if (membership.removedAt) {
      throw new Error("Member has already been removed");
    }

    // Guard: cannot remove self
    if (membership.userId === args.actorUserId) {
      throw new Error("Cannot remove yourself from the organization");
    }

    // Guard: cannot remove last admin (atomic — no race condition)
    if (membership.role === "admin") {
      const allMembers = await ctx.db
        .query("orgMemberships")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect();
      const activeAdmins = allMembers.filter(
        (m) => m.role === "admin" && !m.removedAt
      );
      if (activeAdmins.length <= 1) {
        throw new Error(
          "Cannot remove the last admin. Promote another member first."
        );
      }
    }

    // Soft-delete
    await ctx.db.patch(args.membershipId, { removedAt: Date.now() });
  },
});

export const upsert = internalMutation({
  args: {
    userId: v.id("users"),
    orgId: v.id("organizations"),
    role: v.optional(
      v.union(
        v.literal("admin"),
        v.literal("member"),
        v.literal("external_partner")
      )
    ),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("orgMemberships")
      .withIndex("by_user_and_org", (q) =>
        q.eq("userId", args.userId).eq("orgId", args.orgId)
      )
      .unique();

    if (existing) {
      // If this membership was removed by an admin, do NOT re-create it.
      // The user must be explicitly re-invited.
      if (existing.removedAt) {
        return existing._id;
      }

      // Don't overwrite role on subsequent logins — only update if explicitly provided
      if (args.role) {
        await ctx.db.patch(existing._id, { role: args.role });
      }
      return existing._id;
    }

    // New membership: use provided role or default to "member"
    return await ctx.db.insert("orgMemberships", {
      userId: args.userId,
      orgId: args.orgId,
      role: args.role ?? "member",
    });
  },
});
