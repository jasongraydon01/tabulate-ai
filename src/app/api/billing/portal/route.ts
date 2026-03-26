/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Billing Portal session for self-serve subscription management.
 * Returns the portal URL for client-side redirect.
 */

import { NextRequest, NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { queryInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import { getStripeClient } from '@/lib/billing/stripe';

export async function POST(request: NextRequest) {
  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'medium', 'billing/portal');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'manage_billing')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Look up org's Stripe customer ID
    const org = await queryInternal(internal.organizations.getByWorkosId, {
      workosOrgId: auth.orgId,
    });

    if (!org?.stripeCustomerId) {
      return NextResponse.json(
        { error: 'No billing account', details: 'Subscribe to a plan first' },
        { status: 400 },
      );
    }

    const stripe = getStripeClient();
    const origin = request.headers.get('origin') || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${origin}/settings`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[billing/portal] Error:', error);
    return NextResponse.json({ error: 'Failed to create portal session' }, { status: 500 });
  }
}
