import { describe, expect, it } from 'vitest';

import { getFlaggedCrosstabColumns } from '@/lib/api/hitlManager';
import type { BannerProcessingResult } from '@/agents/BannerAgent';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';

function makeBannerResult(original: string): BannerProcessingResult {
  return {
    success: true,
    confidence: 0.9,
    errors: [],
    warnings: [],
    agent: [],
    verbose: {
      success: true,
      timestamp: new Date().toISOString(),
      data: {
        extractedStructure: {
          bannerCuts: [
            {
              groupName: 'Audience',
              columns: [
                {
                  name: 'Teachers',
                  original,
                  adjusted: original,
                  statLetter: '',
                  confidence: 0.9,
                  requiresInference: false,
                  reasoning: '',
                  uncertainties: [],
                },
              ],
            },
          ],
          notes: [],
          statisticalLettersUsed: [],
        },
      },
    } as unknown as BannerProcessingResult['verbose'],
  };
}

describe('getFlaggedCrosstabColumns', () => {
  it('includes high-confidence direct mappings in review payload', () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Audience',
          columns: [
            {
              name: 'Teachers',
              adjusted: 'Q1 == 1',
              confidence: 0.95,
              reasoning: 'Direct mapping',
              userSummary: 'Mapped directly',
              alternatives: [],
              uncertainties: [],
              expressionType: 'direct_variable',
            },
          ],
        },
      ],
    };

    const flagged = getFlaggedCrosstabColumns(crosstabResult, makeBannerResult('Q1=1'));

    expect(flagged).toHaveLength(1);
    expect(flagged[0].groupName).toBe('Audience');
    expect(flagged[0].columnName).toBe('Teachers');
    expect(flagged[0].confidence).toBe(0.95);
  });

  it('marks the literal/original alternative selectable when agent retained an executable original mapping', () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Audience',
          columns: [
            {
              name: 'Teachers',
              adjusted: 'Q2 == 1',
              confidence: 0.81,
              reasoning: 'Intent mapping',
              userSummary: 'Mapped to role variable',
              alternatives: [
                {
                  expression: 'Q1 == 1',
                  rank: 4,
                  userSummary: 'Original banner expression retained as fallback.',
                },
              ],
              uncertainties: [],
              expressionType: 'conceptual_filter',
            },
          ],
        },
      ],
    };

    const flagged = getFlaggedCrosstabColumns(crosstabResult, makeBannerResult('Q1=1'));

    expect(flagged[0].alternatives).toHaveLength(1);
    expect(flagged[0].alternatives[0]).toMatchObject({
      expression: 'Q1 == 1',
      rank: 4,
      selectable: true,
      source: 'literal_original',
    });
  });

  it('surfaces a non-executable literal/original mapping as display-only', () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Audience',
          columns: [
            {
              name: 'Teachers',
              adjusted: 'Q2 == 1',
              confidence: 0.4,
              reasoning: 'Fallback mapping',
              userSummary: 'Mapped to closest executable variable',
              alternatives: [],
              uncertainties: ['Original banner text was not executable'],
              expressionType: 'placeholder',
            },
          ],
        },
      ],
    };

    const flagged = getFlaggedCrosstabColumns(crosstabResult, makeBannerResult('Teacher audience'));

    expect(flagged[0].alternatives).toHaveLength(1);
    expect(flagged[0].alternatives[0]).toMatchObject({
      expression: 'Teacher audience',
      selectable: false,
      source: 'literal_original',
    });
    expect(flagged[0].alternatives[0].nonSelectableReason).toContain('could not be confirmed');
  });
});
