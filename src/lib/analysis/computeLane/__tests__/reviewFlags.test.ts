import { describe, expect, it } from 'vitest';

import { evaluateAnalysisBannerExtensionReviewFlags } from '../reviewFlags';

describe('evaluateAnalysisBannerExtensionReviewFlags', () => {
  it('allows high-confidence direct variables', () => {
    const flags = evaluateAnalysisBannerExtensionReviewFlags({
      groupName: 'Region',
      columns: [{
        name: 'North',
        adjusted: 'REGION == 1',
        confidence: 0.95,
        reasoning: 'Direct match',
        userSummary: 'Matched directly.',
        alternatives: [],
        uncertainties: [],
        expressionType: 'direct_variable',
      }],
    });

    expect(flags.requiresClarification).toBe(false);
    expect(flags.requiresReview).toBe(false);
    expect(flags.reasons).toEqual([]);
  });

  it('blocks conceptual and failed expressions before child-run enqueue', () => {
    const flags = evaluateAnalysisBannerExtensionReviewFlags({
      groupName: 'Audience',
      columns: [{
        name: 'Decision makers',
        adjusted: '# Error: Processing failed',
        confidence: 0.4,
        reasoning: 'Fallback used',
        userSummary: 'Fallback used.',
        alternatives: [],
        uncertainties: ['Ambiguous audience definition'],
        expressionType: 'conceptual_filter',
      }],
    });

    expect(flags.requiresClarification).toBe(true);
    expect(flags.requiresReview).toBe(true);
    expect(flags.policyFallbackDetected).toBe(true);
    expect(flags.reasons.join(' ')).toContain('needs review');
    expect(flags.reasons.join(' ')).toContain('executable expression');
  });

  it('blocks low-confidence draft proposals before child-run enqueue', () => {
    const flags = evaluateAnalysisBannerExtensionReviewFlags({
      groupName: 'Region',
      columns: [{
        name: 'North',
        adjusted: 'REGION == 1',
        confidence: 0.95,
        reasoning: 'Direct match',
        userSummary: 'Matched directly.',
        alternatives: [],
        uncertainties: [],
        expressionType: 'direct_variable',
      }],
    }, { draftConfidence: 0.4 });

    expect(flags.requiresClarification).toBe(true);
    expect(flags.requiresReview).toBe(true);
    expect(flags.draftConfidence).toBe(0.4);
    expect(flags.reasons.join(' ')).toContain('Draft proposal confidence');
  });
});
