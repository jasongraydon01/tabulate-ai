import { describe, expect, it } from 'vitest';
import {
  buildRequestAccessPath,
  extractEmailDomain,
  isFreeEmailDomain,
  normalizeEmail,
  parseAccessRequestSource,
} from '@/lib/accessRequests';

describe('access request helpers', () => {
  it('normalizes email addresses and extracts work domains', () => {
    expect(normalizeEmail(' Person@Company.COM ')).toBe('person@company.com');
    expect(extractEmailDomain('person@company.com')).toBe('company.com');
    expect(extractEmailDomain('invalid-email')).toBeNull();
  });

  it('flags common free-email providers', () => {
    expect(isFreeEmailDomain('gmail.com')).toBe(true);
    expect(isFreeEmailDomain('company.com')).toBe(false);
  });

  it('builds request-access paths with source and demo token', () => {
    expect(buildRequestAccessPath('pricing')).toBe('/request-access?source=pricing');
    expect(buildRequestAccessPath('demo_status', { demoToken: 'abc123' })).toBe(
      '/request-access?source=demo_status&demoToken=abc123',
    );
  });

  it('parses known sources and falls back to marketing', () => {
    expect(parseAccessRequestSource('auth_no_org')).toBe('auth_no_org');
    expect(parseAccessRequestSource('unknown')).toBe('marketing');
    expect(parseAccessRequestSource(null)).toBe('marketing');
  });
});
