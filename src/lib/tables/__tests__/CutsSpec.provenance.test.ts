import { describe, expect, it } from 'vitest';
import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';

function makeColumn(name: string, adjusted: string, confidence: number, provenance?: {
  reviewAction: string;
  reviewHint: string;
  preReviewExpression: string;
}) {
  const col: Record<string, unknown> = {
    name,
    adjusted,
    confidence,
    reasoning: `reasoning for ${name}`,
    userSummary: `summary for ${name}`,
    alternatives: [],
    uncertainties: [],
    expressionType: 'direct_variable',
  };
  if (provenance) {
    col.reviewAction = provenance.reviewAction;
    col.reviewHint = provenance.reviewHint;
    col.preReviewExpression = provenance.preReviewExpression;
  }
  return col;
}

describe('CutsSpec provenance tracking', () => {
  it('defaults provenance to ai_original when fields are absent', () => {
    const validation: ValidationResultType = {
      bannerCuts: [{
        groupName: 'G1',
        columns: [makeColumn('Q1', 'Q1 == 1', 0.9) as ValidationResultType['bannerCuts'][0]['columns'][0]],
      }],
    };

    const spec = buildCutsSpec(validation);

    // Skip Total cut — find Q1
    const q1Cut = spec.cuts.find(c => c.name === 'Q1');
    expect(q1Cut).toBeDefined();
    expect(q1Cut!.reviewAction).toBe('ai_original');
    expect(q1Cut!.reviewHint).toBe('');
    expect(q1Cut!.preReviewExpression).toBe('');
  });

  it('carries provenance fields from tagged columns', () => {
    const validation: ValidationResultType = {
      bannerCuts: [{
        groupName: 'G1',
        columns: [
          makeColumn('Q1', 'Q1 %in% c(1, 2)', 1.0, {
            reviewAction: 'hint_applied',
            reviewHint: 'Include both values',
            preReviewExpression: 'Q1 == 1',
          }) as ValidationResultType['bannerCuts'][0]['columns'][0],
          makeColumn('Q2', 'Q2 == 2', 1.0, {
            reviewAction: 'approved',
            reviewHint: '',
            preReviewExpression: 'Q2 == 2',
          }) as ValidationResultType['bannerCuts'][0]['columns'][0],
          makeColumn('Q3', 'Q3 >= 3', 1.0, {
            reviewAction: 'user_edited',
            reviewHint: '',
            preReviewExpression: 'Q3 == 3',
          }) as ValidationResultType['bannerCuts'][0]['columns'][0],
        ],
      }],
    };

    const spec = buildCutsSpec(validation);

    const q1 = spec.cuts.find(c => c.name === 'Q1')!;
    expect(q1.reviewAction).toBe('hint_applied');
    expect(q1.reviewHint).toBe('Include both values');
    expect(q1.preReviewExpression).toBe('Q1 == 1');

    const q2 = spec.cuts.find(c => c.name === 'Q2')!;
    expect(q2.reviewAction).toBe('approved');
    expect(q2.reviewHint).toBe('');

    const q3 = spec.cuts.find(c => c.name === 'Q3')!;
    expect(q3.reviewAction).toBe('user_edited');
    expect(q3.preReviewExpression).toBe('Q3 == 3');
  });

  it('carries alternative_selected provenance', () => {
    const validation: ValidationResultType = {
      bannerCuts: [{
        groupName: 'G1',
        columns: [
          makeColumn('Q1', 'Q1 %in% c(1, 2, 3)', 1.0, {
            reviewAction: 'alternative_selected',
            reviewHint: '',
            preReviewExpression: 'Q1 == 1',
          }) as ValidationResultType['bannerCuts'][0]['columns'][0],
        ],
      }],
    };

    const spec = buildCutsSpec(validation);
    const q1 = spec.cuts.find(c => c.name === 'Q1')!;
    expect(q1.reviewAction).toBe('alternative_selected');
    expect(q1.preReviewExpression).toBe('Q1 == 1');
  });

  it('Total cut always has ai_original provenance', () => {
    const validation: ValidationResultType = { bannerCuts: [] };
    const spec = buildCutsSpec(validation);

    expect(spec.totalCut).not.toBeNull();
    expect(spec.totalCut!.reviewAction).toBe('ai_original');
    expect(spec.totalCut!.reviewHint).toBe('');
    expect(spec.totalCut!.preReviewExpression).toBe('');
  });

  it('mixed provenance across groups maintains correct assignment', () => {
    const validation: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Demographics',
          columns: [
            makeColumn('Age', 'Age >= 18', 1.0, {
              reviewAction: 'hint_applied',
              reviewHint: 'Use age ranges',
              preReviewExpression: 'Age == 1',
            }) as ValidationResultType['bannerCuts'][0]['columns'][0],
          ],
        },
        {
          groupName: 'Location',
          columns: [
            makeColumn('Region', 'Region == 1', 0.9) as ValidationResultType['bannerCuts'][0]['columns'][0],
          ],
        },
      ],
    };

    const spec = buildCutsSpec(validation);

    const ageCut = spec.cuts.find(c => c.name === 'Age')!;
    expect(ageCut.reviewAction).toBe('hint_applied');
    expect(ageCut.reviewHint).toBe('Use age ranges');
    expect(ageCut.groupName).toBe('Demographics');

    const regionCut = spec.cuts.find(c => c.name === 'Region')!;
    expect(regionCut.reviewAction).toBe('ai_original');
    expect(regionCut.groupName).toBe('Location');
  });
});
