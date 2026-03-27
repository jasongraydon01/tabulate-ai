import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getInternalAccessDomains,
  isInternalAccessUser,
  isInternalOperator,
} from '@/lib/internalOperators';

describe('internal operator and access helpers', () => {
  const originalOps = process.env.INTERNAL_OPS_ALLOWLIST;
  const originalDomains = process.env.INTERNAL_ACCESS_DOMAINS;
  const originalFrom = process.env.RESEND_FROM_ADDRESS;

  afterEach(() => {
    process.env.INTERNAL_OPS_ALLOWLIST = originalOps;
    process.env.INTERNAL_ACCESS_DOMAINS = originalDomains;
    process.env.RESEND_FROM_ADDRESS = originalFrom;
    vi.resetModules();
  });

  it('matches operators by exact email allowlist', () => {
    process.env.INTERNAL_OPS_ALLOWLIST = 'ops@tabulate-ai.com';
    expect(isInternalOperator('ops@tabulate-ai.com')).toBe(true);
    expect(isInternalOperator('other@tabulate-ai.com')).toBe(false);
  });

  it('matches internal access by configured domain', () => {
    process.env.INTERNAL_ACCESS_DOMAINS = 'tabulate-ai.com';
    expect(isInternalAccessUser('person@tabulate-ai.com')).toBe(true);
    expect(isInternalAccessUser('person@example.com')).toBe(false);
  });

  it('falls back to the Resend domain when no explicit access domains are set', () => {
    delete process.env.INTERNAL_ACCESS_DOMAINS;
    process.env.RESEND_FROM_ADDRESS = 'TabulateAI <notifications@tabulate-ai.com>';
    expect(getInternalAccessDomains()).toEqual(['tabulate-ai.com']);
    expect(isInternalAccessUser('person@tabulate-ai.com')).toBe(true);
  });
});
