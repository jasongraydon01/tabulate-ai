import { mutateInternal } from "./convex";
import { internal } from "../../convex/_generated/api";
import type { AuthContext } from "./auth";
import type { Id } from "../../convex/_generated/dataModel";
import type { Role } from "./permissions";

/**
 * Map a WorkOS role string to our app's Role type.
 * Returns undefined for unknown/missing values so we don't overwrite
 * the existing Convex role. "external_partner" is app-only and never
 * comes from WorkOS.
 */
function mapWorkosRole(workosRole: string | undefined): Role | undefined {
  if (workosRole === "admin") return "admin";
  if (workosRole === "member") return "member";
  return undefined;
}

export interface ConvexIds {
  orgId: Id<"organizations">;
  userId: Id<"users">;
}

// In-memory cache keyed by workosUserId → { orgId, userId, expiresAt }
const authCache = new Map<string, { ids: ConvexIds; expiresAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Sync a WorkOS user and org into Convex.
 * Idempotent — safe to call on every login/request.
 * Returns Convex IDs for the org and user.
 * Results are cached for 5 minutes per workosUserId.
 */
export async function syncAuthToConvex(auth: AuthContext): Promise<ConvexIds> {
  // Check cache first
  const cached = authCache.get(auth.userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ids;
  }

  // Upsert the organization
  const orgId = await mutateInternal(internal.organizations.upsert, {
    workosOrgId: auth.orgId,
    name: auth.orgName || (auth.isBypass ? "TabulateAI Dev" : "Unknown Org"),
    slug: auth.isBypass
      ? "tabulate-ai-dev"
      : (auth.orgName
          ? auth.orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
          : "")
        || auth.orgId,
  });

  // Upsert the user
  const userId = await mutateInternal(internal.users.upsert, {
    workosUserId: auth.userId,
    email: auth.email,
    name: auth.name,
  });

  // Upsert the membership with role from WorkOS (if available).
  // Unknown/missing roles map to undefined → existing Convex role preserved.
  const role = mapWorkosRole(auth.role);
  await mutateInternal(internal.orgMemberships.upsert, {
    userId,
    orgId,
    ...(role ? { role } : {}),
  });

  const ids: ConvexIds = { orgId, userId };

  // Cache the result
  authCache.set(auth.userId, {
    ids,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });

  return ids;
}
