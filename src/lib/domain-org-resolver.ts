import { getWorkOS } from "@workos-inc/authkit-nextjs";

interface DomainResolution {
  workosOrgId: string;
}

// Cache domain → org lookups (5 min TTL)
const domainCache = new Map<string, { result: DomainResolution | null; expiresAt: number }>();
const DOMAIN_CACHE_TTL_MS = 5 * 60 * 1000;

// Cache WorkOS membership creation per user+org (process lifetime — idempotent)
const membershipCreatedCache = new Set<string>();

/**
 * Attempt to resolve an organization for a user based on their email domain.
 *
 * Uses the WorkOS API directly — no Convex table or env vars needed.
 * Just create the org in the WorkOS dashboard with the domain, and it works.
 *
 * 1. Extracts domain from email
 * 2. Asks WorkOS: "which org owns this domain?"
 * 3. If match: creates WorkOS organization membership (idempotent)
 * 4. Returns { workosOrgId } or null
 */
export async function resolveOrgByDomain(
  userId: string,
  email: string
): Promise<DomainResolution | null> {
  const domain = extractDomain(email);
  if (!domain) return null;

  // 1. Look up which WorkOS org owns this domain (cached)
  const resolution = await lookupOrgByDomain(domain);
  if (!resolution) return null;

  // 2. Create WorkOS membership if we haven't already this process
  const cacheKey = `${userId}:${resolution.workosOrgId}`;
  if (!membershipCreatedCache.has(cacheKey)) {
    try {
      const workos = getWorkOS();
      await workos.userManagement.createOrganizationMembership({
        userId,
        organizationId: resolution.workosOrgId,
      });
      console.log(
        `[DomainOrgResolver] Created WorkOS membership: user=${userId}, org=${resolution.workosOrgId}, domain=${domain}`
      );
    } catch (err: unknown) {
      // 409 = membership already exists — that's fine, it's idempotent
      if (isConflictError(err)) {
        console.log(
          `[DomainOrgResolver] WorkOS membership already exists: user=${userId}, org=${resolution.workosOrgId}`
        );
      } else {
        console.error(
          `[DomainOrgResolver] Failed to create WorkOS membership: user=${userId}, org=${resolution.workosOrgId}`,
          err
        );
        return null;
      }
    }
    membershipCreatedCache.add(cacheKey);
  }

  return resolution;
}

function extractDomain(email: string): string | null {
  const atIndex = email.indexOf("@");
  if (atIndex === -1) return null;
  return email.slice(atIndex + 1).toLowerCase();
}

async function lookupOrgByDomain(domain: string): Promise<DomainResolution | null> {
  const cached = domainCache.get(domain);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.result;
  }

  try {
    const workos = getWorkOS();
    const orgs = await workos.organizations.listOrganizations({
      domains: [domain],
    });

    // Take the first matching org (domains are unique per org in WorkOS)
    const org = orgs.data[0];
    const result = org ? { workosOrgId: org.id } : null;

    if (result) {
      console.log(`[DomainOrgResolver] Domain "${domain}" → org "${org.name}" (${org.id})`);
    } else {
      console.log(`[DomainOrgResolver] No org found for domain "${domain}"`);
    }

    domainCache.set(domain, { result, expiresAt: Date.now() + DOMAIN_CACHE_TTL_MS });
    return result;
  } catch (err) {
    console.error(`[DomainOrgResolver] Failed to look up org for domain "${domain}":`, err);
    return null;
  }
}

function isConflictError(err: unknown): boolean {
  if (err && typeof err === "object" && "status" in err) {
    return (err as { status: number }).status === 409;
  }
  if (err instanceof Error && err.message.includes("already exists")) {
    return true;
  }
  return false;
}
