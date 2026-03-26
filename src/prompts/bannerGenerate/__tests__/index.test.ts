import { describe, expect, it } from 'vitest';
import { buildBannerGenerateUserPrompt as buildProductionPrompt } from '../production';
import { buildBannerGenerateUserPromptForVersion } from '../index';

describe('bannerGenerate prompt selector', () => {
  it('keeps production user prompt formatting unchanged', () => {
    const input = {
      verboseDataMap: [
        {
          column: 'Q1',
          description: 'Question one',
          normalizedType: 'categorical_select',
          answerOptions: '1=Yes,2=No',
          parentQuestion: 'NA',
          family: 'Q1',
        },
      ],
      researchObjectives: 'Test objective',
      cutSuggestions: 'Test suggestion',
      projectType: 'general',
    };

    const fromSelector = buildBannerGenerateUserPromptForVersion(input, 'production');
    const directProduction = buildProductionPrompt(input);

    expect(fromSelector).toBe(directProduction);
    // Parent/family fields graduated to production — now included in output
    expect(fromSelector).toContain('ParentQuestion: NA');
    expect(fromSelector).toContain('Family: Q1');
    expect(fromSelector).toContain('one family per banner group');
  });

  it('uses alternative prompt builder with parent/family emphasis', () => {
    const prompt = buildBannerGenerateUserPromptForVersion(
      {
        verboseDataMap: [
          {
            column: 'S8r1',
            description: 'Brand A',
            normalizedType: 'binary_flag',
            answerOptions: '0=Unchecked,1=Checked',
            parentQuestion: 'S8',
            family: 'S8',
          },
        ],
      },
      'alternative',
    );

    expect(prompt).toContain('ParentQuestion: S8');
    expect(prompt).toContain('Family: S8');
    expect(prompt).toContain('one family per banner group');
  });
});
