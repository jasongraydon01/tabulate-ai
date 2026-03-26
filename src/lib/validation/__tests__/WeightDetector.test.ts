import { describe, it, expect } from 'vitest';
import { detectWeightCandidates } from '../WeightDetector';
import { makeDataFileStats } from '../../__tests__/fixtures';

describe('WeightDetector', () => {
  describe('name gate — accepted patterns', () => {
    const goodNames = [
      'wt', 'weight', 'wgt', 'w_total', 'rim_weight', 'final_wt',
      'design_weight', 'data_wgt', 'W', 'w',
    ];

    for (const name of goodNames) {
      it(`accepts "${name}"`, () => {
        const stats = makeDataFileStats([name], {
          [name]: {
            rClass: 'numeric',
            observedMean: 1.02,
            observedMin: 0.3,
            observedMax: 2.5,
            observedSd: 0.4,
            valueLabels: [],
          },
        });
        const result = detectWeightCandidates(stats);
        expect(result.candidates.length).toBeGreaterThanOrEqual(1);
        expect(result.candidates[0].column).toBe(name);
      });
    }
  });

  describe('name gate — rejected patterns', () => {
    const badNames = ['AnchProb_23', 'RawExp_31', 'S9r1', 'gender', 'Q3', 'wait'];

    for (const name of badNames) {
      it(`rejects "${name}"`, () => {
        const stats = makeDataFileStats([name], {
          [name]: {
            rClass: 'numeric',
            observedMean: 1.0,
            observedMin: 0.5,
            observedMax: 2.0,
            observedSd: 0.3,
            valueLabels: [],
          },
        });
        const result = detectWeightCandidates(stats);
        expect(result.candidates).toHaveLength(0);
        expect(result.bestCandidate).toBeNull();
      });
    }
  });

  it('does not check label text — column named Q5 with label "body weight reduction" is rejected', () => {
    const stats = makeDataFileStats(['Q5'], {
      Q5: {
        label: 'body weight reduction',
        rClass: 'numeric',
        observedMean: 1.0,
        observedMin: 0.5,
        observedMax: 2.0,
        valueLabels: [],
      },
    });
    const result = detectWeightCandidates(stats);
    expect(result.candidates).toHaveLength(0);
  });

  it('scores all confirmation signals correctly', () => {
    // Column with ALL positive signals: no value labels, numeric class, mean≈1.0,
    // positive min, plausible range → should score 0.60
    const stats = makeDataFileStats(['wt'], {
      wt: {
        rClass: 'numeric',
        observedMean: 1.0,
        observedMin: 0.3,
        observedMax: 3.0,
        observedSd: 0.4,
        valueLabels: [],
      },
    });
    const result = detectWeightCandidates(stats);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].score).toBe(0.60);
  });

  it('rejects weight-named column below threshold when confirmation signals are bad', () => {
    const stats = makeDataFileStats(['wt'], {
      wt: {
        rClass: 'character', // skip: character class
        observedMean: null,
        observedMin: null,
        observedMax: null,
        valueLabels: [],
      },
    });
    const result = detectWeightCandidates(stats);
    // Character class is skipped entirely
    expect(result.candidates).toHaveLength(0);
  });

  it('applies structural suffix penalty to sub-variables like wt_r1', () => {
    const stats = makeDataFileStats(['wt_r1'], {
      wt_r1: {
        rClass: 'numeric',
        observedMean: 1.0,
        observedMin: 0.3,
        observedMax: 3.0,
        observedSd: 0.4,
        valueLabels: [],
      },
    });
    const result = detectWeightCandidates(stats);
    // 0.60 base - 0.30 penalty = 0.30, still above 0.20 threshold
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].score).toBe(0.30);
    expect(result.candidates[0].signals).toContain('structural suffix detected (penalty)');
  });

  it('sorts multiple candidates by score descending', () => {
    const stats = makeDataFileStats(['wt', 'weight_alt', 'rim_weight'], {
      wt: {
        rClass: 'numeric',
        observedMean: 1.0,
        observedMin: 0.3,
        observedMax: 3.0,
        observedSd: 0.4,
        valueLabels: [],
      },
      weight_alt: {
        rClass: 'numeric',
        observedMean: 5.0, // bad mean — far from 1.0
        observedMin: 0.3,
        observedMax: 10.0, // out of plausible range
        observedSd: 2.0,
        valueLabels: [],
      },
      rim_weight: {
        rClass: 'numeric',
        observedMean: 0.95,
        observedMin: 0.2,
        observedMax: 4.0,
        observedSd: 0.5,
        valueLabels: [],
      },
    });
    const result = detectWeightCandidates(stats);
    expect(result.candidates.length).toBeGreaterThanOrEqual(2);
    // Verify descending order
    for (let i = 1; i < result.candidates.length; i++) {
      expect(result.candidates[i - 1].score).toBeGreaterThanOrEqual(result.candidates[i].score);
    }
    expect(result.bestCandidate).toBe(result.candidates[0]);
  });

  it('returns empty candidates and null bestCandidate when no weight columns', () => {
    const stats = makeDataFileStats(['Q1', 'Q2', 'gender'], {
      Q1: { rClass: 'numeric', observedMean: 3.0, observedMin: 1, observedMax: 5, valueLabels: [] },
      Q2: { rClass: 'numeric', observedMean: 2.5, observedMin: 1, observedMax: 7, valueLabels: [] },
      gender: { rClass: 'numeric', observedMean: 1.5, observedMin: 1, observedMax: 2, valueLabels: [] },
    });
    const result = detectWeightCandidates(stats);
    expect(result.candidates).toHaveLength(0);
    expect(result.bestCandidate).toBeNull();
  });

  it('skips text columns (rClass: character)', () => {
    const stats = makeDataFileStats(['weight_text'], {
      weight_text: {
        rClass: 'character',
        observedMean: null,
        observedMin: null,
        observedMax: null,
        valueLabels: [],
      },
    });
    const result = detectWeightCandidates(stats);
    expect(result.candidates).toHaveLength(0);
  });

  it('skips columns with null mean', () => {
    const stats = makeDataFileStats(['weight_null'], {
      weight_null: {
        rClass: 'numeric',
        observedMean: null,
        observedMin: null,
        observedMax: null,
        valueLabels: [],
      },
    });
    const result = detectWeightCandidates(stats);
    expect(result.candidates).toHaveLength(0);
  });

  it('skips columns with format starting with A (text format)', () => {
    const stats = makeDataFileStats(['weight_str'], {
      weight_str: {
        format: 'A255',
        rClass: 'numeric', // even with numeric class
        observedMean: 1.0,
        observedMin: 0.5,
        observedMax: 2.0,
        valueLabels: [],
      },
    });
    const result = detectWeightCandidates(stats);
    expect(result.candidates).toHaveLength(0);
  });
});
