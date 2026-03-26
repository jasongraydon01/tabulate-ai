import { describe, expect, it } from 'vitest';
import { DEFAULT_MAXDIFF_POLICY, resolveMaxDiffPolicy } from '../policy';

describe('resolveMaxDiffPolicy', () => {
  it('uses defaults when no override provided', () => {
    expect(resolveMaxDiffPolicy()).toEqual(DEFAULT_MAXDIFF_POLICY);
  });

  it('clamps invalid split cap to default', () => {
    const policy = resolveMaxDiffPolicy({ maxSplitTablesPerInput: 0 });
    expect(policy.maxSplitTablesPerInput).toBe(DEFAULT_MAXDIFF_POLICY.maxSplitTablesPerInput);
  });
});

