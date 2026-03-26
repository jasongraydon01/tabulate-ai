import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Convex client before importing the module under test
vi.mock('@/lib/convex', () => ({
  queryInternal: vi.fn(),
}));

// Mock Stripe client
const mockMeterEventsCreate = vi.fn();
const mockListEventSummaries = vi.fn();

vi.mock('@/lib/billing/stripe', () => ({
  getStripeClient: () => ({
    billing: {
      meterEvents: { create: mockMeterEventsCreate },
      meters: { listEventSummaries: mockListEventSummaries },
    },
  }),
}));

vi.mock('@/lib/billing/plans', () => ({
  getStripeMeterId: () => 'meter_test_123',
  STRIPE_METER_EVENT_NAME: 'crosstab_project_created',
}));

import { reconcileUsage } from '../reconcileUsage';
import { queryInternal } from '@/lib/convex';

const mockQueryInternal = vi.mocked(queryInternal);

const baseSubscription = {
  _id: 'sub_convex_1',
  orgId: 'org_1',
  stripeCustomerId: 'cus_test_123',
  stripeSubscriptionId: 'sub_stripe_123',
  plan: 'starter' as const,
  status: 'active' as const,
  projectsUsed: 5,
  projectLimit: 5,
  overageRate: 16_100,
  cancelAtPeriodEnd: false,
  // Period: Jan 1 - Feb 1 2026 (in ms)
  currentPeriodStart: 1767225600000,
  currentPeriodEnd: 1769904000000,
};

describe('reconcileUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns alreadySynced when counts match', async () => {
    mockQueryInternal.mockResolvedValue(baseSubscription);
    mockListEventSummaries.mockResolvedValue({
      data: [{ aggregated_value: 5 }],
    });

    const result = await reconcileUsage('org_1');

    expect(result).toEqual({
      convexCount: 5,
      stripeCount: 5,
      corrected: 0,
      alreadySynced: true,
    });
    expect(mockMeterEventsCreate).not.toHaveBeenCalled();
  });

  it('fires corrective events when Stripe is behind', async () => {
    mockQueryInternal.mockResolvedValue({ ...baseSubscription, projectsUsed: 8 });
    mockListEventSummaries.mockResolvedValue({
      data: [{ aggregated_value: 5 }],
    });

    const result = await reconcileUsage('org_1');

    expect(result).toEqual({
      convexCount: 8,
      stripeCount: 5,
      corrected: 3,
      alreadySynced: false,
    });
    expect(mockMeterEventsCreate).toHaveBeenCalledTimes(3);
    expect(mockMeterEventsCreate).toHaveBeenCalledWith({
      event_name: 'crosstab_project_created',
      payload: {
        stripe_customer_id: 'cus_test_123',
        value: '1',
      },
    });
  });

  it('does not fire events when Stripe is ahead of Convex', async () => {
    mockQueryInternal.mockResolvedValue({ ...baseSubscription, projectsUsed: 3 });
    mockListEventSummaries.mockResolvedValue({
      data: [{ aggregated_value: 5 }],
    });

    const result = await reconcileUsage('org_1');

    expect(result).toEqual({
      convexCount: 3,
      stripeCount: 5,
      corrected: 0,
      alreadySynced: false,
    });
    expect(mockMeterEventsCreate).not.toHaveBeenCalled();
  });

  it('sums multiple meter event summaries', async () => {
    mockQueryInternal.mockResolvedValue({ ...baseSubscription, projectsUsed: 10 });
    mockListEventSummaries.mockResolvedValue({
      data: [{ aggregated_value: 3 }, { aggregated_value: 4 }],
    });

    const result = await reconcileUsage('org_1');

    expect(result.stripeCount).toBe(7);
    expect(result.corrected).toBe(3);
    expect(mockMeterEventsCreate).toHaveBeenCalledTimes(3);
  });

  it('handles zero usage correctly', async () => {
    mockQueryInternal.mockResolvedValue({ ...baseSubscription, projectsUsed: 0 });
    mockListEventSummaries.mockResolvedValue({
      data: [],
    });

    const result = await reconcileUsage('org_1');

    expect(result).toEqual({
      convexCount: 0,
      stripeCount: 0,
      corrected: 0,
      alreadySynced: true,
    });
  });

  it('throws when no subscription exists', async () => {
    mockQueryInternal.mockResolvedValue(null);

    await expect(reconcileUsage('org_1')).rejects.toThrow(
      'No subscription or Stripe customer found',
    );
  });
});
