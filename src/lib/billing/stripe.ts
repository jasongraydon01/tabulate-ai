import Stripe from 'stripe';

let stripeInstance: Stripe | null = null;

/**
 * Server-side Stripe client singleton.
 * Uses the SDK's built-in API version (2026-02-25.clover for stripe@20.x).
 * Throws if STRIPE_SECRET_KEY is not set.
 */
export function getStripeClient(): Stripe {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('STRIPE_SECRET_KEY is not set');
      }
      console.warn('[stripe] STRIPE_SECRET_KEY is not set — billing operations will fail');
      // In dev, still throw so callers get a clear error at the call site
      throw new Error('STRIPE_SECRET_KEY is not set');
    }
    stripeInstance = new Stripe(key);
  }
  return stripeInstance;
}
