/**
 * Tests for loopGateSchema and the architectural enforcement in aiGateSchema.
 *
 * Key invariants:
 * 1. LoopGateMutableFieldSchema only allows 'loop'
 * 2. AIGateMutableFieldSchema no longer allows 'loop' (moved to loop gate)
 * 3. LoopGateEntryResultSchema parses valid cleared/confirmed/flagged results
 */

import { describe, it, expect } from 'vitest';
import {
  LoopGateMutableFieldSchema,
  LoopGateEntryResultSchema,
} from '../loopGateSchema';
import { AIGateMutableFieldSchema } from '../aiGateSchema';

describe('LoopGateMutableFieldSchema', () => {
  it('accepts "loop" as valid field', () => {
    expect(LoopGateMutableFieldSchema.parse('loop')).toBe('loop');
  });

  it('rejects "analyticalSubtype" — not the loop gate\'s concern', () => {
    expect(() => LoopGateMutableFieldSchema.parse('analyticalSubtype')).toThrow();
  });

  it('rejects "disposition" — not the loop gate\'s concern', () => {
    expect(() => LoopGateMutableFieldSchema.parse('disposition')).toThrow();
  });

  it('rejects "hiddenLink" — not the loop gate\'s concern', () => {
    expect(() => LoopGateMutableFieldSchema.parse('hiddenLink')).toThrow();
  });

  it('rejects "surveyMatch" — not the loop gate\'s concern', () => {
    expect(() => LoopGateMutableFieldSchema.parse('surveyMatch')).toThrow();
  });
});

describe('AIGateMutableFieldSchema — loop removed', () => {
  it('rejects "loop" — loop decisions moved to LoopGateAgent (step 10a)', () => {
    expect(() => AIGateMutableFieldSchema.parse('loop')).toThrow();
  });

  it('still accepts "analyticalSubtype"', () => {
    expect(AIGateMutableFieldSchema.parse('analyticalSubtype')).toBe('analyticalSubtype');
  });

  it('still accepts "hiddenLink"', () => {
    expect(AIGateMutableFieldSchema.parse('hiddenLink')).toBe('hiddenLink');
  });

  it('still accepts "disposition"', () => {
    expect(AIGateMutableFieldSchema.parse('disposition')).toBe('disposition');
  });
});

describe('LoopGateEntryResultSchema', () => {
  it('parses a valid confirmed result (empty mutations)', () => {
    const result = LoopGateEntryResultSchema.parse({
      questionId: 'Q5_1',
      reviewOutcome: 'confirmed',
      confidence: 0.88,
      mutations: [],
      reasoning: 'Survey shows genuine respondent-level iteration with varying bases.',
    });
    expect(result.reviewOutcome).toBe('confirmed');
    expect(result.mutations).toHaveLength(0);
  });

  it('parses a valid cleared result with one loop mutation', () => {
    const result = LoopGateEntryResultSchema.parse({
      questionId: 'Q5_1',
      reviewOutcome: 'cleared',
      confidence: 0.92,
      mutations: [
        {
          field: 'loop',
          oldValue: '{"detected":true,"familyBase":"Q5","iterationIndex":0,"iterationCount":3}',
          newValue: 'null',
          reasoning: 'Message testing carousel — fixed stimuli, not respondent-level iteration.',
        },
      ],
      reasoning: 'False positive: stimulus carousel in message testing survey.',
    });
    expect(result.reviewOutcome).toBe('cleared');
    expect(result.mutations).toHaveLength(1);
    expect(result.mutations[0].field).toBe('loop');
    expect(result.mutations[0].newValue).toBe('null');
  });

  it('parses a valid flagged_for_human result (empty mutations)', () => {
    const result = LoopGateEntryResultSchema.parse({
      questionId: 'Q5_1',
      reviewOutcome: 'flagged_for_human',
      confidence: 0.55,
      mutations: [],
      reasoning: 'Cannot find this question in the survey document.',
    });
    expect(result.reviewOutcome).toBe('flagged_for_human');
    expect(result.mutations).toHaveLength(0);
  });

  it('rejects "corrected" as reviewOutcome — loop gate uses "cleared" instead', () => {
    expect(() =>
      LoopGateEntryResultSchema.parse({
        questionId: 'Q5_1',
        reviewOutcome: 'corrected',
        confidence: 0.9,
        mutations: [],
        reasoning: 'Should not use corrected in loop gate.',
      }),
    ).toThrow();
  });

  it('rejects mutation with field "analyticalSubtype" — architectural enforcement', () => {
    expect(() =>
      LoopGateEntryResultSchema.parse({
        questionId: 'Q5_1',
        reviewOutcome: 'cleared',
        confidence: 0.9,
        mutations: [
          {
            field: 'analyticalSubtype',
            oldValue: '"standard"',
            newValue: '"scale"',
            reasoning: 'Should not be allowed.',
          },
        ],
        reasoning: 'This should fail.',
      }),
    ).toThrow();
  });
});
