import { describe, expect, it } from 'vitest';
import { parseExpression } from '@/lib/exportData/expression';

describe('export expression parser', () => {
  it('parses and normalizes supported subset expressions', () => {
    const parsed = parseExpression("!(Q1 == 1 | SEG %in% c('A', 'B')) & BRAND != 'X'");

    expect(parsed.ok).toBe(true);
    expect(parsed.parsed?.normalized).toBe("!(Q1 == 1 | SEG %in% c('A', 'B')) & BRAND != 'X'");
    expect(parsed.parsed?.analysis.hasNegation).toBe(true);
    expect(parsed.parsed?.analysis.hasInOperator).toBe(true);
    expect(parsed.parsed?.analysis.functionCalls).toEqual(['c']);
    expect(parsed.parsed?.fingerprint).toHaveLength(64);
  });

  it('flags cross-variable comparisons in analysis', () => {
    const parsed = parseExpression('Q1 == Q2');
    expect(parsed.ok).toBe(true);
    expect(parsed.parsed?.analysis.hasComparisonBetweenVariables).toBe(true);
  });

  it('blocks unsupported syntax', () => {
    const parsed = parseExpression('Q1 ~= 1');
    expect(parsed.ok).toBe(false);
    expect(parsed.error).toContain('Unsupported token');
  });
});
