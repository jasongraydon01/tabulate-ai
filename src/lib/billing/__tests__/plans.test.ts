import { describe, it, expect } from 'vitest';
import {
  PLANS,
  PLAN_ORDER,
  getPlan,
  getOverageCost,
  getSmartUpgradeBreakpoint,
  getTotalCost,
  formatPrice,
  getEffectiveCostPerProject,
  getPlanIdFromStripePriceId,
  STRIPE_METER_EVENT_NAME,
  getStripeMeterId,
} from '../plans';
import type { PlanId } from '../plans';

describe('plans', () => {
  describe('PLANS config', () => {
    it('defines all four tiers', () => {
      expect(Object.keys(PLANS)).toEqual(['payg', 'starter', 'professional', 'studio']);
    });

    it('has ascending monthly prices', () => {
      for (let i = 1; i < PLAN_ORDER.length; i++) {
        const prev = PLANS[PLAN_ORDER[i - 1]];
        const curr = PLANS[PLAN_ORDER[i]];
        expect(curr.monthlyPrice).toBeGreaterThan(prev.monthlyPrice);
      }
    });

    it('has descending overage rates (higher tiers = cheaper overages)', () => {
      for (let i = 1; i < PLAN_ORDER.length; i++) {
        const prev = PLANS[PLAN_ORDER[i - 1]];
        const curr = PLANS[PLAN_ORDER[i]];
        expect(curr.overageRate).toBeLessThan(prev.overageRate);
      }
    });

    it('has ascending project limits', () => {
      for (let i = 1; i < PLAN_ORDER.length; i++) {
        const prev = PLANS[PLAN_ORDER[i - 1]];
        const curr = PLANS[PLAN_ORDER[i]];
        expect(curr.projectLimit).toBeGreaterThan(prev.projectLimit);
      }
    });
  });

  describe('getPlan', () => {
    it('returns config for valid plan IDs', () => {
      expect(getPlan('payg').name).toBe('Pay-As-You-Go');
      expect(getPlan('starter').name).toBe('Starter');
      expect(getPlan('studio').projectLimit).toBe(60);
    });

    it('throws for invalid plan ID', () => {
      expect(() => getPlan('nonexistent' as PlanId)).toThrow('Unknown plan');
    });
  });

  describe('getOverageCost', () => {
    it('returns 0 when usage is within limit', () => {
      expect(getOverageCost('starter', 0)).toBe(0);
      expect(getOverageCost('starter', 3)).toBe(0);
      expect(getOverageCost('starter', 5)).toBe(0);
    });

    it('calculates overage for usage beyond limit', () => {
      // Starter: 5 projects included, $185 per overage
      expect(getOverageCost('starter', 6)).toBe(18_500);      // 1 over
      expect(getOverageCost('starter', 10)).toBe(18_500 * 5);  // 5 over
    });

    it('calculates correctly for each subscription tier', () => {
      expect(getOverageCost('professional', 21)).toBe(13_500);  // 1 over
      expect(getOverageCost('studio', 62)).toBe(11_000 * 2);    // 2 over
    });

    it('calculates PAYG correctly (every project is usage)', () => {
      expect(getOverageCost('payg', 0)).toBe(0);
      expect(getOverageCost('payg', 1)).toBe(20_000);
      expect(getOverageCost('payg', 5)).toBe(20_000 * 5);
    });
  });

  describe('getSmartUpgradeBreakpoint', () => {
    it('returns null for Studio (highest tier)', () => {
      expect(getSmartUpgradeBreakpoint('studio')).toBeNull();
    });

    it('calculates PAYG → Starter breakpoint', () => {
      const result = getSmartUpgradeBreakpoint('payg');
      expect(result).not.toBeNull();
      expect(result!.nextPlan).toBe('starter');

      // At this project count, PAYG cost should exceed Starter base
      const { projectCount } = result!;
      const totalAtBreakpoint = getTotalCost('payg', projectCount);
      const starterBase = PLANS.starter.monthlyPrice;
      expect(totalAtBreakpoint).toBeGreaterThan(starterBase);

      // One project less should still be cheaper on PAYG
      const totalBelow = getTotalCost('payg', projectCount - 1);
      expect(totalBelow).toBeLessThanOrEqual(starterBase);
    });

    it('calculates Starter → Professional breakpoint', () => {
      const result = getSmartUpgradeBreakpoint('starter');
      expect(result).not.toBeNull();
      expect(result!.nextPlan).toBe('professional');

      const { projectCount } = result!;
      const totalAtBreakpoint = getTotalCost('starter', projectCount);
      const professionalBase = PLANS.professional.monthlyPrice;
      expect(totalAtBreakpoint).toBeGreaterThan(professionalBase);

      const totalBelow = getTotalCost('starter', projectCount - 1);
      expect(totalBelow).toBeLessThanOrEqual(professionalBase);
    });

    it('calculates Professional → Studio breakpoint', () => {
      const result = getSmartUpgradeBreakpoint('professional');
      expect(result).not.toBeNull();
      expect(result!.nextPlan).toBe('studio');

      const { projectCount } = result!;
      const totalAtBreakpoint = getTotalCost('professional', projectCount);
      expect(totalAtBreakpoint).toBeGreaterThan(PLANS.studio.monthlyPrice);
    });

    it('breakpoints match expected values', () => {
      // PAYG → Starter: 5 projects ($1,000 > $849)
      expect(getSmartUpgradeBreakpoint('payg')!.projectCount).toBe(5);
      // Starter → Professional: ceil((199900-84900)/18500) + 5 = ceil(6.216) + 5 = 12
      expect(getSmartUpgradeBreakpoint('starter')!.projectCount).toBe(12);
      // Professional → Studio: ceil((499900-199900)/13500) + 20 = ceil(22.222) + 20 = 43
      expect(getSmartUpgradeBreakpoint('professional')!.projectCount).toBe(43);
    });
  });

  describe('getTotalCost', () => {
    it('returns base price when at or below limit', () => {
      expect(getTotalCost('starter', 5)).toBe(84_900);
      expect(getTotalCost('professional', 0)).toBe(199_900);
    });

    it('adds overages beyond limit', () => {
      expect(getTotalCost('starter', 7)).toBe(84_900 + 18_500 * 2);
    });

    it('calculates PAYG cost (no base, all usage)', () => {
      expect(getTotalCost('payg', 0)).toBe(0);
      expect(getTotalCost('payg', 3)).toBe(20_000 * 3);
    });
  });

  describe('getEffectiveCostPerProject', () => {
    it('returns per-project rate for PAYG', () => {
      expect(getEffectiveCostPerProject('payg')).toBe(20_000);
    });

    it('returns monthly price divided by limit for subscription plans', () => {
      expect(getEffectiveCostPerProject('starter')).toBe(Math.round(84_900 / 5));
    });
  });

  describe('formatPrice', () => {
    it('formats whole dollar amounts', () => {
      expect(formatPrice(84_900)).toBe('$849');
      expect(formatPrice(199_900)).toBe('$1,999');
    });

    it('formats amounts with cents', () => {
      expect(formatPrice(69_950)).toBe('$699.50');
    });

    it('formats zero', () => {
      expect(formatPrice(0)).toBe('$0');
    });
  });

  describe('Stripe Meter config', () => {
    it('exports meter event name', () => {
      expect(STRIPE_METER_EVENT_NAME).toBe('crosstab_project_created');
    });

    it('getStripeMeterId throws when env var is not set', () => {
      expect(() => getStripeMeterId()).toThrow('STRIPE_METER_ID is not set');
    });
  });

  describe('getPlanIdFromStripePriceId', () => {
    it('matches recurring and metered price IDs', () => {
      process.env.STRIPE_PRICE_PAYG = 'price_payg';
      process.env.STRIPE_PRICE_PAYG_METERED = 'price_payg_metered';
      process.env.STRIPE_PRICE_STARTER = 'price_starter';
      process.env.STRIPE_PRICE_STARTER_METERED = 'price_starter_metered';
      process.env.STRIPE_PRICE_PROFESSIONAL = 'price_professional';
      process.env.STRIPE_PRICE_PROFESSIONAL_METERED = 'price_professional_metered';

      expect(getPlanIdFromStripePriceId('price_payg')).toBe('payg');
      expect(getPlanIdFromStripePriceId('price_payg_metered')).toBe('payg');
      expect(getPlanIdFromStripePriceId('price_starter')).toBe('starter');
      expect(getPlanIdFromStripePriceId('price_professional_metered')).toBe('professional');
    });

    it('returns null for unknown price IDs', () => {
      expect(getPlanIdFromStripePriceId('price_unknown')).toBeNull();
    });
  });
});
