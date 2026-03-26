import { describe, expect, it } from 'vitest';
import {
  buildPricingCheckoutReturnPath,
  getPricingPlanUiState,
  getProductEntryCta,
  parsePlanId,
} from '@/lib/billing/pricingFlow';

describe('pricing flow helpers', () => {
  it('parses valid plan ids and rejects unknown values', () => {
    expect(parsePlanId('starter')).toBe('starter');
    expect(parsePlanId('unknown')).toBeNull();
    expect(parsePlanId(null)).toBeNull();
  });

  it('builds a resume-checkout pricing return path', () => {
    expect(buildPricingCheckoutReturnPath('professional')).toBe(
      '/pricing?checkoutPlan=professional&resumeCheckout=1',
    );
  });

  it('routes unauthenticated users to sign-in with preserved pricing intent', () => {
    expect(
      getPricingPlanUiState({
        planId: 'starter',
        isAuthenticated: false,
        canManageBilling: false,
        hasActiveSubscription: false,
        currentPlanId: null,
      }),
    ).toEqual({
      action: 'sign_in',
      ctaLabel: 'Get Started',
      ctaHref: '/auth/sign-in?returnTo=%2Fpricing%3FcheckoutPlan%3Dstarter%26resumeCheckout%3D1',
      disabled: false,
    });
  });

  it('blocks non-admin billing actions for authenticated members', () => {
    expect(
      getPricingPlanUiState({
        planId: 'starter',
        isAuthenticated: true,
        canManageBilling: false,
        hasActiveSubscription: false,
        currentPlanId: null,
      }),
    ).toEqual({
      action: 'contact_admin',
      ctaLabel: 'Admin Required',
      ctaHref: null,
      disabled: false,
    });
  });

  it('prevents duplicate checkout for the current active plan', () => {
    expect(
      getPricingPlanUiState({
        planId: 'starter',
        isAuthenticated: true,
        canManageBilling: true,
        hasActiveSubscription: true,
        currentPlanId: 'starter',
      }),
    ).toEqual({
      action: 'current_plan',
      ctaLabel: 'Current Plan',
      ctaHref: null,
      disabled: true,
    });
  });

  it('routes subscribed admins to billing management for plan changes', () => {
    expect(
      getPricingPlanUiState({
        planId: 'professional',
        isAuthenticated: true,
        canManageBilling: true,
        hasActiveSubscription: true,
        currentPlanId: 'starter',
      }),
    ).toEqual({
      action: 'manage_billing',
      ctaLabel: 'Manage Billing',
      ctaHref: '/settings',
      disabled: false,
    });
  });

  it('starts checkout for admins without an active plan', () => {
    expect(
      getPricingPlanUiState({
        planId: 'payg',
        isAuthenticated: true,
        canManageBilling: true,
        hasActiveSubscription: false,
        currentPlanId: null,
      }),
    ).toEqual({
      action: 'checkout',
      ctaLabel: 'Start Plan',
      ctaHref: null,
      disabled: false,
    });
  });

  it('returns product creation CTA based on billing state', () => {
    expect(getProductEntryCta({ canCreateProject: true, hasActiveSubscription: true })).toEqual({
      href: '/projects/new',
      label: 'New Project',
    });
    expect(getProductEntryCta({ canCreateProject: true, hasActiveSubscription: false })).toEqual({
      href: '/pricing',
      label: 'Choose Plan',
    });
    expect(getProductEntryCta({ canCreateProject: false, hasActiveSubscription: false })).toBeNull();
  });
});
