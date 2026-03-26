import { describe, expect, it } from 'vitest';
import {
  buildSignInPath,
  encodeAuthReturnState,
  getMarketingPrimaryCta,
  sanitizeRelativeReturnTo,
} from '@/lib/navigation';

describe('navigation helpers', () => {
  it('sanitizes unsafe return paths', () => {
    expect(sanitizeRelativeReturnTo(null)).toBe('/dashboard');
    expect(sanitizeRelativeReturnTo('https://tabulate-ai.com/pricing')).toBe('/dashboard');
    expect(sanitizeRelativeReturnTo('//evil.test')).toBe('/dashboard');
    expect(sanitizeRelativeReturnTo('/pricing?checkoutPlan=starter')).toBe('/pricing?checkoutPlan=starter');
  });

  it('builds sign-in paths with encoded return destinations', () => {
    expect(buildSignInPath('/pricing?checkoutPlan=starter')).toBe(
      '/auth/sign-in?returnTo=%2Fpricing%3FcheckoutPlan%3Dstarter',
    );
  });

  it('encodes auth return state in the format expected by the auth callback', () => {
    const encoded = encodeAuthReturnState('/pricing?checkoutPlan=starter');
    const decoded = JSON.parse(Buffer.from(encoded.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    expect(decoded).toEqual({ returnPathname: '/pricing?checkoutPlan=starter' });
  });

  it('returns the correct marketing CTA for auth state', () => {
    expect(getMarketingPrimaryCta(false)).toEqual({
      href: '/auth/sign-in?returnTo=%2Fdashboard',
      label: 'Get Started',
    });
    expect(getMarketingPrimaryCta(true)).toEqual({
      href: '/dashboard',
      label: 'Dashboard',
    });
  });
});
