import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockConstructEvent = vi.fn();
const mockRetrieveSubscription = vi.fn();
const mockMutateInternal = vi.fn();
const mockQueryInternal = vi.fn();

vi.mock('@/lib/billing/stripe', () => ({
  getStripeClient: () => ({
    webhooks: {
      constructEvent: mockConstructEvent,
    },
    subscriptions: {
      retrieve: mockRetrieveSubscription,
    },
  }),
}));

vi.mock('@/lib/convex', () => ({
  mutateInternal: mockMutateInternal,
  queryInternal: mockQueryInternal,
}));

describe('billing webhook route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
    process.env.STRIPE_PRICE_STARTER = 'price_starter';
    process.env.STRIPE_PRICE_STARTER_METERED = 'price_starter_metered';
    process.env.STRIPE_PRICE_PROFESSIONAL = 'price_professional';
    process.env.STRIPE_PRICE_PROFESSIONAL_METERED = 'price_professional_metered';
  });

  it('infers the active plan from Stripe subscription items and persists cancel-at-period-end', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_123',
          customer: 'cus_123',
          status: 'active',
          cancel_at_period_end: true,
          metadata: {
            plan: 'starter',
          },
          items: {
            data: [
              { price: { id: 'price_professional' } },
              { price: { id: 'price_professional_metered' } },
            ],
          },
        },
      },
    });

    mockQueryInternal.mockResolvedValueOnce({
      orgId: 'org_convex_1',
    });

    mockRetrieveSubscription.mockResolvedValue({
      latest_invoice: {
        period_start: 1_700_000_000,
        period_end: 1_700_259_200,
      },
    });

    const { POST } = await import('../route');

    const request = new NextRequest('http://localhost/api/billing/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'stripe-signature': 'sig_test',
      },
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mockMutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_convex_1',
        plan: 'professional',
        cancelAtPeriodEnd: true,
        projectLimit: 20,
        overageRate: 13_500,
      }),
    );
  });

  it('falls back to the org stripe customer lookup when metadata is missing', async () => {
    mockConstructEvent.mockReturnValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          mode: 'subscription',
          subscription: 'sub_123',
        },
      },
    });

    mockRetrieveSubscription.mockResolvedValue({
      id: 'sub_123',
      customer: 'cus_123',
      status: 'active',
      cancel_at_period_end: false,
      metadata: {},
      items: {
        data: [
          { price: { id: 'price_starter' } },
          { price: { id: 'price_starter_metered' } },
        ],
      },
      latest_invoice: {
        period_start: 1_700_000_000,
        period_end: 1_700_259_200,
      },
    });

    mockQueryInternal
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'org_convex_2' });

    const { POST } = await import('../route');

    const request = new NextRequest('http://localhost/api/billing/webhook', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: {
        'stripe-signature': 'sig_test',
      },
    });

    await POST(request);

    expect(mockMutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org_convex_2',
        plan: 'starter',
      }),
    );
  });
});
