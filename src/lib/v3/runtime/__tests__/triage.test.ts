/**
 * Parity tests for the deterministic triage function (step 10).
 * Tests all 4 active triage rules with fixture data.
 */

import { describe, it, expect } from 'vitest';
import { buildEntryBaseContract } from '../baseContract';
import { triageEntry, runTriage } from '../questionId/gates/triage';
import type { QuestionIdEntry, SurveyMetadata } from '../questionId/types';

// =============================================================================
// Test Fixtures
// =============================================================================

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  const entry: QuestionIdEntry = {
    questionId: 'Q1',
    questionText: 'How satisfied are you?',
    variables: ['Q1_1', 'Q1_2'],
    variableCount: 2,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'fallback-standard',
    subtypeConfidence: 0.85,
    rankingDetail: null,
    sumConstraint: null,
    pipeColumns: [],
    surveyMatch: 'exact',
    surveyText: 'How satisfied are you with the product?',
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'categorical_select',
    items: [
      {
        column: 'Q1_1',
        label: 'Very satisfied',
        normalizedType: 'categorical_select',
        itemBase: null,
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
      {
        column: 'Q1_2',
        label: 'Somewhat satisfied',
        normalizedType: 'categorical_select',
        itemBase: null,
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
    ],
    totalN: 500,
    questionBase: 480,
    isFiltered: false,
    gapFromTotal: 20,
    gapPct: 4,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
    baseContract: buildEntryBaseContract({
      totalN: 500,
      questionBase: 480,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: 480,
    proposedBaseLabel: 'Total',
    hasMessageMatches: false,
    stimuliSets: null,
    displayQuestionId: null,
    displayQuestionText: null,
    sectionHeader: null,
    itemActivity: null,
    _aiGateReview: null,
    _reconciliation: null,
    ...overrides,
  };
  entry.baseContract = overrides.baseContract ?? buildEntryBaseContract({
    totalN: entry.totalN,
    questionBase: entry.questionBase,
    itemBase: null,
    itemBaseRange: entry.itemBaseRange,
    hasVariableItemBases: entry.hasVariableItemBases,
    variableBaseReason: entry.variableBaseReason,
    rankingDetail: entry.rankingDetail,
    exclusionReason: entry.exclusionReason,
  });
  return entry;
}

const mockMetadata: SurveyMetadata = {
  dataset: 'test-dataset',
  generatedAt: new Date().toISOString(),
  scriptVersion: 'test',
  isMessageTestingSurvey: false,
  isConceptTestingSurvey: false,
  hasMaxDiff: null,
  hasAnchoredScores: null,
  messageTemplatePath: null,
  isDemandSurvey: false,
  hasChoiceModelExercise: null,
};

// =============================================================================
// Rule 1: low-subtype-confidence
// =============================================================================

describe('Rule 1: low-subtype-confidence', () => {
  it('flags non-standard subtype with confidence < 0.8', () => {
    const entry = makeEntry({
      analyticalSubtype: 'scale',
      subtypeSource: 'deterministic-scale',
      subtypeConfidence: 0.65,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons).toHaveLength(1);
    expect(reasons[0].rule).toBe('low-subtype-confidence');
    expect(reasons[0].severity).toBe('medium');
    expect(reasons[0].detail).toContain('scale');
    expect(reasons[0].detail).toContain('0.65');
  });

  it('does NOT flag standard subtype even with low confidence', () => {
    const entry = makeEntry({
      analyticalSubtype: 'standard',
      subtypeConfidence: 0.5,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'low-subtype-confidence')).toBeUndefined();
  });

  it('does NOT flag non-standard at confidence >= 0.8', () => {
    const entry = makeEntry({
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.85,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'low-subtype-confidence')).toBeUndefined();
  });

  it('does NOT flag when subtypeConfidence is null', () => {
    const entry = makeEntry({
      analyticalSubtype: 'scale',
      subtypeConfidence: null,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'low-subtype-confidence')).toBeUndefined();
  });
});

// =============================================================================
// Rule 2: unlinked-hidden
// =============================================================================

describe('Rule 2: unlinked-hidden', () => {
  it('flags hidden entry with no hiddenLink', () => {
    const entry = makeEntry({
      isHidden: true,
      hiddenLink: null,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'unlinked-hidden')).toBeDefined();
    expect(reasons.find(r => r.rule === 'unlinked-hidden')!.severity).toBe('low');
  });

  it('does NOT flag hidden entry with hiddenLink', () => {
    const entry = makeEntry({
      isHidden: true,
      hiddenLink: { linkedTo: 'Q2', linkMethod: 'h_prefix_strip' },
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'unlinked-hidden')).toBeUndefined();
  });

  it('does NOT flag non-hidden entry', () => {
    const entry = makeEntry({ isHidden: false });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'unlinked-hidden')).toBeUndefined();
  });
});

// =============================================================================
// Rule 3: dead-variable
// =============================================================================

describe('Rule 3: dead-variable', () => {
  it('flags entry with questionBase=0', () => {
    const entry = makeEntry({ questionBase: 0, totalN: 500 });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'dead-variable')).toBeDefined();
    expect(reasons.find(r => r.rule === 'dead-variable')!.severity).toBe('high');
    expect(reasons.find(r => r.rule === 'dead-variable')!.detail).toContain('totalN=500');
  });

  it('does NOT flag entry with questionBase > 0', () => {
    const entry = makeEntry({ questionBase: 1 });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'dead-variable')).toBeUndefined();
  });

  it('does NOT flag entry with questionBase undefined (pre-step-03)', () => {
    const entry = makeEntry();
    delete (entry as Record<string, unknown>).questionBase;
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'dead-variable')).toBeUndefined();
  });
});

