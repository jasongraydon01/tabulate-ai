import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockMutateInternal,
  mockMeterEventsCreate,
  mockSendBillingNotifications,
} = vi.hoisted(() => ({
  mockMutateInternal: vi.fn(),
  mockMeterEventsCreate: vi.fn(),
  mockSendBillingNotifications: vi.fn(),
}));

vi.mock('@/lib/convex', () => ({
  mutateInternal: mockMutateInternal,
}));

vi.mock('@/lib/billing/stripe', () => ({
  getStripeClient: () => ({
    billing: {
      meterEvents: { create: mockMeterEventsCreate },
    },
  }),
}));

vi.mock('@/lib/billing/notifications', () => ({
  sendBillingNotifications: mockSendBillingNotifications,
}));

import { recordProjectUsage } from '../recordProjectUsage';

describe('recordProjectUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records Stripe usage and threshold notifications after the atomic mutation', async () => {
    mockMutateInternal.mockResolvedValue({
      counted: true,
      subscription: {
        plan: 'starter',
        projectsUsed: 4,
        projectLimit: 5,
        overageRate: 16_100,
        stripeCustomerId: 'cus_123',
        billingNotifications: {},
      },
    });

    await recordProjectUsage({ projectId: 'project_1', orgId: 'org_1' });

    expect(mockMutateInternal).toHaveBeenCalledTimes(1);
    expect(mockMeterEventsCreate).toHaveBeenCalledWith({
      event_name: 'crosstab_project_created',
      payload: {
        stripe_customer_id: 'cus_123',
        value: '1',
      },
    });
    expect(mockSendBillingNotifications).toHaveBeenCalledWith({
      orgId: 'org_1',
      plan: 'starter',
      projectsUsed: 4,
      projectLimit: 5,
      overageRate: 16_100,
      billingNotifications: {},
    });
  });

  it('no-ops when the project was already billed', async () => {
    mockMutateInternal.mockResolvedValue({
      counted: false,
      subscription: null,
    });

    await recordProjectUsage({ projectId: 'project_1', orgId: 'org_1' });

    expect(mockMeterEventsCreate).not.toHaveBeenCalled();
    expect(mockSendBillingNotifications).not.toHaveBeenCalled();
  });
});
