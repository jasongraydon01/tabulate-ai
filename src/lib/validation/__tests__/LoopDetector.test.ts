import { describe, it, expect } from 'vitest';
import { tokenize, createSkeleton, detectLoops } from '../LoopDetector';

describe('LoopDetector', () => {
  describe('tokenize', () => {
    it('tokenizes simple variable A4_1', () => {
      const tokens = tokenize('A4_1');
      expect(tokens).toEqual([
        { type: 'alpha', value: 'A' },
        { type: 'numeric', value: '4' },
        { type: 'separator', value: '_' },
        { type: 'numeric', value: '1' },
      ]);
    });

    it('tokenizes multi-dim variable S13r1c1', () => {
      const tokens = tokenize('S13r1c1');
      expect(tokens).toEqual([
        { type: 'alpha', value: 'S' },
        { type: 'numeric', value: '13' },
        { type: 'alpha', value: 'r' },
        { type: 'numeric', value: '1' },
        { type: 'alpha', value: 'c' },
        { type: 'numeric', value: '1' },
      ]);
    });

    it('tokenizes variable with prefix hA3_1', () => {
      const tokens = tokenize('hA3_1');
      expect(tokens).toEqual([
        { type: 'alpha', value: 'hA' },
        { type: 'numeric', value: '3' },
        { type: 'separator', value: '_' },
        { type: 'numeric', value: '1' },
      ]);
    });

    it('tokenizes plain variable S1', () => {
      const tokens = tokenize('S1');
      expect(tokens).toEqual([
        { type: 'alpha', value: 'S' },
        { type: 'numeric', value: '1' },
      ]);
    });
  });

  describe('createSkeleton', () => {
    it('creates skeleton for A4_1', () => {
      const tokens = tokenize('A4_1');
      expect(createSkeleton(tokens)).toBe('A-N-_-N');
    });

    it('creates skeleton for S13r1c1', () => {
      const tokens = tokenize('S13r1c1');
      expect(createSkeleton(tokens)).toBe('S-N-r-N-c-N');
    });

    it('same skeleton for loop members A4_1 and A4_2', () => {
      const skel1 = createSkeleton(tokenize('A4_1'));
      const skel2 = createSkeleton(tokenize('A4_2'));
      expect(skel1).toBe(skel2);
    });

    it('same skeleton for A1_1 and A18_2', () => {
      const skel1 = createSkeleton(tokenize('A1_1'));
      const skel2 = createSkeleton(tokenize('A18_2'));
      expect(skel1).toBe(skel2);
    });
  });

  describe('detectLoops', () => {
    it('detects underscore-delimited loop pattern: A1_1..A18_1, A1_2..A18_2', () => {
      // Simulate underscore loop: A1_1 through A18_1, then A1_2 through A18_2
      const vars: string[] = [];
      for (let iter = 1; iter <= 2; iter++) {
        for (let q = 1; q <= 18; q++) {
          vars.push(`A${q}_${iter}`);
        }
      }

      const result = detectLoops(vars);
      expect(result.hasLoops).toBe(true);
      expect(result.loops.length).toBe(1);

      const loop = result.loops[0];
      expect(loop.iterations).toEqual(['1', '2']);
      expect(loop.diversity).toBeGreaterThanOrEqual(3);
      expect(loop.variables.length).toBe(36);
    });

    it('rejects grid pattern: S8r1..S8r8 (diversity=1)', () => {
      // S8r1 through S8r8 - single question, NOT a loop
      const vars = Array.from({ length: 8 }, (_, i) => `S8r${i + 1}`);

      const result = detectLoops(vars);
      // Should NOT detect a loop because diversity = 1 (only one base: S8)
      expect(result.hasLoops).toBe(false);
    });

    it('rejects multi-dim grid: S13r1c1, S13r2c1, S13r1c2', () => {
      // Multi-dimensional grid - NOT a loop
      const vars: string[] = [];
      for (let r = 1; r <= 4; r++) {
        for (let c = 1; c <= 3; c++) {
          vars.push(`S13r${r}c${c}`);
        }
      }

      const result = detectLoops(vars);
      // Grid has low diversity per numeric position - should not detect loop
      expect(result.hasLoops).toBe(false);
    });

    it('detects nested loop with r/c dimensions: C2_1r1c1, C2_2r1c1', () => {
      // C2_1r1c1, C2_1r2c1, C2_1r1c2, C2_2r1c1, C2_2r2c1, C2_2r1c2
      // The _1/_2 is the loop iterator, r/c are grid dimensions
      const vars: string[] = [];
      for (let iter = 1; iter <= 3; iter++) {
        for (let r = 1; r <= 2; r++) {
          for (let c = 1; c <= 2; c++) {
            vars.push(`C2_${iter}r${r}c${c}`);
          }
        }
      }

      const result = detectLoops(vars);
      // This should detect a loop because _N has diversity >= 3
      // (unique bases like C2_*r1c1, C2_*r2c1, C2_*r1c2, C2_*r2c2)
      expect(result.hasLoops).toBe(true);
      if (result.loops.length > 0) {
        expect(result.loops[0].iterations.length).toBeGreaterThanOrEqual(2);
      }
    });

    it('returns no loops for simple variables: S1, S2, S3, S4', () => {
      const vars = ['S1', 'S2', 'S3', 'S4'];
      const result = detectLoops(vars);
      expect(result.hasLoops).toBe(false);
      expect(result.nonLoopVariables.length).toBe(4);
    });

    it('rejects single variable pair: hA3_1, hA3_2 (diversity=1)', () => {
      const vars = ['hA3_1', 'hA3_2'];
      const result = detectLoops(vars);
      // Only 2 variables total, and diversity = 1 (only one base)
      expect(result.hasLoops).toBe(false);
    });

    it('handles empty input', () => {
      const result = detectLoops([]);
      expect(result.hasLoops).toBe(false);
      expect(result.loops).toEqual([]);
      expect(result.nonLoopVariables).toEqual([]);
    });

    it('separates loop and non-loop variables correctly', () => {
      const vars: string[] = [
        'S1', 'S2', 'S3', // Non-loop
        ...Array.from({ length: 18 }, (_, i) => `A${i + 1}_1`),
        ...Array.from({ length: 18 }, (_, i) => `A${i + 1}_2`),
      ];

      const result = detectLoops(vars);
      expect(result.hasLoops).toBe(true);
      expect(result.nonLoopVariables).toContain('S1');
      expect(result.nonLoopVariables).toContain('S2');
      expect(result.nonLoopVariables).toContain('S3');
      expect(result.nonLoopVariables.length).toBe(3);
    });

    it('detects loop with 3+ iterations', () => {
      const vars: string[] = [];
      for (let iter = 1; iter <= 5; iter++) {
        for (let q = 1; q <= 10; q++) {
          vars.push(`Q${q}_${iter}`);
        }
      }

      const result = detectLoops(vars);
      expect(result.hasLoops).toBe(true);
      expect(result.loops[0].iterations.length).toBe(5);
      expect(result.loops[0].diversity).toBe(10);
    });
  });
});
