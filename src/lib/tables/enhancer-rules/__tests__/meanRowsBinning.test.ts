import { describe, expect, it } from 'vitest';
import { buildBins } from '../meanRowsBinning';

/** Helper: extract just the filterValue strings for compact assertions. */
function labels(min: number, max: number): string[] {
  return buildBins(min, max).map((b) => b.filterValue);
}

/** Parse "start-end" into [start, end] (handles negative numbers like "-10--1"). */
function parseBin(fv: string): [number, number] {
  const m = fv.match(/^(-?\d+)-(-?\d+)$/);
  if (!m) throw new Error(`Invalid bin format: ${fv}`);
  return [Number(m[1]), Number(m[2])];
}

describe('buildBins — expected outputs', () => {
  it('20-900 → step 200, 5 bins', () => {
    expect(labels(20, 900)).toEqual([
      '0-199',
      '200-399',
      '400-599',
      '600-799',
      '800-999',
    ]);
  });

  it('56-999 → step 200, 5 bins', () => {
    expect(labels(56, 999)).toEqual([
      '0-199',
      '200-399',
      '400-599',
      '600-799',
      '800-999',
    ]);
  });

  it('1-1000 → step 200, 5 bins (last bin clamped to 1000)', () => {
    expect(labels(1, 1000)).toEqual([
      '0-199',
      '200-399',
      '400-599',
      '600-799',
      '800-1000',
    ]);
  });

  it('70-100 → step 5, 6 bins', () => {
    expect(labels(70, 100)).toEqual([
      '70-74',
      '75-79',
      '80-84',
      '85-89',
      '90-94',
      '95-100',
    ]);
  });

  it('3-35 → step 10, 4 bins', () => {
    expect(labels(3, 35)).toEqual(['0-9', '10-19', '20-29', '30-39']);
  });
});

describe('buildBins — edge cases', () => {
  it('max <= min returns empty array', () => {
    expect(buildBins(10, 10)).toEqual([]);
    expect(buildBins(10, 5)).toEqual([]);
  });

  it('range <= 2 returns single bin', () => {
    const result = buildBins(5, 7);
    expect(result).toHaveLength(1);
    expect(result[0].filterValue).toBe('5-7');
  });

  it('range = 1 returns single bin', () => {
    const result = buildBins(5, 6);
    expect(result).toHaveLength(1);
    expect(result[0].filterValue).toBe('5-6');
  });

  it('fractional min/max are floored/ceiled', () => {
    const result = labels(2.3, 34.7);
    // floor(2.3)=2, ceil(34.7)=35 → same as 2-35
    expect(result[0]).toMatch(/^-?\d+--?\d+$/);
    const [firstStart] = parseBin(result[0]);
    const [, lastEnd] = parseBin(result[result.length - 1]);
    expect(firstStart).toBeLessThanOrEqual(2);
    expect(lastEnd).toBeGreaterThanOrEqual(35);
  });

  it('negative min produces valid bins', () => {
    const result = labels(-10, 40);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(7);
    const [firstStart] = parseBin(result[0]);
    expect(firstStart).toBeLessThanOrEqual(-10);
  });

  it('very large range (0-10000) still produces 3-7 bins', () => {
    const result = labels(0, 10000);
    expect(result.length).toBeGreaterThanOrEqual(3);
    expect(result.length).toBeLessThanOrEqual(7);
  });
});

describe('buildBins — format contract', () => {
  const testRanges: [number, number][] = [
    [20, 900],
    [56, 999],
    [1, 1000],
    [70, 100],
    [3, 35],
    [0, 500],
    [100, 2000],
    [-5, 50],
  ];

  for (const [min, max] of testRanges) {
    describe(`range ${min}-${max}`, () => {
      const bins = buildBins(min, max);

      it('filterValue matches int-int format', () => {
        for (const bin of bins) {
          expect(bin.filterValue).toMatch(/^-?\d+--?\d+$/);
        }
      });

      it('label equals filterValue', () => {
        for (const bin of bins) {
          expect(bin.label).toBe(bin.filterValue);
        }
      });

      it('bins are contiguous (no gaps)', () => {
        for (let i = 1; i < bins.length; i++) {
          const [, prevEnd] = parseBin(bins[i - 1].filterValue);
          const [currStart] = parseBin(bins[i].filterValue);
          expect(currStart).toBe(prevEnd + 1);
        }
      });

      it('first bin start <= min', () => {
        const [firstStart] = parseBin(bins[0].filterValue);
        expect(firstStart).toBeLessThanOrEqual(Math.floor(min));
      });

      it('last bin end >= max', () => {
        const [, lastEnd] = parseBin(bins[bins.length - 1].filterValue);
        expect(lastEnd).toBeGreaterThanOrEqual(Math.ceil(max));
      });
    });
  }
});

describe('buildBins — bin count bounds', () => {
  const ranges: [number, number][] = [
    [1, 50],
    [0, 100],
    [10, 500],
    [0, 1000],
    [50, 5000],
    [0, 10000],
    [1, 20],
    [100, 300],
  ];

  for (const [min, max] of ranges) {
    it(`${min}-${max} produces 3-7 bins`, () => {
      const result = buildBins(min, max);
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.length).toBeLessThanOrEqual(7);
    });
  }
});
