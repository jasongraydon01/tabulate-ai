import { describe, it, expect } from 'vitest';
import { normalizeNumericArray } from '../enricher';

describe('normalizeNumericArray', () => {
  it('accepts consecutive values with a trailing non-substantive tail code', () => {
    const labelByValue = new Map([
      [98, "Don't Know"],
    ]);
    expect(normalizeNumericArray([1, 2, 3, 4, 5, 6, 7, 98], labelByValue)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('accepts multiple trailing non-substantive tail codes', () => {
    const labelByValue = new Map([
      [98, "Don't Know"],
      [99, 'Refused'],
    ]);
    expect(normalizeNumericArray([1, 2, 3, 4, 5, 6, 7, 98, 99], labelByValue)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('rejects substantive tail codes that break consecutiveness', () => {
    const labelByValue = new Map([
      [12, 'Other'],
    ]);
    expect(normalizeNumericArray([1, 2, 3, 4, 5, 6, 7, 12], labelByValue)).toBeNull();
  });

  it('still rejects short scales after stripping a non-substantive tail', () => {
    const labelByValue = new Map([
      [98, "Don't Know"],
    ]);
    expect(normalizeNumericArray([1, 2, 3, 4, 98], labelByValue)).toBeNull();
  });
});
