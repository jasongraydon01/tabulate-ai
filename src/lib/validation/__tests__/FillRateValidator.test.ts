import { describe, it, expect } from 'vitest';
import { classifyLoopFillRates } from '../FillRateValidator';
import type { LoopGroup } from '../types';

// Helper to create a mock loop group
function mockLoopGroup(iterations: string[], baseCount: number = 10): LoopGroup {
  const variables: string[] = [];
  const bases: string[] = [];
  for (let q = 1; q <= baseCount; q++) {
    bases.push(`A${q}_*`);
    for (const iter of iterations) {
      variables.push(`A${q}_${iter}`);
    }
  }
  return {
    skeleton: 'A-N-_-N',
    iteratorPosition: 3,
    iterations,
    bases,
    variables,
    diversity: baseCount,
  };
}

describe('FillRateValidator', () => {
  describe('classifyLoopFillRates', () => {
    it('detects valid_wide pattern (similar fill rates)', () => {
      const group = mockLoopGroup(['1', '2', '3']);
      const fillRates: Record<string, number> = {};

      // All iterations ~90% fill
      for (const v of group.variables) {
        fillRates[v] = 0.85 + Math.random() * 0.1;
      }

      const result = classifyLoopFillRates(group, fillRates);
      expect(result.pattern).toBe('valid_wide');
      expect(result.explanation).toContain('valid wide');
    });

    it('detects likely_stacked pattern (first full, rest empty)', () => {
      const group = mockLoopGroup(['1', '2', '3']);
      const fillRates: Record<string, number> = {};

      for (const v of group.variables) {
        if (v.endsWith('_1')) {
          fillRates[v] = 0.95;
        } else {
          fillRates[v] = 0.001;
        }
      }

      const result = classifyLoopFillRates(group, fillRates);
      expect(result.pattern).toBe('likely_stacked');
      expect(result.explanation).toContain('stacked');
    });

    it('detects expected_dropout pattern (decreasing rates)', () => {
      const group = mockLoopGroup(['1', '2', '3', '4']);
      const fillRates: Record<string, number> = {};

      for (const v of group.variables) {
        if (v.endsWith('_1')) fillRates[v] = 0.95;
        else if (v.endsWith('_2')) fillRates[v] = 0.70;
        else if (v.endsWith('_3')) fillRates[v] = 0.45;
        else if (v.endsWith('_4')) fillRates[v] = 0.25;
      }

      const result = classifyLoopFillRates(group, fillRates);
      expect(result.pattern).toBe('expected_dropout');
      expect(result.explanation).toContain('dropout');
    });

    it('returns uncertain for ambiguous patterns', () => {
      const group = mockLoopGroup(['1', '2', '3']);
      const fillRates: Record<string, number> = {};

      // Random/inconsistent fill rates
      for (const v of group.variables) {
        if (v.endsWith('_1')) fillRates[v] = 0.30;
        else if (v.endsWith('_2')) fillRates[v] = 0.90;
        else if (v.endsWith('_3')) fillRates[v] = 0.50;
      }

      const result = classifyLoopFillRates(group, fillRates);
      expect(result.pattern).toBe('uncertain');
    });

    it('handles missing fill rate data gracefully', () => {
      const group = mockLoopGroup(['1', '2']);
      // Empty fill rates - no data available
      const fillRates: Record<string, number> = {};

      const result = classifyLoopFillRates(group, fillRates);
      // Should not throw, should return uncertain
      expect(['uncertain', 'likely_stacked']).toContain(result.pattern);
    });

    it('includes per-iteration fill rates in result', () => {
      const group = mockLoopGroup(['1', '2']);
      const fillRates: Record<string, number> = {};
      for (const v of group.variables) {
        fillRates[v] = v.endsWith('_1') ? 0.9 : 0.85;
      }

      const result = classifyLoopFillRates(group, fillRates);
      expect(result.fillRates).toBeDefined();
      expect(result.fillRates['1']).toBeGreaterThan(0);
      expect(result.fillRates['2']).toBeGreaterThan(0);
    });
  });
});
