import { buildRequestAccessPath } from '@/lib/accessRequests';
import { PLAN_ORDER, type PlanId } from './plans';

export const PRICING_CHECKOUT_PLAN_PARAM = 'checkoutPlan';
export const PRICING_RESUME_CHECKOUT_PARAM = 'resumeCheckout';

export function parsePlanId(value: string | null | undefined): PlanId | null {
  if (!value) return null;
  return PLAN_ORDER.includes(value as PlanId) ? (value as PlanId) : null;
}

export function buildPricingCheckoutReturnPath(planId: PlanId): string {
  const searchParams = new URLSearchParams({
    [PRICING_CHECKOUT_PLAN_PARAM]: planId,
    [PRICING_RESUME_CHECKOUT_PARAM]: '1',
  });

  return `/pricing?${searchParams.toString()}`;
}

export type PricingPlanAction =
  | 'request_access'
  | 'sign_in'
  | 'checkout'
  | 'manage_billing'
  | 'contact_admin'
  | 'current_plan';

export interface PricingPlanUiState {
  action: PricingPlanAction;
  ctaLabel: string;
  ctaHref: string | null;
  disabled: boolean;
}

export function getPricingPlanUiState({
  planId,
  isAuthenticated,
  canManageBilling,
  hasActiveSubscription,
  currentPlanId,
}: {
  planId: PlanId;
  isAuthenticated: boolean;
  canManageBilling: boolean;
  hasActiveSubscription: boolean;
  currentPlanId: PlanId | null;
}): PricingPlanUiState {
  if (!isAuthenticated) {
    return {
      action: 'request_access',
      ctaLabel: 'Request Access',
      ctaHref: buildRequestAccessPath('pricing'),
      disabled: false,
    };
  }

  if (!canManageBilling) {
    return {
      action: 'contact_admin',
      ctaLabel: 'Admin Required',
      ctaHref: null,
      disabled: false,
    };
  }

  if (hasActiveSubscription) {
    if (currentPlanId === planId) {
      return {
        action: 'current_plan',
        ctaLabel: 'Current Plan',
        ctaHref: null,
        disabled: true,
      };
    }

    return {
      action: 'manage_billing',
      ctaLabel: 'Manage Billing',
      ctaHref: '/settings',
      disabled: false,
    };
  }

  return {
    action: 'checkout',
    ctaLabel: planId === 'payg' ? 'Start Plan' : 'Subscribe',
    ctaHref: null,
    disabled: false,
  };
}

export function getPricingPagePrimaryCta({
  isAuthenticated,
  canManageBilling,
  hasActiveSubscription,
}: {
  isAuthenticated: boolean;
  canManageBilling: boolean;
  hasActiveSubscription: boolean;
}): { href: string; label: string } {
  if (isAuthenticated && hasActiveSubscription) {
    return { href: '/dashboard', label: 'Dashboard' };
  }

  if (isAuthenticated && canManageBilling) {
    return { href: '#pricing-plans', label: 'Choose a Plan' };
  }

  if (isAuthenticated) {
    return { href: '/dashboard', label: 'View Workspace' };
  }

  return { href: buildRequestAccessPath('pricing'), label: 'Request Access' };
}

export function getProductEntryCta({
  canCreateProject,
  hasActiveSubscription,
}: {
  canCreateProject: boolean;
  hasActiveSubscription: boolean;
}): { href: string; label: string } | null {
  if (!canCreateProject) return null;

  if (hasActiveSubscription) {
    return { href: '/projects/new', label: 'New Project' };
  }

  return { href: '/pricing', label: 'Choose Plan' };
}
