/**
 * POST /api/billing/reconcile
 *
 * Compares Convex project usage counter with Stripe meter event totals
 * and fires corrective meter events for any drift.
 *
 * Admin-only. Can be triggered manually or by a future scheduled job.
 */

import { NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { reconcileUsage } from '@/lib/billing/reconcileUsage';

export async function POST() {
  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'high', 'billing/reconcile');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'manage_billing')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const result = await reconcileUsage(String(auth.convexOrgId));

    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[billing/reconcile] Error:', error);
    return NextResponse.json({ error: 'Reconciliation failed' }, { status: 500 });
  }
}
