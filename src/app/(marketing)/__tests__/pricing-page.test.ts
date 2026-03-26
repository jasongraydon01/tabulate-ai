import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAuth: vi.fn(),
  syncAuthToConvex: vi.fn(),
  queryInternal: vi.fn(),
  redirect: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}));

vi.mock('@/lib/featureGates', () => ({
  isPreviewFeatureEnabled: () => true,
}));

vi.mock('@/lib/auth', () => ({
  getAuth: mocks.getAuth,
}));

vi.mock('@/lib/auth-sync', () => ({
  syncAuthToConvex: mocks.syncAuthToConvex,
}));

vi.mock('@/lib/convex', () => ({
  queryInternal: mocks.queryInternal,
}));

vi.mock('@/components/pricing/PlanCards', () => ({
  PlanCards: (props: unknown) => React.createElement('div', null, `plan-cards:${JSON.stringify(props)}`),
}));

vi.mock('@/components/pricing/PricingFAQ', () => ({
  PricingFAQ: () => React.createElement('div', null, 'pricing-faq'),
}));

vi.mock('@/components/ui/scroll-reveal', () => ({
  ScrollReveal: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ asChild, children, ...props }: { asChild?: boolean; children: React.ReactNode }) =>
    asChild
      ? React.createElement(React.Fragment, null, children)
      : React.createElement('button', props, children),
}));

vi.mock('@/components/TrackedLink', () => ({
  TrackedLink: ({
    href,
    children,
  }: {
    href: string | { pathname?: string };
    children: React.ReactNode;
  }) => React.createElement('a', { href: typeof href === 'string' ? href : href.pathname }, children),
}));

describe('pricing page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders unauthenticated pricing CTAs with explicit sign-in routing', async () => {
    mocks.getAuth.mockResolvedValue(null);
    const { default: PricingPage } = await import('@/app/(marketing)/pricing/page');

    const markup = renderToStaticMarkup(
      await PricingPage({
        searchParams: Promise.resolve({}),
      }),
    );

    expect(markup).toContain('/auth/sign-in?returnTo=%2Fdashboard');
    expect(markup).toContain('>Get Started<');
    expect(markup).toContain('&quot;isAuthenticated&quot;:false');
    expect(markup).toContain('&quot;resumePlanId&quot;:null');
  });

  it('passes authenticated billing context into the pricing cards and switches CTA copy', async () => {
    mocks.getAuth.mockResolvedValue({
      userId: 'user_123',
      email: 'admin@tabulate-ai.com',
      name: 'Admin User',
      orgId: 'org_123',
      orgName: 'TabulateAI',
      role: 'admin',
      isBypass: false,
    });
    mocks.syncAuthToConvex.mockResolvedValue({ orgId: 'convex-org', userId: 'convex-user' });
    mocks.queryInternal
      .mockResolvedValueOnce({ role: 'admin' })
      .mockResolvedValueOnce({ status: 'active', plan: 'starter' });

    const { default: PricingPage } = await import('@/app/(marketing)/pricing/page');

    const markup = renderToStaticMarkup(
      await PricingPage({
        searchParams: Promise.resolve({ checkoutPlan: 'professional' }),
      }),
    );

    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain('>Dashboard<');
    expect(markup).toContain('&quot;isAuthenticated&quot;:true');
    expect(markup).toContain('&quot;canManageBilling&quot;:true');
    expect(markup).toContain('&quot;hasActiveSubscription&quot;:true');
    expect(markup).toContain('&quot;currentPlanId&quot;:&quot;starter&quot;');
    expect(markup).toContain('&quot;resumePlanId&quot;:&quot;professional&quot;');
  });
});
