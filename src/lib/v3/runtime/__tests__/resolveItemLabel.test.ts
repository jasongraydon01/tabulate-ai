/**
 * Tests for resolveItemLabel — message-testing label precedence in canonical assembly.
 *
 * Covers:
 *   - Message-testing items with confident matches → messageText used
 *   - Message-testing items below confidence threshold → item.label used
 *   - Non-message-testing items (messageText null) → item.label used
 *   - Scale labels remain unaffected (not routed through resolveItemLabel)
 *   - End-to-end ranking table assembly with message-testing items
 */

import { describe, it, expect } from 'vitest';
import { buildEntryBaseContract, makeEmptyBaseContract, projectTableBaseContract } from '../baseContract';
import {
  resolveItemLabel,
  MESSAGE_LABEL_MIN_CONFIDENCE,
  runCanonicalAssembly,
} from '../canonical/assemble';
import type {
  QuestionIdEntry,
  SurveyMetadata,
  QuestionItem,
  PlannedTable,
  ValidatedPlanOutput,
} from '../canonical/types';

// =============================================================================
// Fixtures
// =============================================================================

function makeItem(overrides: Partial<QuestionItem> = {}): QuestionItem {
  return {
    column: 'Q1_1',
    label: 'Original SPSS label text',
    normalizedType: 'categorical_select',
    itemBase: 100,
    scaleLabels: [],
    messageCode: null,
    messageText: null,
    altCode: null,
    altText: null,
    matchMethod: null,
    matchConfidence: 0,
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<SurveyMetadata> = {}): SurveyMetadata {
  return {
    dataset: 'test-dataset',
    generatedAt: '2026-01-01T00:00:00Z',
    scriptVersion: 'v3-runtime-test',
    isMessageTestingSurvey: false,
    isConceptTestingSurvey: false,
    hasMaxDiff: null,
    hasAnchoredScores: null,
    messageTemplatePath: null,
    isDemandSurvey: false,
    hasChoiceModelExercise: null,
    ...overrides,
  };
}

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  const entry = {
    questionId: 'Q1',
    questionText: 'Test question?',
    variables: ['Q1_1'],
    variableCount: 1,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'test',
    subtypeConfidence: 0.95,
    rankingDetail: null,
    sumConstraint: null,
    pipeColumns: [],
    surveyMatch: 'exact',
    surveyText: null,
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'categorical_select',
    items: [],
    totalN: 200,
    questionBase: 150,
    isFiltered: false,
    gapFromTotal: 50,
    gapPct: 0.25,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
    baseContract: buildEntryBaseContract({
      totalN: 200,
      questionBase: 150,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: 150,
    proposedBaseLabel: 'All respondents',
    hasMessageMatches: false,
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

// =============================================================================
// resolveItemLabel unit tests
// =============================================================================

describe('resolveItemLabel', () => {
  it('returns messageText when matchConfidence >= threshold', () => {
    const item = makeItem({
      label: 'Product concept A helps protect all patients - Which of the following messages would MOST prompt you to prescribe',
      messageText: 'Product concept A helps protect all patients',
      messageCode: '1',
      matchMethod: 'truncation_prefix',
      matchConfidence: 1.0,
    });
    expect(resolveItemLabel(item)).toBe('Product concept A helps protect all patients');
  });

  it('returns messageText at exactly the confidence threshold', () => {
    const item = makeItem({
      label: 'Long label with question stem text attached',
      messageText: 'Clean stimulus text',
      matchConfidence: MESSAGE_LABEL_MIN_CONFIDENCE,
    });
    expect(resolveItemLabel(item)).toBe('Clean stimulus text');
  });

  it('falls back to item.label when matchConfidence is below threshold', () => {
    const item = makeItem({
      label: 'Original label text',
      messageText: 'Low confidence match',
      matchConfidence: 0.5,
    });
    expect(resolveItemLabel(item)).toBe('Original label text');
  });

  it('falls back to item.label when messageText is null', () => {
    const item = makeItem({
      label: 'Plain option label',
      messageText: null,
      matchConfidence: 0,
    });
    expect(resolveItemLabel(item)).toBe('Plain option label');
  });

  it('falls back to item.label when messageText is empty string', () => {
    const item = makeItem({
      label: 'Some label',
      messageText: '',
      matchConfidence: 1.0,
    });
    expect(resolveItemLabel(item)).toBe('Some label');
  });

  it('falls back to item.label when messageText is whitespace-only', () => {
    const item = makeItem({
      label: 'Fallback label',
      messageText: '   ',
      matchConfidence: 1.0,
    });
    expect(resolveItemLabel(item)).toBe('Fallback label');
  });

  it('trims messageText before using it as the row label', () => {
    const item = makeItem({
      label: 'Original label',
      messageText: '  Clean stimulus text  ',
      matchConfidence: 1.0,
    });
    expect(resolveItemLabel(item)).toBe('Clean stimulus text');
  });

  it('non-message-testing item (all null fields) returns item.label', () => {
    const item = makeItem({
      label: 'Yes',
      messageCode: null,
      messageText: null,
      matchMethod: null,
      matchConfidence: 0,
    });
    expect(resolveItemLabel(item)).toBe('Yes');
  });

  it('uses stem-stripped savLabel fallback when no message match is found', () => {
    const item = makeItem({
      label: 'Original SPSS label text',
      savLabel: 'Concept A is compelling - Which of the following messages would MOST prompt you to prescribe',
      messageText: null,
      matchConfidence: 0,
    });
    expect(resolveItemLabel(item)).toBe('Concept A is compelling');
  });

  it('uses deterministic question-text stripping on surveyLabel before falling back to item.label', () => {
    const item = makeItem({
      label: 'Original label text',
      surveyLabel: 'Helps patients stay adherent - Which of the following messages would MOST prompt you to prescribe',
      messageText: null,
      matchConfidence: 0,
    });

    expect(
      resolveItemLabel(
        item,
        'Which of the following messages would MOST prompt you to prescribe?',
      ),
    ).toBe('Helps patients stay adherent');
  });

  it('uses deterministic prefix stripping on item.label when no other cleaned source exists', () => {
    const item = makeItem({
      label: 'Which statement best describes this message: Improves convenience',
      messageText: null,
      matchConfidence: 0,
    });

    expect(
      resolveItemLabel(
        item,
        'Which statement best describes this message?',
      ),
    ).toBe('Improves convenience');
  });

  it('escapes regex metacharacters in questionText when stripping savLabel stems', () => {
    const item = makeItem({
      label: 'PT1: Patient type 1 (prior event or no prior event but high risk)',
      savLabel: 'PT1: Patient type 1 (prior event or no prior event but high risk)',
      messageText: null,
      matchConfidence: 0,
    });

    expect(() =>
      resolveItemLabel(
        item,
        'PT1: Patient type 1 (prior event or no prior event but high risk)',
      ),
    ).not.toThrow();

    expect(
      resolveItemLabel(
        item,
        'PT1: Patient type 1 (prior event or no prior event but high risk)',
      ),
    ).toBe('Patient type 1 (prior event or no prior event but high risk)');
  });
});

// =============================================================================
// Ranking table assembly with message-testing items (B500_1-like scenario)
// =============================================================================

describe('Canonical assembly — ranking table with message matches', () => {
  const RAW_LABEL_PREFIX =
    'Concept A provides the broadest coverage in all patients 6 weeks to 17 years';
  const QUESTION_STEM =
    ' - Which of the following messages would MOST prompt you to prescribe Product as the primary series to your patients';
  const RAW_LABEL = RAW_LABEL_PREFIX + QUESTION_STEM;
  const CLEAN_MESSAGE = 'Concept A provides the broadest coverage in all patients 6 weeks to 17 years';

  function makeMessageRankingEntry(): QuestionIdEntry {
    const items = [
      {
        column: 'B1r101',
        label: RAW_LABEL,
        normalizedType: 'numeric_range',
        itemBase: 100,
        scaleLabels: Array.from({ length: 5 }, (_, k) => ({
          value: k + 1,
          label: `Rank ${k + 1}`,
        })),
        messageCode: '3',
        messageText: CLEAN_MESSAGE,
        altCode: null,
        altText: null,
        matchMethod: 'truncation_prefix' as const,
        matchConfidence: 1.0,
      },
      {
        column: 'B1r102',
        label: 'Start and finish the series with Product to help protect all patients' + QUESTION_STEM,
        normalizedType: 'numeric_range',
        itemBase: 100,
        scaleLabels: Array.from({ length: 5 }, (_, k) => ({
          value: k + 1,
          label: `Rank ${k + 1}`,
        })),
        messageCode: '4',
        messageText: 'Start and finish the series with Product to help protect all patients with the broadest coverage available',
        altCode: null,
        altText: null,
        matchMethod: 'truncation_prefix' as const,
        matchConfidence: 1.0,
      },
      {
        column: 'B1r103',
        label: 'Item without message match',
        normalizedType: 'numeric_range',
        itemBase: 100,
        scaleLabels: Array.from({ length: 5 }, (_, k) => ({
          value: k + 1,
          label: `Rank ${k + 1}`,
        })),
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
    ];

    return makeEntry({
      questionId: 'B1',
      questionText: 'Which of the following messages would MOST prompt you?',
      analyticalSubtype: 'ranking',
      normalizedType: 'numeric_range',
      rankingDetail: { K: 5, N: 3, pattern: '5 of 3', source: 'scale-labels' },
      items,
      variables: items.map(i => i.column),
      variableCount: 3,
      hasMessageMatches: true,
    });
  }

  function makeRankingPlannedTable(): PlannedTable {
    return {
      dataset: 'test-dataset',
      sourceQuestionId: 'B1',
      sourceLoopQuestionId: null,
      familyRoot: 'B1',
      analyticalSubtype: 'ranking',
      normalizedType: 'numeric_range',
      tableKind: 'ranking_overview_rank',
      tableRole: 'overview_rank_1',
      tableIdCandidate: 'b1__ranking_overview_rank1',
      sortBlock: 'B',
      sortFamily: 'B1',
      basePolicy: 'question_base',
      baseSource: 'B1',
      splitReason: null,
      baseViewRole: 'anchor',
      questionBase: 150,
      itemBase: null,
      baseContract: projectTableBaseContract(makeEmptyBaseContract(), {
        basePolicy: 'question_base',
        questionBase: 150,
        itemBase: null,
      }),
      appliesToItem: null,
      computeMaskAnchorVariable: null,
      appliesToColumn: null,
      stimuliSetSlice: null,
      binarySide: null,
      notes: [],
      inputsUsed: ['B1'],
    };
  }

  it('uses messageText for matched items and item.label for unmatched', () => {
    const entry = makeMessageRankingEntry();
    const planned = makeRankingPlannedTable();
    const validated: ValidatedPlanOutput = {
      metadata: {},
      plannedTables: [planned],
      subtypeReviews: [],
      blockConfidence: [],
    };

    const output = runCanonicalAssembly({
      validatedPlan: validated,
      entries: [entry],
      metadata: makeMetadata({ isMessageTestingSurvey: true }),
      dataset: 'test-dataset',
    });

    expect(output.tables).toHaveLength(1);
    const table = output.tables[0];
    expect(table.rows).toHaveLength(3);

    // Row 1: matched → clean message text (no question stem)
    expect(table.rows[0].variable).toBe('B1r101');
    expect(table.rows[0].label).toBe(CLEAN_MESSAGE);
    expect(table.rows[0].label).not.toContain('Which of the following');

    // Row 2: matched → clean message text
    expect(table.rows[1].variable).toBe('B1r102');
    expect(table.rows[1].label).toBe(
      'Start and finish the series with Product to help protect all patients with the broadest coverage available',
    );
    expect(table.rows[1].label).not.toContain('Which of the following');

    // Row 3: unmatched → original item label preserved
    expect(table.rows[2].variable).toBe('B1r103');
    expect(table.rows[2].label).toBe('Item without message match');
  });

  it('preserves rowKind=rank and rankLevel on message-resolved rows', () => {
    const entry = makeMessageRankingEntry();
    const planned = makeRankingPlannedTable();
    const validated: ValidatedPlanOutput = {
      metadata: {},
      plannedTables: [planned],
      subtypeReviews: [],
      blockConfidence: [],
    };

    const output = runCanonicalAssembly({
      validatedPlan: validated,
      entries: [entry],
      metadata: makeMetadata({ isMessageTestingSurvey: true }),
      dataset: 'test-dataset',
    });

    for (const row of output.tables[0].rows) {
      expect(row.rowKind).toBe('rank');
      expect(row.rankLevel).toBe(1);
    }
  });
});

// =============================================================================
// Standard overview assembly with message matches
// =============================================================================

describe('Canonical assembly — standard overview with message matches', () => {
  it('uses messageText for multi-item overview rows', () => {
    const items = [
      {
        column: 'Q5_1',
        label: 'Concept X is the best option - For the next set of questions rate how appealing each message is',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels: [
          { value: 0, label: 'Not selected' },
          { value: 1, label: 'Selected' },
        ],
        messageCode: 'X1',
        messageText: 'Concept X is the best option for your needs',
        altCode: null,
        altText: null,
        matchMethod: 'code_extraction' as const,
        matchConfidence: 1.0,
      },
      {
        column: 'Q5_2',
        label: 'Normal item without message',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels: [
          { value: 0, label: 'Not selected' },
          { value: 1, label: 'Selected' },
        ],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
    ];

    const entry = makeEntry({
      questionId: 'Q5',
      items,
      variables: ['Q5_1', 'Q5_2'],
      variableCount: 2,
      hasMessageMatches: true,
    });

    const planned: PlannedTable = {
      dataset: 'test-dataset',
      sourceQuestionId: 'Q5',
      sourceLoopQuestionId: null,
      familyRoot: 'Q5',
      analyticalSubtype: 'standard',
      normalizedType: 'categorical_select',
      tableKind: 'standard_overview',
      tableRole: 'overview',
      tableIdCandidate: 'q5__standard_overview',
      sortBlock: 'Q',
      sortFamily: 'Q5',
      basePolicy: 'question_base',
      baseSource: 'Q5',
      splitReason: null,
      baseViewRole: 'anchor',
      questionBase: 150,
      itemBase: null,
      baseContract: projectTableBaseContract(makeEmptyBaseContract(), {
        basePolicy: 'question_base',
        questionBase: 150,
        itemBase: null,
      }),
      appliesToItem: null,
      computeMaskAnchorVariable: null,
      appliesToColumn: null,
      stimuliSetSlice: null,
      binarySide: null,
      notes: [],
      inputsUsed: ['Q5'],
    };

    const validated: ValidatedPlanOutput = {
      metadata: {},
      plannedTables: [planned],
      subtypeReviews: [],
      blockConfidence: [],
    };

    const output = runCanonicalAssembly({
      validatedPlan: validated,
      entries: [entry],
      metadata: makeMetadata({ isMessageTestingSurvey: true }),
      dataset: 'test-dataset',
    });

    const rows = output.tables[0].rows;
    expect(rows[0].label).toBe('Concept X is the best option for your needs');
    expect(rows[1].label).toBe('Normal item without message');
  });
});

// =============================================================================
// Non-message-testing survey — no label changes
// =============================================================================

describe('Canonical assembly — non-message-testing survey unaffected', () => {
  it('uses original item.label when no message fields populated', () => {
    const items = [
      {
        column: 'Q2_1',
        label: 'Brand A',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels: [
          { value: 0, label: 'Not selected' },
          { value: 1, label: 'Selected' },
        ],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
      {
        column: 'Q2_2',
        label: 'Brand B',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels: [
          { value: 0, label: 'Not selected' },
          { value: 1, label: 'Selected' },
        ],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
    ];

    const entry = makeEntry({
      questionId: 'Q2',
      items,
      variables: ['Q2_1', 'Q2_2'],
      variableCount: 2,
    });

    const planned: PlannedTable = {
      dataset: 'test-dataset',
      sourceQuestionId: 'Q2',
      sourceLoopQuestionId: null,
      familyRoot: 'Q2',
      analyticalSubtype: 'standard',
      normalizedType: 'categorical_select',
      tableKind: 'standard_overview',
      tableRole: 'overview',
      tableIdCandidate: 'q2__standard_overview',
      sortBlock: 'Q',
      sortFamily: 'Q2',
      basePolicy: 'question_base',
      baseSource: 'Q2',
      splitReason: null,
      baseViewRole: 'anchor',
      questionBase: 150,
      itemBase: null,
      baseContract: projectTableBaseContract(makeEmptyBaseContract(), {
        basePolicy: 'question_base',
        questionBase: 150,
        itemBase: null,
      }),
      appliesToItem: null,
      computeMaskAnchorVariable: null,
      appliesToColumn: null,
      stimuliSetSlice: null,
      binarySide: null,
      notes: [],
      inputsUsed: ['Q2'],
    };

    const validated: ValidatedPlanOutput = {
      metadata: {},
      plannedTables: [planned],
      subtypeReviews: [],
      blockConfidence: [],
    };

    const output = runCanonicalAssembly({
      validatedPlan: validated,
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test-dataset',
    });

    const rows = output.tables[0].rows;
    expect(rows[0].label).toBe('Brand A');
    expect(rows[1].label).toBe('Brand B');
  });
});

// =============================================================================
// Scale tables — scale labels remain authoritative
// =============================================================================

describe('Canonical assembly — scale labels not overridden by message fields', () => {
  it('scale_overview_full uses scale point labels, not messageText', () => {
    const scaleLabels = [
      { value: 1, label: 'Strongly Disagree' },
      { value: 2, label: 'Disagree' },
      { value: 3, label: 'Neutral' },
      { value: 4, label: 'Agree' },
      { value: 5, label: 'Strongly Agree' },
    ];

    const items = [
      {
        column: 'S1_1',
        label: 'Rate this concept - How appealing is this message',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels,
        // Even though messageText exists, scale point labels (sl.label) should be used
        messageCode: '1',
        messageText: 'Clean stimulus for this concept',
        altCode: null,
        altText: null,
        matchMethod: 'truncation_prefix' as const,
        matchConfidence: 1.0,
      },
    ];

    const entry = makeEntry({
      questionId: 'S1',
      analyticalSubtype: 'scale',
      normalizedType: 'categorical_select',
      items,
      variables: ['S1_1'],
      variableCount: 1,
      hasMessageMatches: true,
    });

    const planned: PlannedTable = {
      dataset: 'test-dataset',
      sourceQuestionId: 'S1',
      sourceLoopQuestionId: null,
      familyRoot: 'S1',
      analyticalSubtype: 'scale',
      normalizedType: 'categorical_select',
      tableKind: 'scale_overview_full',
      tableRole: 'overview_full',
      tableIdCandidate: 's1__scale_overview_full',
      sortBlock: 'S',
      sortFamily: 'S1',
      basePolicy: 'question_base',
      baseSource: 'S1',
      splitReason: null,
      baseViewRole: 'anchor',
      questionBase: 150,
      itemBase: null,
      baseContract: projectTableBaseContract(makeEmptyBaseContract(), {
        basePolicy: 'question_base',
        questionBase: 150,
        itemBase: null,
      }),
      appliesToItem: null,
      computeMaskAnchorVariable: null,
      appliesToColumn: null,
      stimuliSetSlice: null,
      binarySide: null,
      notes: [],
      inputsUsed: ['S1'],
    };

    const validated: ValidatedPlanOutput = {
      metadata: {},
      plannedTables: [planned],
      subtypeReviews: [],
      blockConfidence: [],
    };

    const output = runCanonicalAssembly({
      validatedPlan: validated,
      entries: [entry],
      metadata: makeMetadata({ isMessageTestingSurvey: true }),
      dataset: 'test-dataset',
    });

    // Scale full distribution: rows should be scale point labels + nets + stats
    const valueLabels = output.tables[0].rows
      .filter(r => r.rowKind === 'value')
      .map(r => r.label);

    // Scale point labels should be present, NOT messageText
    expect(valueLabels).toContain('Strongly Agree');
    expect(valueLabels).toContain('Agree');
    expect(valueLabels).toContain('Neutral');
    expect(valueLabels).toContain('Disagree');
    expect(valueLabels).toContain('Strongly Disagree');
    expect(valueLabels).not.toContain('Clean stimulus for this concept');
  });
});
