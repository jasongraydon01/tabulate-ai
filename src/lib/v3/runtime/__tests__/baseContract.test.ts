import { describe, expect, it } from 'vitest';

import {
  buildEntryBaseContract,
  makeEmptyBaseContract,
  projectTableBaseContract,
} from '../baseContract';
import { runReconcile } from '../questionId/reconcile';
import type { QuestionIdEntry, QuestionIdItem, SurveyMetadata } from '../questionId/types';

function makeItem(column: string, itemBase: number): QuestionIdItem {
  return {
    column,
    label: column,
    normalizedType: 'numeric_range',
    itemBase,
    messageCode: null,
    messageText: null,
    altCode: null,
    altText: null,
    matchMethod: null,
    matchConfidence: 0,
  };
}

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  const entry = {
    questionId: 'Q1',
    questionText: 'Question 1',
    variables: ['Q1_1', 'Q1_2', 'Q1_3'],
    variableCount: 3,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'test',
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
    items: [makeItem('Q1_1', 100), makeItem('Q1_2', 100), makeItem('Q1_3', 100)],
    totalN: 100,
    questionBase: 100,
    isFiltered: false,
    gapFromTotal: 0,
    gapPct: 0,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: [100, 100] as [number, number],
    baseContract: buildEntryBaseContract({
      totalN: 100,
      questionBase: 100,
      itemBase: null,
      itemBaseRange: [100, 100],
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: 100,
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
  } as QuestionIdEntry;

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

const metadata: SurveyMetadata = {
  dataset: 'test',
  generatedAt: '2026-03-19T00:00:00Z',
  scriptVersion: 'test',
  isMessageTestingSurvey: false,
  isConceptTestingSurvey: false,
  hasMaxDiff: null,
  hasAnchoredScores: null,
  messageTemplatePath: null,
  isDemandSurvey: false,
  hasChoiceModelExercise: null,
};

describe('buildEntryBaseContract', () => {
  it('classifies a uniform base', () => {
    const contract = buildEntryBaseContract({
      totalN: 100,
      questionBase: 100,
      itemBase: null,
      itemBaseRange: [100, 100],
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    });

    expect(contract.classification.situation).toBe('uniform');
    expect(contract.classification.referenceUniverse).toBe('total');
    expect(contract.classification.variationClass).toBe('none');
    expect(contract.classification.comparabilityStatus).toBe('shared');
    expect(contract.signals).toEqual([]);
  });

  it('classifies a filtered base', () => {
    const contract = buildEntryBaseContract({
      totalN: 100,
      questionBase: 80,
      itemBase: null,
      itemBaseRange: [80, 80],
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    });

    expect(contract.classification.situation).toBe('filtered');
    expect(contract.classification.referenceUniverse).toBe('question');
    expect(contract.signals).toContain('filtered-base');
  });

  it('classifies genuine varying item bases', () => {
    const contract = buildEntryBaseContract({
      totalN: 100,
      questionBase: 80,
      itemBase: null,
      itemBaseRange: [20, 80],
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      rankingDetail: null,
      exclusionReason: null,
    });

    expect(contract.classification.situation).toBe('varying_items');
    expect(contract.classification.variationClass).toBe('genuine');
    expect(contract.classification.comparabilityStatus).toBe('split_recommended');
    expect(contract.signals).toContain('varying-item-bases');
  });

  it('classifies ranking artifacts', () => {
    const contract = buildEntryBaseContract({
      totalN: 100,
      questionBase: 100,
      itemBase: null,
      itemBaseRange: [90, 100],
      hasVariableItemBases: true,
      variableBaseReason: 'ranking-artifact',
      rankingDetail: { K: 3 },
      exclusionReason: null,
    });

    expect(contract.classification.variationClass).toBe('ranking_artifact');
    expect(contract.classification.comparabilityStatus).toBe('varying_but_acceptable');
    expect(contract.signals).toContain('ranking-artifact');
  });

  it('classifies ranking ambiguity when ranking detail and filtering collide', () => {
    const contract = buildEntryBaseContract({
      totalN: 100,
      questionBase: 60,
      itemBase: null,
      itemBaseRange: [10, 60],
      hasVariableItemBases: true,
      variableBaseReason: 'ranking-artifact',
      rankingDetail: { K: 3 },
      exclusionReason: null,
    });

    expect(contract.classification.variationClass).toBe('ranking_ambiguous');
    expect(contract.classification.comparabilityStatus).toBe('ambiguous');
    expect(contract.signals).toContain('ranking-artifact-ambiguous');
  });

  it('adds the zero-respondents signal for excluded zero-base entries', () => {
    const contract = buildEntryBaseContract({
      totalN: 100,
      questionBase: 0,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: 'zero_respondents',
    });

    expect(contract.signals).toContain('zero-respondents');
    expect(contract.signals).toContain('filtered-base');
  });
});

describe('projectTableBaseContract', () => {
  it('projects cluster, rebased, and model-derived table policies', () => {
    const entryContract = buildEntryBaseContract({
      totalN: 100,
      questionBase: 80,
      itemBase: null,
      itemBaseRange: [80, 80],
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    });

    const cluster = projectTableBaseContract(entryContract, {
      basePolicy: 'cluster_base',
      questionBase: 80,
      itemBase: null,
    });
    expect(cluster.classification.referenceUniverse).toBe('cluster');
    expect(cluster.policy.effectiveBaseMode).toBe('table_mask_then_row_observed_n');

    const rebased = projectTableBaseContract(entryContract, {
      basePolicy: 'scale_rebased',
      questionBase: 80,
      itemBase: null,
    });
    expect(rebased.classification.situation).toBe('rebased');
    expect(rebased.policy.rebasePolicy).toBe('exclude_non_substantive_tail');
    expect(rebased.signals).toContain('rebased-base');

    const model = projectTableBaseContract(makeEmptyBaseContract(), {
      basePolicy: 'score_family_model_base',
      questionBase: null,
      itemBase: null,
    });
    expect(model.classification.referenceUniverse).toBe('model');
    expect(model.classification.situation).toBe('model_derived');
    expect(model.policy.effectiveBaseMode).toBe('model');
    expect(model.signals).toContain('model-derived-base');
  });
});

describe('runReconcile base contract sync', () => {
  it('recomputes baseContract after ranking subtype corrections', () => {
    const entry = makeEntry({
      analyticalSubtype: 'ranking',
      subtypeSource: 'ai-gate',
      questionBase: 10,
      totalN: 10,
      items: [makeItem('Q1_1', 12), makeItem('Q1_2', 9), makeItem('Q1_3', 9)],
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [9, 12],
      _aiGateReview: {
        reviewOutcome: 'corrected',
        confidence: 0.95,
        mutationCount: 1,
        reasoning: 'analyticalSubtype corrected to ranking',
        reviewedAt: '2026-03-19T00:00:00.000Z',
        propagatedFrom: null,
      },
    });

    const result = runReconcile({
      entries: [entry],
      metadata,
      surveyParsed: [],
    });

    expect(result.entries[0].rankingDetail).toEqual({
      K: 3,
      N: 3,
      pattern: 'rank-all-3',
      source: 'reconciliation',
    });
    expect(result.entries[0].baseContract.classification.variationClass).toBe('ranking_artifact');
    expect(result.entries[0].baseContract.signals).toContain('ranking-artifact');
  });
});
