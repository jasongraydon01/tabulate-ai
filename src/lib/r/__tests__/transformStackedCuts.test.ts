import { describe, it, expect } from 'vitest';
import { transformCutForAlias } from '../transformStackedCuts';

// =============================================================================
// Basic transformations
// =============================================================================

describe('transformCutForAlias', () => {
  it('transforms simple OR expression with == comparison', () => {
    const result = transformCutForAlias(
      '(S10a == 1 | S11a == 1)',
      ['S10a', 'S11a'],
      '.hawktab_ns',
    );
    expect(result).toBe('.hawktab_ns == 1');
  });

  it('transforms %in% expression', () => {
    const result = transformCutForAlias(
      'S10a %in% c(1,2) | S11a %in% c(1,2)',
      ['S10a', 'S11a'],
      '.hawktab_ns',
    );
    expect(result).toBe('.hawktab_ns %in% c(1,2)');
  });

  it('preserves non-iteration variables in mixed expressions', () => {
    const result = transformCutForAlias(
      '(S10a == 1 | S11a == 1) & S6 == 1',
      ['S10a', 'S11a'],
      '.hawktab_ns',
    );
    expect(result).toBe('.hawktab_ns == 1 & S6 == 1');
  });

  it('returns unchanged if no source variables are referenced', () => {
    const result = transformCutForAlias(
      'S9r1 == 1',
      ['S10a', 'S11a'],
      '.hawktab_ns',
    );
    expect(result).toBe('S9r1 == 1');
  });

  it('returns unchanged for empty expression', () => {
    const result = transformCutForAlias('', ['S10a'], '.hawktab_ns');
    expect(result).toBe('');
  });

  it('returns unchanged for empty source variables', () => {
    const result = transformCutForAlias('S10a == 1', [], '.hawktab_ns');
    expect(result).toBe('S10a == 1');
  });

  it('returns unchanged for empty alias name', () => {
    const result = transformCutForAlias('S10a == 1', ['S10a'], '');
    expect(result).toBe('S10a == 1');
  });
});

// =============================================================================
// Deduplication
// =============================================================================

describe('OR branch deduplication', () => {
  it('deduplicates identical branches after replacement', () => {
    const result = transformCutForAlias(
      '(S10a == 3 | S11a == 3)',
      ['S10a', 'S11a'],
      '.hawktab_ns',
    );
    // After replacement: (.hawktab_ns == 3 | .hawktab_ns == 3) -> .hawktab_ns == 3
    expect(result).toBe('.hawktab_ns == 3');
  });

  it('keeps non-duplicate branches', () => {
    // Edge case: one source var matches, other doesn't
    const result = transformCutForAlias(
      'S10a == 1 | S6 == 2',
      ['S10a', 'S11a'],
      '.hawktab_ns',
    );
    expect(result).toBe('.hawktab_ns == 1 | S6 == 2');
  });
});

// =============================================================================
// Word boundary matching
// =============================================================================

describe('Word boundary matching', () => {
  it('does not match partial variable names', () => {
    // S10a should not match S10ab
    const result = transformCutForAlias(
      'S10ab == 1',
      ['S10a'],
      '.hawktab_ns',
    );
    expect(result).toBe('S10ab == 1');
  });

  it('does not match variable names as substrings', () => {
    // S10a should not match dS10a (different variable)
    const result = transformCutForAlias(
      'dS10a == 1',
      ['S10a'],
      '.hawktab_ns',
    );
    // dS10a is not the same variable as S10a (different word boundary at start)
    expect(result).toBe('dS10a == 1');
  });
});

// =============================================================================
// Three-iteration case
// =============================================================================

describe('Three iterations', () => {
  it('handles 3 source variables', () => {
    const result = transformCutForAlias(
      '(BA1 == 1 | BA2 == 1 | BA3 == 1)',
      ['BA1', 'BA2', 'BA3'],
      '.hawktab_brand_attitude',
    );
    expect(result).toBe('.hawktab_brand_attitude == 1');
  });
});
