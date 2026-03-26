/**
 * POST /api/billing/checkout
 *
 * Creates a Stripe Checkout Session for a given plan.
 * Returns the checkout URL for client-side redirect.
 *
 * Creates a Stripe customer for the org on first checkout if one doesn't exist.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { queryInternal, mutateInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import { getStripeClient } from '@/lib/billing/stripe';
import {
  PLAN_ORDER,
  getStripePriceId,
  getStripeMeteredPriceId,
  type PlanId,
} from '@/lib/billing/plans';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'high', 'billing/checkout');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'manage_billing')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse and validate plan ID
    const body = await request.json();
    const { planId } = body as { planId: string };

    if (!planId || !PLAN_ORDER.includes(planId as PlanId)) {
      return NextResponse.json(
        { error: 'Invalid plan', details: `planId must be one of: ${PLAN_ORDER.join(', ')}` },
        { status: 400 },
      );
    }

    const stripe = getStripeClient();

    // Look up org to check for existing Stripe customer
    const org = await queryInternal(internal.organizations.getByWorkosId, {
      workosOrgId: auth.orgId,
    });

    if (!org) {
      return NextResponse.json({ error: 'Organization not found' }, { status: 404 });
    }

    // Create Stripe customer if this org doesn't have one yet
    let stripeCustomerId = org.stripeCustomerId;
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        name: org.name,
        metadata: {
          convexOrgId: String(org._id),
          workosOrgId: auth.orgId,
        },
      });
      stripeCustomerId = customer.id;
      await mutateInternal(internal.organizations.setStripeCustomerId, {
        orgId: org._id,
        stripeCustomerId,
      });
    }

    // Build checkout session
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    // Deterministic idempotency key prevents duplicate sessions from
    // double-clicks or concurrent tabs. 10-minute window allows legitimate
    // retries (e.g., user cancels checkout and comes back).
    const windowMinutes = 10;
    const timeWindow = Math.floor(Date.now() / (windowMinutes * 60 * 1000));
    const idempotencyKey = `checkout_${org._id}_${planId}_${timeWindow}`;

    const session = await stripe.checkout.sessions.create(
      {
        customer: stripeCustomerId,
        mode: 'subscription',
        line_items: [
          { price: getStripePriceId(planId as PlanId), quantity: 1 },
          { price: getStripeMeteredPriceId(planId as PlanId) },
        ],
        success_url: `${origin}/dashboard?checkout=success`,
        cancel_url: `${origin}/pricing`,
        subscription_data: {
          metadata: {
            convexOrgId: String(org._id),
            plan: planId,
          },
        },
      },
      { idempotencyKey },
    );

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[billing/checkout] Error:', error);
    return NextResponse.json({ error: 'Failed to create checkout session' }, { status: 500 });
  }
}
