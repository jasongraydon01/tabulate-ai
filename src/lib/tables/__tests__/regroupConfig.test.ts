import { describe, expect, it } from 'vitest';
import { DEFAULT_REGROUP_CONFIG, resolveRegroupConfig } from '../regroupConfig';

describe('regroupConfig resolver', () => {
  it('applies precedence run > project > env > defaults', () => {
    const result = resolveRegroupConfig({
      env: {
        REGROUP_MIN_SIBLINGS: '4',
        REGROUP_MIN_AXIS_MARGIN: '0.2',
      },
      projectOverride: {
        minSiblings: 5,
      },
      runOverride: {
        minSiblings: 6,
      },
    });

    expect(result.config.minSiblings).toBe(6);
    expect(result.config.minAxisMargin).toBe(0.2);
  });

  it('parses env booleans, numbers, and comma-separated lists', () => {
    const result = resolveRegroupConfig({
      env: {
        REGROUP_ENABLED: 'false',
        REGROUP_MIN_SIBLINGS: '7',
        REGROUP_ALLOWED_SUFFIX_PATTERNS: '^r\\d+$,^c\\d+$',
        REGROUP_BLOCK_FAMILY_PATTERNS: '^D1$,^D2$',
      },
    });

    expect(result.config.enabled).toBe(false);
    expect(result.config.minSiblings).toBe(7);
    expect(result.config.allowedSuffixPatterns).toEqual(['^r\\d+$', '^c\\d+$']);
    expect(result.config.blockFamilyPatterns).toEqual(['^D1$', '^D2$']);
  });

  it('falls back to lower precedence/default on invalid env values', () => {
    const result = resolveRegroupConfig({
      env: {
        REGROUP_MIN_SIBLINGS: 'not-a-number',
        REGROUP_ENABLED: 'not-bool',
      },
      projectOverride: {
        minSiblings: 9,
      },
    });

    expect(result.config.minSiblings).toBe(9);
    expect(result.config.enabled).toBe(DEFAULT_REGROUP_CONFIG.enabled);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
