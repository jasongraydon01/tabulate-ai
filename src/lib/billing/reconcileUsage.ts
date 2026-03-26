/**
 * Reconciles Convex project usage counter with Stripe meter event totals.
 *
 * If the Stripe meter is behind (e.g., fire-and-forget events were lost),
 * this fires corrective meter events to bring Stripe in line with Convex.
 *
 * Safe to call repeatedly — no-op when already in sync.
 */

import { queryInternal } from '@/lib/convex';
import { internal } from '../../../convex/_generated/api';
import { getStripeClient } from './stripe';
import { getStripeMeterId, STRIPE_METER_EVENT_NAME } from './plans';
import type { Id } from '../../../convex/_generated/dataModel';

export interface ReconcileResult {
  convexCount: number;
  stripeCount: number;
  corrected: number;
  alreadySynced: boolean;
}

export async function reconcileUsage(orgId: string): Promise<ReconcileResult> {
  const subscription = await queryInternal(internal.subscriptions.getByOrgInternal, {
    orgId: orgId as Id<"organizations">,
  });

  if (!subscription || !subscription.stripeCustomerId) {
    throw new Error('No subscription or Stripe customer found for organization');
  }

  const stripe = getStripeClient();
  const meterId = getStripeMeterId();

  // Align timestamps to minute boundaries (Stripe requirement).
  // Floor start to the previous minute, ceil end to the next minute.
  const startTimeSec = Math.floor(subscription.currentPeriodStart / 1000 / 60) * 60;
  const endTimeSec = Math.ceil(subscription.currentPeriodEnd / 1000 / 60) * 60;

  // Query Stripe for the aggregated meter value in this billing period
  const summaries = await stripe.billing.meters.listEventSummaries(meterId, {
    customer: subscription.stripeCustomerId,
    start_time: startTimeSec,
    end_time: endTimeSec,
  });

  // Sum all summaries (typically one entry for the whole period)
  const stripeCount = summaries.data.reduce(
    (sum, s) => sum + s.aggregated_value,
    0,
  );

  const convexCount = subscription.projectsUsed;
  const drift = convexCount - stripeCount;

  if (drift <= 0) {
    // Stripe is at or ahead of Convex — nothing to correct
    return { convexCount, stripeCount, corrected: 0, alreadySynced: drift === 0 };
  }

  // Fire corrective meter events for the drift
  for (let i = 0; i < drift; i++) {
    await stripe.billing.meterEvents.create({
      event_name: STRIPE_METER_EVENT_NAME,
      payload: {
        stripe_customer_id: subscription.stripeCustomerId,
        value: '1',
      },
    });
  }

  return { convexCount, stripeCount, corrected: drift, alreadySynced: false };
}
