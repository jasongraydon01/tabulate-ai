import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TABLE_LABEL_VOCABULARY,
  detectUsedLabelSlotsFromCanonicalTables,
  rewriteGeneratedRowLabel,
  rewriteGeneratedSubtitle,
} from '@/lib/tablePresentation/labelVocabulary';

describe('table label vocabulary', () => {
  it('rewrites generated row labels from the configured vocabulary', () => {
    const vocabulary = {
      ...DEFAULT_TABLE_LABEL_VOCABULARY,
      rankFormat: 'Rank #{N}',
      topBoxFormat: 'T{N}B',
      netPrefix: '',
      promotersLabel: 'Promoters (9-10)',
      meanLabel: 'Average',
    };

    expect(rewriteGeneratedRowLabel('Ranked 3rd', vocabulary)).toBe('Rank #3');
    expect(rewriteGeneratedRowLabel('Top 2 Box', vocabulary)).toBe('T2B');
    expect(rewriteGeneratedRowLabel('NET: Agree', vocabulary)).toBe('Agree');
    expect(rewriteGeneratedRowLabel('Promoters', vocabulary)).toBe('Promoters (9-10)');
    expect(rewriteGeneratedRowLabel('Mean', vocabulary)).toBe('Average');
  });

  it('rewrites generated subtitles from the configured vocabulary', () => {
    const vocabulary = {
      ...DEFAULT_TABLE_LABEL_VOCABULARY,
      rankFormat: '{word} Choice',
      topBoxFormat: 'Favorable (T{N}B)',
      middleBoxLabel: 'Neutral',
      meanLabel: 'Average',
    };

    expect(rewriteGeneratedSubtitle('Ranked 1st Summary', vocabulary)).toBe('First Choice Summary');
    expect(rewriteGeneratedSubtitle('Top 2 Box Summary', vocabulary)).toBe('Favorable (T2B) Summary');
    expect(rewriteGeneratedSubtitle('Middle Box Summary', vocabulary)).toBe('Neutral Box Summary');
    expect(rewriteGeneratedSubtitle('Mean Summary', vocabulary)).toBe('Average Summary');
  });

  it('detects only the label slots used in the project tables', () => {
    const usedSlots = detectUsedLabelSlotsFromCanonicalTables([
      {
        tableSubtitle: 'Top 2 Box Summary',
        rows: [
          { label: 'Top 2 Box' },
          { label: 'NET: Agree' },
          { label: 'Mean', statType: 'mean' },
        ],
      },
      {
        tableSubtitle: 'Ranked 1st Summary',
        rows: [
          { label: 'Ranked 1st' },
          { label: 'Not Ranked' },
        ],
      },
      {
        tableSubtitle: 'Net Promoter Score Summary',
        rows: [
          { label: 'Promoters' },
          { label: 'Passives' },
          { label: 'Detractors' },
          { label: 'NPS Score' },
        ],
      },
    ]);

    expect(usedSlots).toEqual([
      'rankFormat',
      'topBoxFormat',
      'meanLabel',
      'totalLabel',
      'baseLabel',
      'netPrefix',
      'notRankedLabel',
      'npsScoreLabel',
      'promotersLabel',
      'passivesLabel',
      'detractorsLabel',
    ]);
  });
});
