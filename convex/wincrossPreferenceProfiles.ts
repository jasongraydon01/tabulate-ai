import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  WinCrossParseDiagnosticsSchema,
  WinCrossPreferenceProfileSchema,
} from "../src/lib/exportData/types";
import {
  normalizeWinCrossParseDiagnostics,
  normalizeWinCrossPreferenceProfile,
} from "../src/lib/exportData/wincross/profileNormalization";

export const listByOrg = query({
  args: {
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const profiles = await ctx.db
      .query("wincrossPreferenceProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    return profiles
      .sort((a, b) => {
        if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
        return b.updatedAt - a.updatedAt;
      })
      .map((profile) => {
        const normalizedProfile = normalizeWinCrossPreferenceProfile(profile.profile).profile;
        const diagnostics = normalizeWinCrossParseDiagnostics(profile.diagnostics);
        return {
          _id: profile._id,
          _creationTime: profile._creationTime,
          orgId: profile.orgId,
          name: profile.name,
          description: profile.description,
          isDefault: profile.isDefault,
          sourceFileName: profile.sourceFileName,
          createdBy: profile.createdBy,
          createdAt: profile.createdAt,
          updatedAt: profile.updatedAt,
          profileSummary: {
            version: normalizedProfile.version,
            tablePatternHints: normalizedProfile.tablePatternHints,
            titleLineCount: normalizedProfile.titleLines.length,
            sigFooterLineCount: normalizedProfile.sigFooterLines.length,
          },
          diagnostics,
        };
      });
  },
});

export const getById = query({
  args: {
    orgId: v.id("organizations"),
    profileId: v.id("wincrossPreferenceProfiles"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.orgId !== args.orgId) return null;
    return {
      ...profile,
      profile: normalizeWinCrossPreferenceProfile(profile.profile).profile,
      diagnostics: normalizeWinCrossParseDiagnostics(profile.diagnostics),
    };
  },
});

export const getDefaultByOrg = query({
  args: {
    orgId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db
      .query("wincrossPreferenceProfiles")
      .withIndex("by_org_default", (q) => q.eq("orgId", args.orgId).eq("isDefault", true))
      .first();

    if (!profile) return null;

    return {
      ...profile,
      profile: normalizeWinCrossPreferenceProfile(profile.profile).profile,
      diagnostics: normalizeWinCrossParseDiagnostics(profile.diagnostics),
    };
  },
});

export const create = internalMutation({
  args: {
    orgId: v.id("organizations"),
    name: v.string(),
    description: v.optional(v.string()),
    profile: v.any(),
    diagnostics: v.optional(v.any()),
    sourceFileName: v.optional(v.string()),
    sourceFileHash: v.optional(v.string()),
    isDefault: v.optional(v.boolean()),
    createdBy: v.id("users"),
  },
  handler: async (ctx, args) => {
    const profile = WinCrossPreferenceProfileSchema.parse(args.profile);
    const diagnostics = args.diagnostics
      ? WinCrossParseDiagnosticsSchema.parse(args.diagnostics)
      : undefined;

    const existing = await ctx.db
      .query("wincrossPreferenceProfiles")
      .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
      .collect();

    if (existing.length >= 10) {
      throw new Error("Organizations can store at most 10 WinCross profiles.");
    }

    const normalizedName = args.name.trim().toLowerCase();
    if (!normalizedName) {
      throw new Error("Profile name is required.");
    }
    if (existing.some((entry) => entry.name.trim().toLowerCase() === normalizedName)) {
      throw new Error(`A WinCross profile named "${args.name}" already exists in this organization.`);
    }

    const now = Date.now();
    const shouldBeDefault = args.isDefault === true || existing.length === 0;
    if (shouldBeDefault) {
      await clearDefaultFlags(ctx, args.orgId);
    }

    return await ctx.db.insert("wincrossPreferenceProfiles", {
      orgId: args.orgId,
      name: args.name.trim(),
      description: args.description?.trim() || undefined,
      profile,
      diagnostics,
      sourceFileName: args.sourceFileName,
      sourceFileHash: args.sourceFileHash,
      isDefault: shouldBeDefault,
      createdBy: args.createdBy,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const remove = internalMutation({
  args: {
    orgId: v.id("organizations"),
    profileId: v.id("wincrossPreferenceProfiles"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.orgId !== args.orgId) {
      throw new Error("Profile not found in organization.");
    }

    const wasDefault = profile.isDefault;
    await ctx.db.delete(args.profileId);

    if (wasDefault) {
      const remaining = await ctx.db
        .query("wincrossPreferenceProfiles")
        .withIndex("by_org", (q) => q.eq("orgId", args.orgId))
        .collect();
      const nextDefault = remaining.sort((a, b) => b.updatedAt - a.updatedAt)[0];
      if (nextDefault) {
        await ctx.db.patch(nextDefault._id, {
          isDefault: true,
          updatedAt: Date.now(),
        });
      }
    }
  },
});

export const setDefault = internalMutation({
  args: {
    orgId: v.id("organizations"),
    profileId: v.id("wincrossPreferenceProfiles"),
  },
  handler: async (ctx, args) => {
    const profile = await ctx.db.get(args.profileId);
    if (!profile || profile.orgId !== args.orgId) {
      throw new Error("Profile not found in organization.");
    }

    await clearDefaultFlags(ctx, args.orgId);
    await ctx.db.patch(args.profileId, {
      isDefault: true,
      updatedAt: Date.now(),
    });
  },
});

async function clearDefaultFlags(
  // Convex ctx type is generated; this helper stays intentionally loose to avoid
  // threading verbose generic context types through internal mutation helpers.
  ctx: any,
  orgId: Id<"organizations">,
): Promise<void> {
  const existingDefaults = await ctx.db
    .query("wincrossPreferenceProfiles")
    .withIndex("by_org_default", (q: any) => q.eq("orgId", orgId).eq("isDefault", true))
    .collect();

  for (const profile of existingDefaults) {
    await ctx.db.patch(profile._id, {
      isDefault: false,
      updatedAt: Date.now(),
    });
  }
}
