export type BillingSubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'trialing'
  | 'unpaid';

export function hasActiveSubscriptionStatus(status: string | null | undefined): status is BillingSubscriptionStatus {
  return status === 'active' || status === 'trialing';
}
