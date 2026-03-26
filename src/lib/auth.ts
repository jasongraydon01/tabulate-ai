import { withAuth, getWorkOS } from "@workos-inc/authkit-nextjs";
import { setSentryUser } from "@/lib/observability";

/**
 * Typed error for authentication failures.
 * Use `instanceof AuthenticationError` in catch blocks to return 401.
 */
export class AuthenticationError extends Error {
  constructor(message = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export interface AuthContext {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  role?: string;
  isBypass: boolean;
}

const DEV_USER: AuthContext = {
  userId: "dev_user_001",
  email: "dev@crosstab.ai",
  name: "Dev User",
  orgId: "dev_org_001",
  orgName: "TabulateAI Dev",
  role: "admin",
  isBypass: true,
};

// In-memory cache for org names to avoid repeated WorkOS API calls
const orgNameCache = new Map<string, { name: string; expiresAt: number }>();
const ORG_CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

async function fetchOrgName(orgId: string): Promise<string> {
  const cached = orgNameCache.get(orgId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.name;
  }

  try {
    const workos = getWorkOS();
    const org = await workos.organizations.getOrganization(orgId);
    const name = org.name;
    orgNameCache.set(orgId, { name, expiresAt: Date.now() + ORG_CACHE_TTL_MS });
    return name;
  } catch (err) {
    console.warn(`[Auth] Failed to fetch org name for ${orgId}:`, err);
    // Fallback: use the org ID itself as the name
    return orgId;
  }
}

/**
 * Get the current authenticated user context.
 * In AUTH_BYPASS mode, returns a hardcoded dev user.
 * Returns null if not authenticated or if user has no organization.
 */
export async function getAuth(): Promise<AuthContext | null> {
  if (process.env.AUTH_BYPASS === "true") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("AUTH_BYPASS must not be enabled in production");
    }
    setSentryUser(DEV_USER);
    return DEV_USER;
  }

  try {
    const auth = await withAuth();
    if (!auth.user) return null;

    const { user } = auth;
    const orgId = auth.organizationId;

    // User must belong to an organization to use the product
    if (!orgId) return null;

    const orgName = await fetchOrgName(orgId);

    const ctx: AuthContext = {
      userId: user.id,
      email: user.email ?? "",
      name: [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email || "Unknown",
      orgId,
      orgName,
      role: auth.role ?? undefined,
      isBypass: false,
    };
    setSentryUser(ctx);
    return ctx;
  } catch {
    return null;
  }
}

/**
 * Require authentication. Throws if not authenticated.
 */
export async function requireAuth(): Promise<AuthContext> {
  const auth = await getAuth();
  if (!auth) {
    throw new AuthenticationError();
  }
  return auth;
}
