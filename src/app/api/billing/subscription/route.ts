/**
 * GET /api/billing/subscription
 *
 * Returns the current org's subscription status, usage, and plan details.
 */

import { NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { queryInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import {
  getPlan,
  getSmartUpgradeBreakpoint,
  getOverageCost,
  formatPrice,
  type PlanId,
} from '@/lib/billing/plans';

export async function GET() {
  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'billing/subscription');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'view_billing')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const subscription = await queryInternal(internal.subscriptions.getByOrgInternal, {
      orgId: auth.convexOrgId,
    });

    if (!subscription) {
      return NextResponse.json({ subscription: null });
    }

    // Enrich with plan details
    const planId = subscription.plan as PlanId;
    const plan = getPlan(planId);
    const upgradeBreakpoint = getSmartUpgradeBreakpoint(planId);
    const currentOverageCost = getOverageCost(planId, subscription.projectsUsed);

    // For PAYG, every project is billed at the per-project rate (no "overage" framing)
    const isPayg = plan.projectLimit === 0;
    const overageCostFormatted = isPayg
      ? formatPrice(subscription.projectsUsed * subscription.overageRate)
      : formatPrice(currentOverageCost);

    return NextResponse.json({
      subscription: {
        plan: planId,
        planName: plan.name,
        status: subscription.status,
        projectsUsed: subscription.projectsUsed,
        projectLimit: subscription.projectLimit,
        overageRate: subscription.overageRate,
        overageRateFormatted: formatPrice(subscription.overageRate),
        currentOverageCost: isPayg
          ? subscription.projectsUsed * subscription.overageRate
          : currentOverageCost,
        currentOverageCostFormatted: overageCostFormatted,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
        upgradeBreakpoint,
        monthlyPrice: plan.monthlyPrice,
        monthlyPriceFormatted: isPayg ? 'Pay-As-You-Go' : formatPrice(plan.monthlyPrice),
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[billing/subscription] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch subscription' }, { status: 500 });
  }
}