// =============================================================================
// Rule 4: no-survey-match
// =============================================================================

describe('Rule 4: no-survey-match', () => {
  it('flags non-hidden entry with surveyMatch=none', () => {
    const entry = makeEntry({
      surveyMatch: 'none',
      isHidden: false,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'no-survey-match')).toBeDefined();
    expect(reasons.find(r => r.rule === 'no-survey-match')!.severity).toBe('low');
  });

  it('does NOT flag hidden entry with surveyMatch=none', () => {
    const entry = makeEntry({
      surveyMatch: 'none',
      isHidden: true,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'no-survey-match')).toBeUndefined();
  });

  it('does NOT flag entry with surveyMatch=exact', () => {
    const entry = makeEntry({ surveyMatch: 'exact' });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'no-survey-match')).toBeUndefined();
  });

  it('does NOT flag entry with surveyMatch=suffix', () => {
    const entry = makeEntry({ surveyMatch: 'suffix' });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'no-survey-match')).toBeUndefined();
  });

  it('does NOT flag entry with surveyMatch=null (no survey available)', () => {
    const entry = makeEntry({ surveyMatch: null });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'no-survey-match')).toBeUndefined();
  });
});

// =============================================================================
// Combined & batch behavior
// =============================================================================

// =============================================================================
// Rule 5: hidden-categorical-not-ranking
// =============================================================================

