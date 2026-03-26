import { describe, it, expect } from 'vitest';
import { getPendingBillingNotificationKinds } from '../notifications';

describe('getPendingBillingNotificationKinds', () => {
  it('sends near-limit alert at 80% usage', () => {
    expect(
      getPendingBillingNotificationKinds({
        orgId: 'org_1',
        plan: 'starter',
        projectsUsed: 4,
        projectLimit: 5,
        overageRate: 18_500,
      }),
    ).toContain('near_limit');
  });

  it('sends overage and upgrade alerts once thresholds are crossed', () => {
    expect(
      getPendingBillingNotificationKinds({
        orgId: 'org_1',
        plan: 'starter',
        projectsUsed: 12,
        projectLimit: 5,
        overageRate: 18_500,
      }),
    ).toEqual(expect.arrayContaining(['overage', 'upgrade_suggestion']));
  });

  it('does not resend alerts already recorded for the cycle', () => {
    expect(
      getPendingBillingNotificationKinds({
        orgId: 'org_1',
        plan: 'starter',
        projectsUsed: 12,
        projectLimit: 5,
        overageRate: 18_500,
        billingNotifications: {
          nearLimitSentAt: 1,
          overageSentAt: 2,
          upgradeSuggestionSentAt: 3,
        },
      }),
    ).toEqual([]);
  });

  it('skips near_limit and overage for PAYG (no project limit)', () => {
    const kinds = getPendingBillingNotificationKinds({
      orgId: 'org_1',
      plan: 'payg',
      projectsUsed: 10,
      projectLimit: 0,
      overageRate: 20_000,
    });

    expect(kinds).not.toContain('near_limit');
    expect(kinds).not.toContain('overage');
  });

  it('sends upgrade_suggestion for PAYG when Starter would be cheaper', () => {
    // PAYG → Starter breakpoint is 5 projects
    const kinds = getPendingBillingNotificationKinds({
      orgId: 'org_1',
      plan: 'payg',
      projectsUsed: 5,
      projectLimit: 0,
      overageRate: 20_000,
    });

    expect(kinds).toContain('upgrade_suggestion');
  });
});
