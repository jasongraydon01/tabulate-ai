/**
 * DELETE /api/members/[membershipId]
 * Remove a member from the organization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api, internal } from '../../../../../convex/_generated/api';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { getPostHogClient } from '@/lib/posthog-server';
import type { Id } from '../../../../../convex/_generated/dataModel';

/** Convex IDs are alphanumeric with possible underscores */
const CONVEX_ID_RE = /^[a-zA-Z0-9_]+$/;

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ membershipId: string }> }
) {
  try {
    const { membershipId } = await params;

    if (!membershipId || !CONVEX_ID_RE.test(membershipId)) {
      return NextResponse.json({ error: 'Invalid membership ID' }, { status: 400 });
    }

    // 1. Auth
    const auth = await requireConvexAuth();

    // 2. Rate limit
    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'high', 'members/remove');
    if (rateLimited) return rateLimited;

    // 3. Role check
    if (!canPerform(auth.role, 'remove_member')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Fetch org members for PostHog event enrichment (role of target)
    const convex = getConvexClient();
    const members = await convex.query(api.orgMemberships.listByOrg, {
      orgId: auth.convexOrgId as Id<"organizations">,
    });
    const target = members.find((m) => String(m._id) === membershipId);

    // 5. Remove the membership (all safety guards are inside the mutation for atomicity)
    try {
      await mutateInternal(internal.orgMemberships.remove, {
        membershipId: membershipId as Id<"orgMemberships">,
        orgId: auth.convexOrgId as Id<"organizations">,
        actorUserId: auth.convexUserId as Id<"users">,
      });
    } catch (mutationError) {
      const msg = mutationError instanceof Error ? mutationError.message : 'Unknown error';
      // Map known mutation errors to appropriate HTTP status codes
      if (msg.includes('not found')) {
        return NextResponse.json({ error: 'Member not found' }, { status: 404 });
      }
      if (msg.includes('Cannot remove') || msg.includes('already been removed')) {
        return NextResponse.json({ error: msg }, { status: 400 });
      }
      throw mutationError;
    }

    // 6. Track event
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: String(auth.convexUserId),
      event: 'member_removed',
      properties: {
        org_id: String(auth.convexOrgId),
        removed_user_id: target ? String(target.userId) : membershipId,
        removed_role: target?.role ?? 'unknown',
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Remove Member] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Failed to remove member', details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}
