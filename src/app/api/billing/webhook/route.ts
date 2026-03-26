/**
 * POST /api/billing/webhook
 *
 * Stripe webhook handler. No auth — verified by Stripe signature only.
 * Excluded from WorkOS middleware in src/middleware.ts.
 *
 * Handles subscription lifecycle events and syncs state to Convex.
 *
 * Stripe SDK v20 (clover API): period dates come from invoices, not subscriptions.
 * Subscription ID on invoices is at invoice.parent.subscription_details.subscription.
 */

import { NextRequest, NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { getStripeClient } from '@/lib/billing/stripe';
import { mutateInternal, queryInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import {
  getPlan,
  getPlanIdFromStripePriceId,
  PLAN_ORDER,
  type PlanId,
} from '@/lib/billing/plans';
import { mapStripeStatus } from '@/lib/billing/mapStripeStatus';

export async function POST(request: NextRequest) {
  const stripe = getStripeClient();

  // Read raw body for signature verification
  const body = await request.text();
  const signature = request.headers.get('stripe-signature');

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('[billing/webhook] STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[billing/webhook] Signature verification failed:', message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
        await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
        break;

      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object as Stripe.Subscription);
        break;

      case 'customer.subscription.deleted':
        await handleSubscriptionDeleted(event.data.object as Stripe.Subscription);
        break;

      case 'invoice.payment_failed':
        await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice);
        break;

      case 'invoice.paid':
        await handleInvoicePaid(event.data.object as Stripe.Invoice);
        break;

      default:
        // Unhandled event type — acknowledge silently
        break;
    }
  } catch (err) {
    console.error(`[billing/webhook] Error handling ${event.type}:`, err);
    return NextResponse.json({ error: 'Handler error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Extract a string ID from a Stripe object that may be a string or an object with .id */
function resolveId(ref: string | { id: string } | null | undefined): string | null {
  if (!ref) return null;
  return typeof ref === 'string' ? ref : ref.id;
}

/**
 * Extract the subscription ID from a Stripe Invoice (v20 "clover" API).
 * In v20, subscription is at invoice.parent.subscription_details.subscription.
 */
function getSubscriptionIdFromInvoice(invoice: Stripe.Invoice): string | null {
  const subRef = invoice.parent?.subscription_details?.subscription;
  return resolveId(subRef);
}

function inferPlanFromSubscription(subscription: Stripe.Subscription): PlanId | null {
  for (const item of subscription.items.data) {
    const priceId = item.price?.id;
    if (!priceId) continue;

    const inferredPlan = getPlanIdFromStripePriceId(priceId);
    if (inferredPlan) {
      return inferredPlan;
    }
  }

  const metadataPlan = subscription.metadata?.plan as PlanId | undefined;
  return metadataPlan && PLAN_ORDER.includes(metadataPlan) ? metadataPlan : null;
}

async function resolveOrgIdForSubscription(subscription: Stripe.Subscription): Promise<string | null> {
  if (subscription.metadata?.convexOrgId) {
    return subscription.metadata.convexOrgId;
  }

  const existing = await queryInternal(internal.subscriptions.getByStripeSubscription, {
    stripeSubscriptionId: subscription.id,
  });
  if (existing?.orgId) {
    return String(existing.orgId);
  }

  const customerId = resolveId(subscription.customer);
  if (!customerId) {
    return null;
  }

  const org = await queryInternal(internal.organizations.getByStripeCustomerId, {
    stripeCustomerId: customerId,
  });
  return org ? String(org._id) : null;
}

/**
 * Retrieve a subscription with its latest invoice expanded so we can read period dates.
 * In Stripe v20, current_period_start/end live on the invoice, not the subscription.
 */
async function retrieveSubscriptionWithPeriod(subscriptionId: string) {
  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId, {
    expand: ['latest_invoice'],
  });

  let periodStart: number;
  let periodEnd: number;

  const latestInvoice = subscription.latest_invoice;
  if (latestInvoice && typeof latestInvoice !== 'string') {
    // Expanded invoice — use its period dates (seconds → ms)
    periodStart = latestInvoice.period_start * 1000;
    periodEnd = latestInvoice.period_end * 1000;
  } else {
    // Fallback: use billing_cycle_anchor as period start, estimate end as +30 days
    periodStart = subscription.billing_cycle_anchor * 1000;
    periodEnd = periodStart + 30 * 24 * 60 * 60 * 1000;
  }

  return { subscription, periodStart, periodEnd };
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleCheckoutCompleted(session: Stripe.Checkout.Session) {
  if (session.mode !== 'subscription' || !session.subscription) {
    return; // Not a subscription checkout
  }

  const subscriptionId = resolveId(session.subscription);
  if (!subscriptionId) return;

  const { subscription, periodStart, periodEnd } = await retrieveSubscriptionWithPeriod(subscriptionId);
  const convexOrgId = await resolveOrgIdForSubscription(subscription);
  const planId = inferPlanFromSubscription(subscription);

  if (!convexOrgId || !planId || !PLAN_ORDER.includes(planId)) {
    console.error('[billing/webhook] checkout.session.completed missing metadata:', {
      convexOrgId,
      planId,
      subscriptionId,
    });
    return;
  }

  const plan = getPlan(planId);
  const customerId = resolveId(subscription.customer);
  if (!customerId) return;

  await mutateInternal(internal.subscriptions.upsert, {
    orgId: convexOrgId,
    stripeCustomerId: customerId,
    stripeSubscriptionId: subscription.id,
    plan: planId,
    status: mapStripeStatus(subscription.status),
    currentPeriodStart: periodStart,
    currentPeriodEnd: periodEnd,
    projectLimit: plan.projectLimit,
    overageRate: plan.overageRate,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}

async function handleSubscriptionUpdated(subscription: Stripe.Subscription) {
  const planId = inferPlanFromSubscription(subscription);
  const convexOrgId = await resolveOrgIdForSubscription(subscription);

  // If we can resolve both org and plan, do a full upsert (handles plan changes)
  if (convexOrgId && planId && PLAN_ORDER.includes(planId)) {
    const plan = getPlan(planId);
    const customerId = resolveId(subscription.customer);
    if (!customerId) return;

    // Retrieve with expanded invoice to get period dates
    const { periodStart, periodEnd } = await retrieveSubscriptionWithPeriod(subscription.id);

    await mutateInternal(internal.subscriptions.upsert, {
      orgId: convexOrgId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: subscription.id,
      plan: planId,
      status: mapStripeStatus(subscription.status),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      projectLimit: plan.projectLimit,
      overageRate: plan.overageRate,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    });
    return;
  }

  // Fallback: just update status (e.g., payment method change, no plan metadata)
  await mutateInternal(internal.subscriptions.updateStatus, {
    stripeSubscriptionId: subscription.id,
    status: mapStripeStatus(subscription.status),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  });
}

async function handleSubscriptionDeleted(subscription: Stripe.Subscription) {
  await mutateInternal(internal.subscriptions.updateStatus, {
    stripeSubscriptionId: subscription.id,
    status: 'canceled',
  });
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice) {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;

  await mutateInternal(internal.subscriptions.updateStatus, {
    stripeSubscriptionId: subscriptionId,
    status: 'past_due',
  });
}

async function handleInvoicePaid(invoice: Stripe.Invoice) {
  const subscriptionId = getSubscriptionIdFromInvoice(invoice);
  if (!subscriptionId) return;

  // Only reset the project counter on genuine new billing cycles.
  // Prorated invoices from plan upgrades (subscription_update) or
  // threshold invoices must NOT reset the counter mid-period.
  const billingReason = invoice.billing_reason;
  const isNewCycle = billingReason === 'subscription_cycle' || billingReason === 'subscription_create';

  if (isNewCycle) {
    const periodStart = invoice.period_start * 1000;
    const periodEnd = invoice.period_end * 1000;

    await mutateInternal(internal.subscriptions.resetPeriod, {
      stripeSubscriptionId: subscriptionId,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
    });
  }

  // If subscription was past_due, mark it active again (for ANY paid invoice)
  const existing = await queryInternal(internal.subscriptions.getByStripeSubscription, {
    stripeSubscriptionId: subscriptionId,
  });

  if (existing?.status === 'past_due') {
    await mutateInternal(internal.subscriptions.updateStatus, {
      stripeSubscriptionId: subscriptionId,
      status: 'active',
    });
  }
}
