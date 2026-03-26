/**
 * Records billing usage for a project on first successful pipeline run.
 *
 * Called by both pipelineOrchestrator and reviewCompletion after a run
 * completes with status 'success' or 'partial'.
 *
 * Flow:
 *   1. recordProjectUsage — atomic Convex mutation marks the project billed and
 *      increments the org subscription count in one transaction
 *   2. Fire Stripe meter event — Stripe's graduated pricing handles overages
 *   3. Send billing threshold notifications — non-blocking and deduplicated
 *
 * All errors are caught and logged. A billing failure must never block
 * a successful pipeline run.
 */

import { mutateInternal } from '@/lib/convex';
import { internal } from '../../../convex/_generated/api';
import { getStripeClient } from './stripe';
import { STRIPE_METER_EVENT_NAME } from './plans';
import type { Id } from '../../../convex/_generated/dataModel';
import { sendBillingNotifications } from './notifications';

export async function recordProjectUsage(opts: {
  projectId: string;
  orgId: string;
}): Promise<void> {
  const { projectId, orgId } = opts;

  try {
    const result = await mutateInternal(internal.subscriptions.recordProjectUsage, {
      projectId: projectId as Id<"projects">,
      orgId: orgId as Id<"organizations">,
    });

    if (!result?.counted || !result.subscription) {
      return; // Already billed — no-op
    }

    // Step 2: Fire Stripe meter event for usage-based billing
    try {
      if (result.subscription.stripeCustomerId) {
        const stripe = getStripeClient();
        await stripe.billing.meterEvents.create({
          event_name: STRIPE_METER_EVENT_NAME,
          payload: {
            stripe_customer_id: result.subscription.stripeCustomerId,
            value: '1',
          },
        });
      } else {
        console.warn('[billing] No Stripe customer ID — skipping meter event');
      }
    } catch (err) {
      // Stripe meter failure is non-critical. The Convex counter is the
      // source of truth for UI. Stripe will reconcile on the next invoice.
      console.warn('[billing] Stripe meter event failed (non-blocking):', err);
    }

    // Step 3: Trigger any threshold notifications for this cycle
    try {
      await sendBillingNotifications({
        orgId,
        plan: result.subscription.plan,
        projectsUsed: result.subscription.projectsUsed,
        projectLimit: result.subscription.projectLimit,
        overageRate: result.subscription.overageRate,
        billingNotifications: result.subscription.billingNotifications,
      });
    } catch (err) {
      console.warn('[billing] Threshold notifications failed (non-blocking):', err);
    }
  } catch (err) {
    // Top-level catch: never let billing break a successful pipeline
    console.error('[billing] recordProjectUsage failed:', err);
  }
}
