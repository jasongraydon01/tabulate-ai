/**
 * Maps Stripe subscription statuses to our Convex schema's status enum.
 *
 * Stripe has more statuses than we track. We collapse edge cases:
 * - incomplete / incomplete_expired → unpaid / canceled
 * - paused → canceled (we don't support pause)
 */

type ConvexSubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'unpaid';

const STATUS_MAP: Record<string, ConvexSubscriptionStatus> = {
  active: 'active',
  past_due: 'past_due',
  canceled: 'canceled',
  trialing: 'trialing',
  unpaid: 'unpaid',
  incomplete: 'unpaid',
  incomplete_expired: 'canceled',
  paused: 'canceled',
};

export function mapStripeStatus(stripeStatus: string): ConvexSubscriptionStatus {
  const mapped = STATUS_MAP[stripeStatus];
  if (!mapped) {
    console.warn(`[billing] Unknown Stripe subscription status: ${stripeStatus}, defaulting to 'unpaid'`);
    return 'unpaid';
  }
  return mapped;
}
