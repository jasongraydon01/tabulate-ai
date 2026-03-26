/**
 * Tests for item activity summary computation (step 12, pass 4).
 */
import { describe, it, expect } from 'vitest';
import { buildEntryBaseContract } from '../baseContract';
import { computeItemActivity } from '../questionId/reconcile';
import type { QuestionIdEntry, QuestionIdItem } from '../questionId/types';

/** Minimal item with defaults. */
function makeItem(base: number | null, column = 'Q1_1'): QuestionIdItem {
  return {
    column,
    label: 'Item',
    normalizedType: 'categorical_select',
    itemBase: base,
    messageCode: null,
    messageText: null,
    altCode: null,
    altText: null,
    matchMethod: null,
    matchConfidence: 0,
  };
}

/** Bare-minimum reportable entry with explicit items. */
function reportableEntry(items: QuestionIdItem[]): QuestionIdEntry {
  const entry: QuestionIdEntry = {
    questionId: 'Q1',
    questionText: 'Test question',
    variables: items.map(i => i.column),
    variableCount: items.length,
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
    normalizedType: 'categorical_select',
    items,
    totalN: 100,
    questionBase: 50,
    isFiltered: false,
    gapFromTotal: null,
    gapPct: null,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
    baseContract: buildEntryBaseContract({
      totalN: 100,
      questionBase: 50,
      itemBase: null,
      itemBaseRange: null,
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
  };
  entry.baseContract = buildEntryBaseContract({
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

describe('computeItemActivity', () => {
  it('returns null for excluded entries', () => {
    const entry = reportableEntry([makeItem(50)]);
    entry.disposition = 'excluded';
    expect(computeItemActivity(entry)).toBeNull();
  });

  it('returns null for text_open_end entries', () => {
    const entry = reportableEntry([makeItem(50)]);
    entry.disposition = 'text_open_end';
    expect(computeItemActivity(entry)).toBeNull();
  });

  it('returns null for entries with no items', () => {
    const entry = reportableEntry([]);
    expect(computeItemActivity(entry)).toBeNull();
  });

  it('counts all items as active when all have base > 0', () => {
    const entry = reportableEntry([
      makeItem(50, 'Q1_1'),
      makeItem(75, 'Q1_2'),
      makeItem(30, 'Q1_3'),
    ]);

    expect(computeItemActivity(entry)).toEqual({
      activeItemCount: 3,
      inactiveItemCount: 0,
      activePct: 1,
    });
  });

  it('correctly identifies sparse entries with zero-base items', () => {
    // Simulates hC500_grid_3: 13 active, 29 zero-base
    const items: QuestionIdItem[] = [];
    for (let i = 0; i < 13; i++) {
      items.push(makeItem(50 + i, `hC500_grid_3r${301 + i}`));
    }
    for (let i = 0; i < 29; i++) {
      items.push(makeItem(0, `hC500_grid_3r${101 + i}`));
    }

    const entry = reportableEntry(items);
    entry.variableCount = 42;

    expect(computeItemActivity(entry)).toEqual({
      activeItemCount: 13,
      inactiveItemCount: 29,
      activePct: 0.31, // 13/42 = 0.30952... rounded to 3 decimals
    });
  });

  it('treats null itemBase as inactive', () => {
    const entry = reportableEntry([
      makeItem(50, 'Q1_1'),
      makeItem(null, 'Q1_2'),
      makeItem(0, 'Q1_3'),
    ]);

    expect(computeItemActivity(entry)).toEqual({
      activeItemCount: 1,
      inactiveItemCount: 2,
      activePct: 0.333,
    });
  });

  it('handles single-item entry', () => {
    const entry = reportableEntry([makeItem(100)]);

    expect(computeItemActivity(entry)).toEqual({
      activeItemCount: 1,
      inactiveItemCount: 0,
      activePct: 1,
    });
  });

  it('handles all-zero entry', () => {
    const entry = reportableEntry([
      makeItem(0, 'Q1_1'),
      makeItem(0, 'Q1_2'),
      makeItem(0, 'Q1_3'),
    ]);

    expect(computeItemActivity(entry)).toEqual({
      activeItemCount: 0,
      inactiveItemCount: 3,
      activePct: 0,
    });
  });
});
