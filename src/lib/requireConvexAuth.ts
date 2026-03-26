import { requireAuth, AuthenticationError, type AuthContext } from "./auth";
export { AuthenticationError };
import { syncAuthToConvex, type ConvexIds } from "./auth-sync";
import { queryInternal } from "./convex";
import { internal } from "../../convex/_generated/api";
import type { Role } from "./permissions";

export interface ConvexAuthContext extends AuthContext {
  convexOrgId: ConvexIds["orgId"];
  convexUserId: ConvexIds["userId"];
  role: Role;
}

/**
 * Single-call helper for API routes: gets WorkOS auth + resolves Convex IDs + role.
 * Throws if not authenticated.
 */
export async function requireConvexAuth(): Promise<ConvexAuthContext> {
  const auth = await requireAuth();
  const ids = await syncAuthToConvex(auth);

  // Fetch role from org membership (internalQuery — not browser-callable)
  const membership = await queryInternal(internal.orgMemberships.getByUserAndOrg, {
    userId: ids.userId,
    orgId: ids.orgId,
  });

  // No active membership means the user was removed by an admin
  if (!membership) {
    throw new AuthenticationError('User is not a member of this organization');
  }

  const role = membership.role as Role;

  return {
    ...auth,
    convexOrgId: ids.orgId,
    convexUserId: ids.userId,
    role,
  };
}
