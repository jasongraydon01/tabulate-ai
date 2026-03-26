// ---------------------------------------------------------------------------
// Plan configuration — single source of truth for tier details
// ---------------------------------------------------------------------------
// Prices are in cents (Stripe convention). Used by pricing page, quota checks,
// overage calculations, and checkout session creation.

export type PlanId = 'payg' | 'starter' | 'professional' | 'studio';

export interface PlanConfig {
  name: string;
  monthlyPrice: number;   // cents
  projectLimit: number;
  overageRate: number;     // cents per overage project
  description: string;     // one-liner for pricing page
}

export const PLANS: Record<PlanId, PlanConfig> = {
  payg: {
    name: 'Pay-As-You-Go',
    monthlyPrice: 0,
    projectLimit: 0,
    overageRate: 20_000,
    description: 'No commitment. Pay per project, no subscription required.',
  },
  starter: {
    name: 'Starter',
    monthlyPrice: 84_900,
    projectLimit: 5,
    overageRate: 18_500,
    description: 'For teams with a steady flow of research projects.',
  },
  professional: {
    name: 'Professional',
    monthlyPrice: 199_900,
    projectLimit: 20,
    overageRate: 13_500,
    description: 'For teams managing multiple studies at once.',
  },
  studio: {
    name: 'Studio',
    monthlyPrice: 499_900,
    projectLimit: 60,
    overageRate: 11_000,
    description: 'For research groups running projects at scale.',
  },
} as const;

/** Ordered list of plan IDs from lowest to highest tier. */
export const PLAN_ORDER: PlanId[] = ['payg', 'starter', 'professional', 'studio'];

/**
 * Get plan config by ID. Throws on invalid ID.
 */
export function getPlan(planId: PlanId): PlanConfig {
  const plan = PLANS[planId];
  if (!plan) throw new Error(`Unknown plan: ${planId}`);
  return plan;
}

/**
 * Calculate total overage cost for projects used beyond the plan limit.
 * Returns 0 if usage is within the limit.
 */
export function getOverageCost(planId: PlanId, projectsUsed: number): number {
  const plan = getPlan(planId);
  const overageCount = Math.max(0, projectsUsed - plan.projectLimit);
  return overageCount * plan.overageRate;
}

/**
 * Get the project count at which upgrading to the next tier saves money.
 * Returns null for Studio (highest tier — no upgrade available).
 *
 * Logic: find the project count where
 *   currentBase + (count - currentLimit) * currentOverage > nextBase
 */
export function getSmartUpgradeBreakpoint(planId: PlanId): { nextPlan: PlanId; projectCount: number } | null {
  const idx = PLAN_ORDER.indexOf(planId);
  if (idx === -1 || idx === PLAN_ORDER.length - 1) return null;

  const current = getPlan(planId);
  const nextPlanId = PLAN_ORDER[idx + 1];
  const next = getPlan(nextPlanId);

  // Solve: currentBase + (n - currentLimit) * overageRate = nextBase
  // n = currentLimit + (nextBase - currentBase) / overageRate
  const overageProjectsToBreakeven = (next.monthlyPrice - current.monthlyPrice) / current.overageRate;
  const projectCount = current.projectLimit + Math.ceil(overageProjectsToBreakeven);

  return { nextPlan: nextPlanId, projectCount };
}

/**
 * Calculate total cost for a given plan and usage level (base + overages).
 */
export function getTotalCost(planId: PlanId, projectsUsed: number): number {
  const plan = getPlan(planId);
  return plan.monthlyPrice + getOverageCost(planId, projectsUsed);
}

/**
 * Format a price in cents to a display string (e.g., 69900 → "$699").
 */
export function formatPrice(cents: number): string {
  const dollars = cents / 100;
  return dollars % 1 === 0 ? `$${dollars.toLocaleString()}` : `$${dollars.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
}

/**
 * Effective cost per project when using the full included allotment.
 * Returns cents (e.g., 16980 for Starter = $169.80/project).
 * For PAYG (no included projects), returns the per-project rate.
 */
export function getEffectiveCostPerProject(planId: PlanId): number {
  const plan = getPlan(planId);
  if (plan.projectLimit === 0) return plan.overageRate;
  return Math.round(plan.monthlyPrice / plan.projectLimit);
}

/** The recommended plan to highlight on the pricing page. */
export const RECOMMENDED_PLAN: PlanId = 'professional';

// ---------------------------------------------------------------------------
// Stripe Meter configuration
// ---------------------------------------------------------------------------
// One shared meter tracks project creation across all tiers. Each plan has
// a graduated metered price linked to this meter:
//   - First N units at $0 (included in the flat fee)
//   - Units beyond N at the tier's overage rate
// Stripe handles aggregation and invoicing automatically.

/** Event name used when reporting project creation to the Stripe Meter. */
export const STRIPE_METER_EVENT_NAME = 'crosstab_project_created';

/**
 * Get the Stripe Meter ID. Throws if not set.
 */
export function getStripeMeterId(): string {
  const value = process.env.STRIPE_METER_ID;
  if (!value) throw new Error('STRIPE_METER_ID is not set');
  return value;
}

// ---------------------------------------------------------------------------
// Stripe price ID getters (read from env vars at runtime)
// ---------------------------------------------------------------------------

const STRIPE_PRICE_ENV_KEYS: Record<PlanId, string> = {
  payg: 'STRIPE_PRICE_PAYG',
  starter: 'STRIPE_PRICE_STARTER',
  professional: 'STRIPE_PRICE_PROFESSIONAL',
  studio: 'STRIPE_PRICE_STUDIO',
};

const STRIPE_METERED_PRICE_ENV_KEYS: Record<PlanId, string> = {
  payg: 'STRIPE_PRICE_PAYG_METERED',
  starter: 'STRIPE_PRICE_STARTER_METERED',
  professional: 'STRIPE_PRICE_PROFESSIONAL_METERED',
  studio: 'STRIPE_PRICE_STUDIO_METERED',
};

function getStripePriceIdIfSet(planId: PlanId): string | null {
  const envKey = STRIPE_PRICE_ENV_KEYS[planId];
  return process.env[envKey] ?? null;
}

function getStripeMeteredPriceIdIfSet(planId: PlanId): string | null {
  const envKey = STRIPE_METERED_PRICE_ENV_KEYS[planId];
  return process.env[envKey] ?? null;
}

/**
 * Get the Stripe price ID for a plan's recurring monthly flat fee.
 * Throws if the env var is not set.
 */
export function getStripePriceId(planId: PlanId): string {
  const envKey = STRIPE_PRICE_ENV_KEYS[planId];
  const value = process.env[envKey];
  if (!value) throw new Error(`${envKey} is not set`);
  return value;
}

/**
 * Get the Stripe price ID for a plan's graduated metered component.
 * This price is linked to the project creation meter and handles
 * the included-then-overage pricing (first N at $0, then $X/unit).
 * Throws if the env var is not set.
 */
export function getStripeMeteredPriceId(planId: PlanId): string {
  const envKey = STRIPE_METERED_PRICE_ENV_KEYS[planId];
  const value = process.env[envKey];
  if (!value) throw new Error(`${envKey} is not set`);
  return value;
}

/**
 * Resolve a plan ID from a Stripe price ID.
 * Matches either the fixed recurring price or the graduated metered price.
 */
export function getPlanIdFromStripePriceId(priceId: string): PlanId | null {
  for (const planId of PLAN_ORDER) {
    if (
      getStripePriceIdIfSet(planId) === priceId ||
      getStripeMeteredPriceIdIfSet(planId) === priceId
    ) {
      return planId;
    }
  }

  return null;
}
