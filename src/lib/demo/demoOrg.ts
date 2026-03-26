/**
 * Manages the shared TabulateAI demo organization.
 *
 * All demo pipeline runs are created under this org so they're isolated
 * from real customer data while reusing the existing project/run infrastructure.
 *
 * If DEMO_ORG_ID is set, uses that directly. Otherwise, upserts the org
 * on first call using a well-known WorkOS org ID marker.
 */

import { mutateInternal } from '@/lib/convex';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

/** Well-known WorkOS org ID for the demo org (not a real WorkOS org). */
const DEMO_WORKOS_ORG_ID = 'demo_tabulateai_system_org';
const DEMO_WORKOS_USER_ID = 'demo_tabulateai_system_user';

let cachedDemoOrgId: Id<"organizations"> | null = null;
let cachedDemoUserId: Id<"users"> | null = null;

/**
 * Get or create the shared demo org. Result is cached for the process lifetime.
 */
export async function getDemoOrgId(): Promise<Id<"organizations">> {
  if (cachedDemoOrgId) return cachedDemoOrgId;

  // Fast path: env var set explicitly (e.g., in production after first deploy)
  const envOrgId = process.env.DEMO_ORG_ID;
  if (envOrgId) {
    cachedDemoOrgId = envOrgId as Id<"organizations">;
    return cachedDemoOrgId;
  }

  // Slow path: upsert the demo org (idempotent — safe to call concurrently)
  const orgId = await mutateInternal(internal.organizations.upsert, {
    workosOrgId: DEMO_WORKOS_ORG_ID,
    name: 'TabulateAI Demo',
    slug: 'tabulate-ai-demo',
  });

  cachedDemoOrgId = orgId;

  // Also look up if there's a user we need — for now, demo runs don't need a launchedBy user
  console.log(`[Demo] Using demo org: ${orgId}`);
  return orgId;
}

export async function getDemoUserId(): Promise<Id<"users">> {
  if (cachedDemoUserId) return cachedDemoUserId;

  const userId = await mutateInternal(internal.users.upsert, {
    workosUserId: DEMO_WORKOS_USER_ID,
    email: 'demo@tabulateai.system',
    name: 'TabulateAI Demo',
  });

  cachedDemoUserId = userId;
  return userId;
}

export async function getDemoActor(): Promise<{
  orgId: Id<"organizations">;
  userId: Id<"users">;
}> {
  const [orgId, userId] = await Promise.all([
    getDemoOrgId(),
    getDemoUserId(),
  ]);

  return { orgId, userId };
}
