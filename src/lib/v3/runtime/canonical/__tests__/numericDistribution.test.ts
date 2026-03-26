/**
 * Tests for per-value distribution tables and optimized binning
 * for single-item numeric range questions.
 */
import { describe, it, expect } from 'vitest';
import { runTablePlanner } from '../plan';
import type { QuestionIdEntry, SurveyMetadata } from '../types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMetadata(): SurveyMetadata {
  return {
    dataset: 'test',
    generatedAt: '',
    scriptVersion: '',
    isMessageTestingSurvey: false,
    isConceptTestingSurvey: false,
    hasMaxDiff: null,
    hasAnchoredScores: null,
    messageTemplatePath: null,
    isDemandSurvey: false,
    hasChoiceModelExercise: null,
  };
}

function makeNumericEntry(overrides: Partial<QuestionIdEntry> & { items: QuestionIdEntry['items'] }): QuestionIdEntry {
  return {
    questionId: 'Q1',
    questionText: 'How many years?',
    variables: ['Q1'],
    variableCount: 1,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'deterministic',
    subtypeConfidence: 1,
    rankingDetail: null,
    sumConstraint: null,
    pipeColumns: [],
    surveyMatch: null,
    surveyText: null,
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'numeric_range',
    totalN: 177,
    questionBase: 177,
    isFiltered: false,
    gapFromTotal: 0,
    gapPct: 0,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: [177, 177],
    baseContract: {
      version: 1,
      reference: { totalN: 177, questionBase: 177, itemBase: null, itemBaseRange: [177, 177] },
      classification: { situation: 'uniform', referenceUniverse: 'total', variationClass: 'none', comparabilityStatus: 'shared' },
      policy: { effectiveBaseMode: null, validityPolicy: 'none', rebasePolicy: 'none' },
      signals: [],
    },
    proposedBase: null,
    proposedBaseLabel: null,
    hasMessageMatches: false,
    stimuliSets: null,
    displayQuestionId: null,
    displayQuestionText: null,
    sectionHeader: null,
    itemActivity: null,
    _aiGateReview: null,
    _reconciliation: null,
    ...overrides,
  } as QuestionIdEntry;
}

function makeItem(overrides: Partial<QuestionIdEntry['items'][number]> = {}): QuestionIdEntry['items'][number] {
  return {
    column: 'Q1',
    label: 'How many years?',
    normalizedType: 'numeric_range',
    itemBase: 177,
    messageCode: null,
    messageText: null,
    altCode: null,
    altText: null,
    matchMethod: null as 'code_extraction' | 'truncation_prefix' | 'scale_label_code' | null,
    matchConfidence: 0,
    nUnique: 18,
    observedMin: 0,
    observedMax: 100,
    observedValues: [0, 1, 2, 3, 5, 6, 7, 8, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Numeric distribution table planning', () => {
  it('produces 3 tables for single-item numeric range with nUnique <= 50', () => {
    const item = makeItem({ nUnique: 18 });
    const entry = makeNumericEntry({ items: [item] });

    const result = runTablePlanner({
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const planned = result.plannedTables.filter(t => t.sourceQuestionId === 'Q1');
    const kinds = planned.map(t => t.tableKind);

    expect(kinds).toContain('numeric_item_detail');
    expect(kinds).toContain('numeric_per_value_detail');
    expect(kinds).toContain('numeric_optimized_bin_detail');
    expect(planned.length).toBe(3);
  });

  it('skips per-value table when nUnique > 50', () => {
    const item = makeItem({
      nUnique: 60,
      observedValues: null, // not populated when > 50
    });
    const entry = makeNumericEntry({ items: [item] });

    const result = runTablePlanner({
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const planned = result.plannedTables.filter(t => t.sourceQuestionId === 'Q1');
    const kinds = planned.map(t => t.tableKind);

    expect(kinds).toContain('numeric_item_detail');
    expect(kinds).not.toContain('numeric_per_value_detail');
    expect(kinds).toContain('numeric_optimized_bin_detail');
    expect(planned.length).toBe(2);
  });

  it('skips both new tables when observed stats are missing', () => {
    const item = makeItem({
      nUnique: undefined,
      observedMin: undefined,
      observedMax: undefined,
      observedValues: undefined,
    });
    const entry = makeNumericEntry({ items: [item] });

    const result = runTablePlanner({
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const planned = result.plannedTables.filter(t => t.sourceQuestionId === 'Q1');
    const kinds = planned.map(t => t.tableKind);

    expect(kinds).toContain('numeric_item_detail');
    expect(kinds).not.toContain('numeric_per_value_detail');
    expect(kinds).not.toContain('numeric_optimized_bin_detail');
    expect(planned.length).toBe(1);
  });

  it('does not produce new tables for multi-item numeric range', () => {
    const items = [
      makeItem({ column: 'Q1r1', nUnique: 10, observedValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
      makeItem({ column: 'Q1r2', nUnique: 10, observedValues: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }),
    ];
    const entry = makeNumericEntry({
      items,
      variables: ['Q1r1', 'Q1r2'],
      variableCount: 2,
    });

    const result = runTablePlanner({
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const planned = result.plannedTables.filter(t => t.sourceQuestionId === 'Q1');
    const kinds = planned.map(t => t.tableKind);

    expect(kinds).not.toContain('numeric_per_value_detail');
    expect(kinds).not.toContain('numeric_optimized_bin_detail');
  });

  it('does not produce new tables for allocation subtype', () => {
    const item = makeItem({ nUnique: 10, observedValues: [0, 10, 20, 30, 40, 50, 60, 70, 80, 100] });
    const entry = makeNumericEntry({
      items: [item],
      analyticalSubtype: 'allocation',
      sumConstraint: { detected: true, constraintValue: 100, constraintAxis: 'down-rows', confidence: 1 },
    });

    const result = runTablePlanner({
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const planned = result.plannedTables.filter(t => t.sourceQuestionId === 'Q1');
    const kinds = planned.map(t => t.tableKind);

    expect(kinds).not.toContain('numeric_per_value_detail');
    expect(kinds).not.toContain('numeric_optimized_bin_detail');
  });
});

describe('castItems passes through observed stats', () => {
  it('observed stats are available in planned table context', () => {
    const item = makeItem({
      nUnique: 18,
      observedMin: 0,
      observedMax: 100,
      observedValues: [0, 1, 2, 3, 5, 10, 20, 50, 100],
    });
    const entry = makeNumericEntry({ items: [item] });

    const result = runTablePlanner({
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const perValueTable = result.plannedTables.find(t => t.tableKind === 'numeric_per_value_detail');
    expect(perValueTable).toBeDefined();
    // The table was planned, which means castItems successfully passed observedValues through
    // to the planner (otherwise the nUnique/observedValues guard would have failed)
  });
});