describe('Rule 5: hidden-categorical-not-ranking', () => {
  it('flags hidden categorical_select with rank-bucket scaleLabels', () => {
    const entry = makeEntry({
      questionId: 'hQ5_grid_1',
      isHidden: true,
      normalizedType: 'categorical_select',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.65,
      items: [
        {
          column: 'hQ5_grid_1_1',
          label: 'Item A',
          normalizedType: 'categorical_select',
          scaleLabels: [
            { value: 1, label: 'Top 1' },
            { value: 2, label: 'Top 2' },
            { value: 3, label: 'Top 3' },
          ],
          itemBase: null,
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    const rule5 = reasons.find(r => r.rule === 'hidden-categorical-not-ranking');
    expect(rule5).toBeDefined();
    expect(rule5!.severity).toBe('medium');
    expect(rule5!.detail).toContain('categorical_select');
    expect(rule5!.detail).toContain('rank-bucket pattern');
  });

  it('flags when parent in allEntries is ranking/numeric_range', () => {
    const parent = makeEntry({
      questionId: 'Q5',
      isHidden: false,
      normalizedType: 'numeric_range',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.90,
    });
    const hidden = makeEntry({
      questionId: 'hQ5_grid_1',
      isHidden: true,
      hiddenLink: null,
      normalizedType: 'categorical_select',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.65,
    });
    const reasons = triageEntry(hidden, mockMetadata, [parent, hidden]);
    const rule5 = reasons.find(r => r.rule === 'hidden-categorical-not-ranking');
    expect(rule5).toBeDefined();
    expect(rule5!.detail).toContain('parent Q5');
  });

  it('does NOT flag non-hidden entry', () => {
    const entry = makeEntry({
      isHidden: false,
      normalizedType: 'categorical_select',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.65,
      items: [
        {
          column: 'Q5_1',
          label: 'Item A',
          normalizedType: 'categorical_select',
          scaleLabels: [
            { value: 1, label: 'Top 1' },
            { value: 2, label: 'Top 2' },
          ],
          itemBase: null,
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'hidden-categorical-not-ranking')).toBeUndefined();
  });

  it('does NOT flag hidden entry already classified as standard', () => {
    const entry = makeEntry({
      questionId: 'hQ5_grid_1',
      isHidden: true,
      normalizedType: 'categorical_select',
      analyticalSubtype: 'standard',
      subtypeConfidence: 0.85,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'hidden-categorical-not-ranking')).toBeUndefined();
  });

  it('does NOT flag hidden entry with numeric_range type', () => {
    const entry = makeEntry({
      questionId: 'hQ5_grid_1',
      isHidden: true,
      normalizedType: 'numeric_range',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.65,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons.find(r => r.rule === 'hidden-categorical-not-ranking')).toBeUndefined();
  });

  it('flags with explicit hiddenLink-based parent resolution', () => {
    const parent = makeEntry({
      questionId: 'B500',
      isHidden: false,
      normalizedType: 'numeric_range',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.90,
    });
    const hidden = makeEntry({
      questionId: 'hB500_grid_1',
      isHidden: true,
      hiddenLink: { linkedTo: 'B500', linkMethod: 'h_prefix_strip' },
      normalizedType: 'categorical_select',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.65,
    });
    const reasons = triageEntry(hidden, mockMetadata, [parent, hidden]);
    const rule5 = reasons.find(r => r.rule === 'hidden-categorical-not-ranking');
    expect(rule5).toBeDefined();
    expect(rule5!.detail).toContain('parent B500');
  });
});

describe('Multiple rules on same entry', () => {
  it('triggers multiple rules when applicable', () => {
    const entry = makeEntry({
      analyticalSubtype: 'allocation',
      subtypeConfidence: 0.6,
      surveyMatch: 'none',
      isHidden: false,
      questionBase: 0,
    });
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    const rules = reasons.map(r => r.rule);
    expect(rules).toContain('low-subtype-confidence');
    expect(rules).toContain('dead-variable');
    expect(rules).toContain('no-survey-match');
    expect(reasons.length).toBe(3);
  });

  it('Rule 5 coexists with Rules 1 and 2 on same entry', () => {
    const parent = makeEntry({
      questionId: 'Q7',
      isHidden: false,
      normalizedType: 'numeric_range',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.90,
    });
    const hidden = makeEntry({
      questionId: 'hQ7_grid_1',
      isHidden: true,
      hiddenLink: null,
      normalizedType: 'categorical_select',
      analyticalSubtype: 'ranking',
      subtypeConfidence: 0.65,
    });
    const reasons = triageEntry(hidden, mockMetadata, [parent, hidden]);
    const rules = reasons.map(r => r.rule);
    expect(rules).toContain('low-subtype-confidence');  // Rule 1: ranking at 0.65
    expect(rules).toContain('unlinked-hidden');          // Rule 2: hidden, no hiddenLink
    expect(rules).toContain('hidden-categorical-not-ranking'); // Rule 5
  });
});

describe('Clean entry triggers no rules', () => {
  it('returns empty array for a well-classified entry', () => {
    const entry = makeEntry();
    const reasons = triageEntry(entry, mockMetadata, [entry]);
    expect(reasons).toHaveLength(0);
  });
});

describe('runTriage batch function', () => {
  it('only triages reportable entries', () => {
    const entries = [
      makeEntry({ questionId: 'Q1', disposition: 'reportable' }),
      makeEntry({ questionId: 'Q2', disposition: 'excluded' }),
      makeEntry({ questionId: 'Q3', disposition: 'text_open_end' }),
    ];
    const result = runTriage(entries, mockMetadata);
    expect(result.stats.reportableEntries).toBe(1);
    expect(result.stats.totalEntries).toBe(3);
    expect(result.allEntries).toHaveLength(3);
  });

  it('computes correct flagged percentage', () => {
    const entries = [
      makeEntry({ questionId: 'Q1', surveyMatch: 'none', isHidden: false }),
      makeEntry({ questionId: 'Q2', surveyMatch: 'exact' }),
    ];
    const result = runTriage(entries, mockMetadata);
    expect(result.stats.flaggedEntries).toBe(1);
    expect(result.stats.flaggedPct).toBe(50);
    expect(result.stats.byRule['no-survey-match']).toBe(1);
    expect(result.stats.bySeverity.low).toBe(1);
  });

  it('returns 0% when no entries are flagged', () => {
    const entries = [makeEntry()];
    const result = runTriage(entries, mockMetadata);
    expect(result.stats.flaggedEntries).toBe(0);
    expect(result.stats.flaggedPct).toBe(0);
  });
});
