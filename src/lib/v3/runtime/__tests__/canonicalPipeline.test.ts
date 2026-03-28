/**
 * V3 Runtime — Canonical Pipeline Tests (Phase 2: Stages 13b–13d)
 *
 * Tests cover:
 * - Stage range/order for 13b→13d
 * - Checkpoint progression through phase-2 boundaries
 * - Table planner deterministic behavior
 * - Scale classification
 * - Canonical output schema/invariants
 * - Correction re-derivation behavior
 */

import { describe, it, expect } from 'vitest';
import { buildEntryBaseContract, makeEmptyBaseContract, projectTableBaseContract } from '../baseContract';
import {
  getStageRange,
  V3_STAGE_PHASES,
  V3_STAGE_NAMES,
  isBefore,
  type V3StageId,
} from '../stageOrder';
import {
  V3_STAGE_ARTIFACTS,
  createPipelineCheckpoint,
  recordStageCompletion,
} from '../contracts';
import {
  runTablePlanner,
  buildContext,
  planEntryTables,
  classifyScale,
  DEFAULT_PLANNER_CONFIG,
  buildPlannerBaseDisclosure,
} from '../canonical/plan';
import { runCanonicalAssembly } from '../canonical/assemble';
import { renderBaseDisclosureNoteParts } from '../canonical/baseDisclosurePresentation';
import type {
  QuestionIdEntry,
  SurveyMetadata,
  PlannedTable,
  PlannerAmbiguity,
  PlannerConfig,
  PlannerBaseSignal,
  BaseDecision,
} from '../canonical/types';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';

// =============================================================================
// Test Fixtures
// =============================================================================

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
    variables: ['Q1_1', 'Q1_2'],
    variableCount: 2,
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
    items: [
      {
        column: 'Q1_1',
        label: 'Option A',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels: [
          { value: 1, label: 'Yes' },
          { value: 2, label: 'No' },
        ],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
      {
        column: 'Q1_2',
        label: 'Option B',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels: [
          { value: 1, label: 'Yes' },
          { value: 2, label: 'No' },
        ],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
    ],
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

function makeScaleEntry(
  _pointCount: number,
  labels: Array<{ value: number; label: string }>,
  overrides: Partial<QuestionIdEntry> = {},
): QuestionIdEntry {
  return makeEntry({
    questionId: 'S1',
    analyticalSubtype: 'scale',
    items: [
      {
        column: 'S1_1',
        label: 'Rating item 1',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels: labels,
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
    ],
    ...overrides,
  });
}

function makeRankingEntry(K: number, N: number): QuestionIdEntry {
  const items = Array.from({ length: N }, (_, i) => ({
    column: `R1_${i + 1}`,
    label: `Item ${i + 1}`,
    normalizedType: 'categorical_select',
    itemBase: 100,
    scaleLabels: Array.from({ length: K }, (__, k) => ({
      value: k + 1,
      label: `Rank ${k + 1}`,
    })),
    messageCode: null,
    messageText: null,
    altCode: null,
    altText: null,
    matchMethod: null,
    matchConfidence: 0,
  }));

  return makeEntry({
    questionId: 'R1',
    analyticalSubtype: 'ranking',
    rankingDetail: { K, N, pattern: `${K} of ${N}`, source: 'scale-labels' },
    items,
    variables: items.map(i => i.column),
    variableCount: N,
  });
}

function makeStimulusItem(
  column: string,
  code: string,
  text: string,
  scaleLabels: Array<{ value: number | string; label: string }>,
  overrides: Partial<QuestionIdEntry['items'][number]> = {},
): QuestionIdEntry['items'][number] {
  return {
    column,
    label: text,
    normalizedType: 'categorical_select',
    itemBase: 100,
    scaleLabels,
    messageCode: code,
    messageText: text,
    altCode: null,
    altText: null,
    matchMethod: 'code_extraction',
    matchConfidence: 1,
    ...overrides,
  };
}

function makeStimuliSetSourceEntries(overrides: {
  firstHidden?: boolean;
} = {}): QuestionIdEntry[] {
  const binaryLabels = [
    { value: 0, label: 'Not selected' },
    { value: 1, label: 'Selected' },
  ];

  const sourceIds = ['B500', 'B501', 'B502'];
  return sourceIds.map((questionId, index) => {
    const items = Array.from({ length: 3 }, (_, itemIndex) => {
      const codeNumber = index * 3 + itemIndex + 1;
      const code = `MSG${String(codeNumber).padStart(2, '0')}`;
      return makeStimulusItem(
        `${questionId}r${101 + itemIndex}`,
        code,
        `Message ${code}`,
        binaryLabels,
      );
    });

    const stimuliSets = index === 0 ? {
      detected: true as const,
      setCount: 3,
      familySource: 'B500',
      sets: sourceIds.map((sourceQuestionId, setIndex) => ({
        setIndex,
        sourceQuestionId,
        items: Array.from({ length: 3 }, (_, itemIndex) => `${sourceQuestionId}r${101 + itemIndex}`),
        itemCount: 3,
      })),
      detectionMethod: 'label_comparison' as const,
    } : null;

    return makeEntry({
      questionId,
      questionText: `Stimulus source set ${index + 1}`,
      analyticalSubtype: 'standard',
      normalizedType: 'binary_flag',
      items,
      variables: items.map(item => item.column),
      variableCount: items.length,
      hasMessageMatches: true,
      isHidden: index === 0 && overrides.firstHidden === true,
      stimuliSets,
    });
  });
}

function makePerSetRankingEntry(itemCount = 9, questionId = 'B700'): QuestionIdEntry {
  const items = Array.from({ length: itemCount }, (_, i) => {
    const code = `MSG${String(i + 1).padStart(2, '0')}`;
    return makeStimulusItem(
      `${questionId}r${101 + i}`,
      code,
      `Message ${code}`,
      [
        { value: 1, label: 'Rank 1' },
        { value: 2, label: 'Rank 2' },
        { value: 3, label: 'Rank 3' },
      ],
    );
  });

  return makeEntry({
    questionId,
    questionText: 'Which of these messages is most motivating?',
    analyticalSubtype: 'ranking',
    normalizedType: 'numeric_range',
    rankingDetail: { K: 3, N: items.length, pattern: '3 of 9', source: 'scale-labels' },
    items,
    variables: items.map(item => item.column),
    variableCount: items.length,
    questionBase: 150,
    hasMessageMatches: true,
  });
}

function makeDeadColumnStimuliSetSourceEntries(): QuestionIdEntry[] {
  const rankingLabels = [
    { value: 1, label: 'Rank 1' },
    { value: 2, label: 'Rank 2' },
  ];
  const setDefs = [
    {
      sourceQuestionId: 'C500_1',
      allColumns: ['C500_1r101c1', 'C500_1r101c2', 'C500_1r102c1', 'C500_1r102c2'],
    },
    {
      sourceQuestionId: 'C500_2',
      allColumns: ['C500_2r201c1', 'C500_2r201c2', 'C500_2r202c1', 'C500_2r202c2'],
    },
  ];

  const c500_1 = makeEntry({
    questionId: 'C500_1',
    questionText: 'Scenario C set 1',
    analyticalSubtype: 'ranking',
    normalizedType: 'numeric_range',
    rankingDetail: { K: 2, N: 4, pattern: '2 of 4', source: 'scale-labels' },
    items: [
      makeStimulusItem('C500_1r101c1', 'MSG01', 'Message MSG01', rankingLabels, { itemBase: 0 }),
      makeStimulusItem('C500_1r101c2', 'MSG01', 'Message MSG01', rankingLabels, { itemBase: 100 }),
      makeStimulusItem('C500_1r102c1', 'MSG02', 'Message MSG02', rankingLabels, { itemBase: 0 }),
      makeStimulusItem('C500_1r102c2', 'MSG02', 'Message MSG02', rankingLabels, { itemBase: 100 }),
    ],
    variables: ['C500_1r101c1', 'C500_1r101c2', 'C500_1r102c1', 'C500_1r102c2'],
    variableCount: 4,
    hasMessageMatches: true,
    stimuliSets: {
      detected: true,
      setCount: 2,
      familySource: 'C500',
      sets: setDefs.map((setDef, setIndex) => ({
        setIndex,
        sourceQuestionId: setDef.sourceQuestionId,
        items: setDef.allColumns,
        itemCount: setDef.allColumns.length,
      })),
      detectionMethod: 'label_comparison',
    },
  });

  const c500_2 = makeEntry({
    questionId: 'C500_2',
    questionText: 'Scenario C set 2',
    analyticalSubtype: 'ranking',
    normalizedType: 'numeric_range',
    rankingDetail: { K: 2, N: 4, pattern: '2 of 4', source: 'scale-labels' },
    items: [
      makeStimulusItem('C500_2r201c1', 'MSG03', 'Message MSG03', rankingLabels, { itemBase: 0 }),
      makeStimulusItem('C500_2r201c2', 'MSG03', 'Message MSG03', rankingLabels, { itemBase: 100 }),
      makeStimulusItem('C500_2r202c1', 'MSG04', 'Message MSG04', rankingLabels, { itemBase: 0 }),
      makeStimulusItem('C500_2r202c2', 'MSG04', 'Message MSG04', rankingLabels, { itemBase: 100 }),
    ],
    variables: ['C500_2r201c1', 'C500_2r201c2', 'C500_2r202c1', 'C500_2r202c2'],
    variableCount: 4,
    hasMessageMatches: true,
    stimuliSets: null,
  });

  const b500 = makeStimuliSetSourceEntries();
  return [...b500, c500_1, c500_2];
}

function makePerSetBinaryEntry(itemCount = 9): QuestionIdEntry {
  const items = Array.from({ length: itemCount }, (_, i) => {
    const code = `MSG${String(i + 1).padStart(2, '0')}`;
    return makeStimulusItem(
      `B800r${101 + i}`,
      code,
      `Message ${code}`,
      [
        { value: 0, label: 'Not selected' },
        { value: 1, label: 'Selected' },
      ],
      { normalizedType: 'binary_flag' },
    );
  });

  return makeEntry({
    questionId: 'B800',
    questionText: 'Which messages apply to this concept?',
    analyticalSubtype: 'standard',
    normalizedType: 'binary_flag',
    items,
    variables: items.map(item => item.column),
    variableCount: items.length,
    questionBase: 150,
    hasMessageMatches: true,
  });
}

function makePerSetYesNoEntry(itemCount = 9, questionId = 'B800'): QuestionIdEntry {
  const itemBases = Array.from({ length: itemCount }, (_, i) => 8 + i);
  const items = Array.from({ length: itemCount }, (_, i) => {
    const code = `MSG${String(i + 1).padStart(2, '0')}`;
    return makeStimulusItem(
      `${questionId}r${101 + i}`,
      code,
      `Message ${code}`,
      [
        { value: 1, label: 'Yes' },
        { value: 2, label: 'No' },
      ],
      {
        normalizedType: 'categorical_select',
        itemBase: itemBases[i],
      },
    );
  });

  return makeEntry({
    questionId,
    questionText: 'Would this message truly motivate you?',
    analyticalSubtype: 'standard',
    normalizedType: 'categorical_select',
    items,
    variables: items.map(item => item.column),
    variableCount: items.length,
    questionBase: 177,
    totalN: 177,
    hasVariableItemBases: true,
    variableBaseReason: 'genuine',
    itemBaseRange: [Math.min(...itemBases), Math.max(...itemBases)],
    hasMessageMatches: true,
  });
}

// =============================================================================
// Stage Order / Phase Tests
// =============================================================================

describe('Canonical chain stage order', () => {
  it('getStageRange returns correct stages for 13b→13d', () => {
    const range = getStageRange('13b', '13d');
    expect(range).toEqual(['13b', '13c1', '13c2', '13d']);
  });

  it('all canonical stages are in table-chain phase', () => {
    const tableStages: V3StageId[] = ['13b', '13c1', '13c2', '13d', '13e'];
    for (const stage of tableStages) {
      expect(V3_STAGE_PHASES[stage]).toBe('table-chain');
    }
  });

  it('canonical stages execute after question-id chain', () => {
    expect(isBefore('12', '13b')).toBe(true);
  });

  it('canonical stages execute before banner chain', () => {
    expect(isBefore('13d', '20')).toBe(true);
  });

  it('all canonical stages have names', () => {
    const stages: V3StageId[] = ['13b', '13c1', '13c2', '13d', '13e'];
    for (const stage of stages) {
      expect(V3_STAGE_NAMES[stage]).toBeDefined();
      expect(V3_STAGE_NAMES[stage].length).toBeGreaterThan(0);
    }
  });

  it('all canonical stages have artifact names', () => {
    expect(V3_STAGE_ARTIFACTS['13b']).toBe('tables/13b-table-plan.json');
    expect(V3_STAGE_ARTIFACTS['13c1']).toBe('tables/13c-table-plan-validated.json');
    expect(V3_STAGE_ARTIFACTS['13c2']).toBe('tables/13c-table-plan-validated.json');
    expect(V3_STAGE_ARTIFACTS['13d']).toBe('tables/13d-table-canonical.json');
    expect(V3_STAGE_ARTIFACTS['13e']).toBe('tables/13e-table-enriched.json');
  });
});

// =============================================================================
// Checkpoint Progression Tests
// =============================================================================

describe('Checkpoint progression through phase-2 boundaries', () => {
  it('records 13b completion and advances to 13c1', () => {
    const cp = createPipelineCheckpoint('run-p2', 'test-dataset');
    // Simulate completion of stages 00-12
    let updated = cp;
    const qidStages: V3StageId[] = ['00', '03', '08a', '09d', '10a', '10', '11', '12'];
    for (const stage of qidStages) {
      updated = recordStageCompletion(updated, stage, 100);
    }

    expect(updated.lastCompletedStage).toBe('12');
    expect(updated.nextStage).toBe('13b');

    // Complete 13b
    updated = recordStageCompletion(updated, '13b', 500);
    expect(updated.lastCompletedStage).toBe('13b');
    expect(updated.nextStage).toBe('13c1');
  });

  it('progresses through 13c1 → 13c2 → 13d', () => {
    let cp = createPipelineCheckpoint('run-p2-full', 'test-dataset');

    // Complete all prior stages
    const stages: V3StageId[] = ['00', '03', '08a', '09d', '10a', '10', '11', '12'];
    for (const stage of stages) {
      cp = recordStageCompletion(cp, stage, 100);
    }

    cp = recordStageCompletion(cp, '13b', 500);
    expect(cp.nextStage).toBe('13c1');

    cp = recordStageCompletion(cp, '13c1', 300);
    expect(cp.nextStage).toBe('13c2');

    cp = recordStageCompletion(cp, '13c2', 300);
    expect(cp.nextStage).toBe('13d');

    cp = recordStageCompletion(cp, '13d', 200);
    expect(cp.nextStage).toBe('13e');

    cp = recordStageCompletion(cp, '13e', 50);
    expect(cp.nextStage).toBe('20');
    expect(cp.completedStages).toHaveLength(13);
  });
});

// =============================================================================
// Table Planner Tests (13b)
// =============================================================================

describe('Table planner (13b)', () => {
  it('plans standard frequency tables for a basic question', () => {
    const entry = makeEntry();
    const metadata = makeMetadata();

    const result = runTablePlanner({
      entries: [entry],
      metadata,
      dataset: 'test-dataset',
    });

    expect(result.plannedTables.length).toBeGreaterThan(0);
    expect(result.plannedTables[0].tableKind).toBe('standard_overview');
    expect(result.plannedTables[0].sourceQuestionId).toBe('Q1');
    expect(result.plannedTables[0].dataset).toBe('test-dataset');
  });

  it('excludes non-reportable entries from planning', () => {
    const excluded = makeEntry({ disposition: 'excluded', questionId: 'Q_EX' });
    const reportable = makeEntry({ questionId: 'Q_REP' });
    const metadata = makeMetadata();

    const result = runTablePlanner({
      entries: [excluded, reportable],
      metadata,
      dataset: 'test-dataset',
    });

    const qids = new Set(result.plannedTables.map(t => t.sourceQuestionId));
    expect(qids.has('Q_EX')).toBe(false);
    expect(qids.has('Q_REP')).toBe(true);
  });

  it('orders reportable entries by screener-first family order before planning', () => {
    const entries = [
      makeEntry({ questionId: 'A1' }),
      makeEntry({ questionId: 'S8' }),
      makeEntry({ questionId: 'B1' }),
      makeEntry({
        questionId: 'hS18b_B_',
        displayQuestionId: 'S18b_B',
        isHidden: true,
        hiddenLink: { linkedTo: 'S18b_B', linkMethod: 'underscore_strip' },
      }),
      makeEntry({ questionId: 'S2' }),
      makeEntry({ questionId: 'S18b_B' }),
    ];

    const result = runTablePlanner({
      entries,
      metadata: makeMetadata(),
      dataset: 'test-dataset',
    });

    const plannedQuestionOrder = [
      ...new Set(
        result.plannedTables
          .map(table => table.sourceQuestionId)
          .filter((qid): qid is string => Boolean(qid)),
      ),
    ];

    expect(plannedQuestionOrder.indexOf('S2')).toBeLessThan(plannedQuestionOrder.indexOf('S8'));
    expect(plannedQuestionOrder.indexOf('S8')).toBeLessThan(plannedQuestionOrder.indexOf('A1'));
    expect(plannedQuestionOrder.indexOf('A1')).toBeLessThan(plannedQuestionOrder.indexOf('B1'));
    expect(plannedQuestionOrder.indexOf('S18b_B')).toBeLessThan(plannedQuestionOrder.indexOf('hS18b_B_'));
  });

  it('plans ranking tables with overview rank and item rank', () => {
    const entry = makeRankingEntry(5, 5);
    const metadata = makeMetadata();

    const result = runTablePlanner({
      entries: [entry],
      metadata,
      dataset: 'test-dataset',
    });

    const kinds = result.plannedTables.map(t => t.tableKind);
    expect(kinds).toContain('ranking_overview_rank');
    expect(kinds).toContain('ranking_item_rank');
    expect(result.plannedTables.some(t => t.tableKind === 'ranking_overview_rank' && t.tableRole === 'overview_rank_4')).toBe(true);
    expect(result.plannedTables.some(t => t.tableKind === 'ranking_overview_rank' && t.tableRole === 'overview_rank_5')).toBe(true);
  });

  it('produces deterministic output for same input', () => {
    const entry = makeEntry({ questionId: 'DET1' });
    const metadata = makeMetadata();

    const result1 = runTablePlanner({ entries: [entry], metadata, dataset: 'ds' });
    const result2 = runTablePlanner({ entries: [entry], metadata, dataset: 'ds' });

    expect(result1.plannedTables.length).toBe(result2.plannedTables.length);
    for (let i = 0; i < result1.plannedTables.length; i++) {
      expect(result1.plannedTables[i].tableIdCandidate).toBe(
        result2.plannedTables[i].tableIdCandidate,
      );
      expect(result1.plannedTables[i].tableKind).toBe(
        result2.plannedTables[i].tableKind,
      );
    }
  });

  it('populates summary counts correctly', () => {
    const entries = [
      makeEntry({ questionId: 'Q1' }),
      makeEntry({ questionId: 'Q2' }),
    ];
    const metadata = makeMetadata();

    const result = runTablePlanner({ entries, metadata, dataset: 'test' });

    expect(result.summary.reportableQuestions).toBe(2);
    expect(result.summary.plannedTables).toBe(result.plannedTables.length);
  });

  it('emits additive planner metadata on planned tables and question diagnostics', () => {
    const entry = makeEntry({
      totalN: 220,
      questionBase: 180,
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [80, 120],
      items: [
        {
          column: 'Q1_1',
          label: 'Option A',
          normalizedType: 'categorical_select',
          itemBase: 120,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_2',
          label: 'Option B',
          normalizedType: 'categorical_select',
          itemBase: 80,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });

    const result = runTablePlanner({ entries: [entry], metadata: makeMetadata(), dataset: 'test' });
    const planned = result.plannedTables[0];
    const diagnostic = result.summary.questionDiagnostics[0];

    expect(planned.baseViewRole).toBe('anchor');
    expect(planned.plannerBaseComparability).toBe('split_recommended');
    expect(planned.computeRiskSignals).toContain('compute-mask-required');
    expect(diagnostic.baseComparability).toBe('split_recommended');
    expect(diagnostic.minBase).toBe(80);
    expect(diagnostic.maxBase).toBe(120);
    expect(diagnostic.absoluteSpread).toBe(40);
    expect(diagnostic.relativeSpread).toBeCloseTo(40 / 120);
  });

  it('carries allocation sum constraints into canonical tables', () => {
    const entry = makeEntry({
      questionId: 'A3a',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      sumConstraint: {
        detected: true,
        constraintValue: 100,
        constraintAxis: 'across-cols',
        confidence: 1,
      },
      items: [
        {
          column: 'A3ar1c1',
          label: 'Product A (generic)',
          normalizedType: 'numeric_range',
          itemBase: 141,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'A3ar1c2',
          label: 'Product A (generic)',
          normalizedType: 'numeric_range',
          itemBase: 141,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
      variables: ['A3ar1c1', 'A3ar1c2'],
      variableCount: 2,
    });

    const planned: PlannedTable = {
      dataset: 'test',
      sourceQuestionId: 'A3a',
      sourceLoopQuestionId: null,
      familyRoot: 'A3a',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      tableKind: 'grid_row_detail',
      tableRole: 'detail',
      tableIdCandidate: 'a3a__allocation_grid_row_r1',
      sortBlock: 'test::A3a',
      sortFamily: 'survey_anchored',
      basePolicy: 'item_base',
      baseSource: 'questionBase',
      splitReason: null,
      baseViewRole: 'precision',
      questionBase: 150,
      itemBase: 141,
      baseContract: projectTableBaseContract(makeEmptyBaseContract(), {
        basePolicy: 'item_base',
        questionBase: 150,
        itemBase: 141,
      }),
      appliesToItem: 'r1',
      computeMaskAnchorVariable: 'A3ar1c1',
      appliesToColumn: 'A3ar1c1,A3ar1c2',
      stimuliSetSlice: null,
      binarySide: null,
      notes: [],
      inputsUsed: [],
    };

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(result.tables[0]?.sumConstraint).toEqual({
      detected: true,
      constraintValue: 100,
      constraintAxis: 'across-cols',
      confidence: 1,
    });
  });

  it('stores a real compute mask anchor on precision grid slices while preserving synthetic display keys', () => {
    const entry = makeEntry({
      questionId: 'D300b',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      questionBase: 86,
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [0, 86],
      sumConstraint: {
        detected: true,
        constraintValue: 100,
        constraintAxis: 'across-cols',
        confidence: 1,
      },
      items: [
        {
          column: 'D300br1c1',
          label: 'Product X',
          normalizedType: 'numeric_range',
          itemBase: 43,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br2c1',
          label: 'Pneumovax',
          normalizedType: 'numeric_range',
          itemBase: 43,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br3c1',
          label: 'Capvaxive',
          normalizedType: 'numeric_range',
          itemBase: 0,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br1c2',
          label: 'Product X',
          normalizedType: 'numeric_range',
          itemBase: 86,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br2c2',
          label: 'Pneumovax',
          normalizedType: 'numeric_range',
          itemBase: 86,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br3c2',
          label: 'Capvaxive',
          normalizedType: 'numeric_range',
          itemBase: 86,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
      variables: ['D300br1c1', 'D300br2c1', 'D300br3c1', 'D300br1c2', 'D300br2c2', 'D300br3c2'],
      variableCount: 6,
    });

    const result = runTablePlanner({ entries: [entry], metadata: makeMetadata(), dataset: 'test' });
    const rowSlice = result.plannedTables.find(t => t.tableIdCandidate === 'd300b__allocation_grid_row_r1');
    const colSlice = result.plannedTables.find(t => t.tableIdCandidate === 'd300b__allocation_grid_col_c1');

    expect(rowSlice?.appliesToItem).toBe('r1');
    expect(rowSlice?.computeMaskAnchorVariable).toBe('D300br1c1');
    expect(colSlice?.appliesToItem).toBe('c1');
    expect(colSlice?.computeMaskAnchorVariable).toBe('D300br1c1');
  });

  it('suppresses survey-piped allocation columns and falls back to binned item detail tables', () => {
    const entry = makeEntry({
      questionId: 'D900',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      sumConstraint: {
        detected: true,
        constraintValue: 100,
        constraintAxis: 'down-rows',
        confidence: 1,
      },
      surveyText: [
        '| | | ORIGINAL RESPONSE given current recommendations | RESPONSE AFTER MERCK STORY | RESPONSE AFTER PFIZER STORY |',
        '| --- | --- | --- | --- | --- |',
        '| 1 | ProductX (PCV20) | {{PROG: PIPE IN A200a}} | {{PROG: PIPE IN D300a}} | _______% |',
        '| 2 | Product Y (Type B) | {{PROG: PIPE IN A200a}} | {{PROG: PIPE IN D300a}} | _______% |',
      ].join('\n'),
      items: [
        {
          column: 'D900r1c1',
          label: 'ProductX (PCV20) - ORIGINAL RESPONSE given current recommendations',
          normalizedType: 'numeric_range',
          itemBase: 177,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D900r2c1',
          label: 'Product Y (Type B) - ORIGINAL RESPONSE given current recommendations',
          normalizedType: 'numeric_range',
          itemBase: 177,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D900r1c2',
          label: 'ProductX (PCV20) - RESPONSE AFTER MERCK STORY',
          normalizedType: 'numeric_range',
          itemBase: 177,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D900r2c2',
          label: 'Product Y (Type B) - RESPONSE AFTER MERCK STORY',
          normalizedType: 'numeric_range',
          itemBase: 177,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D900r1c3',
          label: 'ProductX (PCV20) - RESPONSE AFTER PFIZER STORY',
          normalizedType: 'numeric_range',
          itemBase: 177,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D900r2c3',
          label: 'Product Y (Type B) - RESPONSE AFTER PFIZER STORY',
          normalizedType: 'numeric_range',
          itemBase: 177,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
      variables: ['D900r1c1', 'D900r2c1', 'D900r1c2', 'D900r2c2', 'D900r1c3', 'D900r2c3'],
      variableCount: 6,
      questionBase: 177,
    });

    const planned = runTablePlanner({ entries: [entry], metadata: makeMetadata(), dataset: 'test' });

    expect(planned.plannedTables.some(t => t.tableKind === 'grid_row_detail' || t.tableKind === 'grid_col_detail')).toBe(false);
    expect(planned.plannedTables.filter(t => t.tableKind === 'allocation_item_detail')).toHaveLength(2);
    expect(planned.plannedTables.map(t => t.appliesToItem)).toContain('D900r1c3');
    expect(planned.plannedTables.map(t => t.appliesToItem)).toContain('D900r2c3');

    const assembled = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: planned.plannedTables,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const detailTable = assembled.tables.find(t => t.tableKind === 'allocation_item_detail' && t.appliesToItem === 'D900r1c3');
    expect(detailTable).toBeDefined();
    expect(detailTable?.rows.some(row => row.rowKind === 'bin')).toBe(true);
  });

  it('treats survey pipe-plus-n-a columns as reference-only in allocation grids', () => {
    const entry = makeEntry({
      questionId: 'D300b',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      sumConstraint: {
        detected: true,
        constraintValue: 100,
        constraintAxis: 'down-rows',
        confidence: 1,
      },
      surveyText: [
        '| | | ORIGINAL RESPONSE given current recommendation | RESPONSE WITH MERCK STORY |',
        '| --- | --- | --- | --- |',
        '| 1 | + additional dose of Product X (PCV20) | {{PROG: PIPE IN A200b}} | _______% |',
        '| 2 | + additional dose of Pneumovax (PPSV23) | {{PROG: PIPE IN A200b}} | _______% |',
        '| 3 | + additional dose of Capvaxive (PCV21) | **n/a** | _______% |',
      ].join('\n'),
      items: [
        {
          column: 'D300br1c1',
          label: '+ additional dose of Product X (PCV20) - ORIGINAL RESPONSE given current recommendation',
          normalizedType: 'numeric_range',
          itemBase: 43,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br2c1',
          label: '+ additional dose of Pneumovax (PPSV23) - ORIGINAL RESPONSE given current recommendation',
          normalizedType: 'numeric_range',
          itemBase: 43,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br3c1',
          label: '+ additional dose of Capvaxive (PCV21) - ORIGINAL RESPONSE given current recommendation',
          normalizedType: 'numeric_range',
          itemBase: 0,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br1c2',
          label: '+ additional dose of Product X (PCV20) - RESPONSE WITH MERCK STORY',
          normalizedType: 'numeric_range',
          itemBase: 86,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br2c2',
          label: '+ additional dose of Pneumovax (PPSV23) - RESPONSE WITH MERCK STORY',
          normalizedType: 'numeric_range',
          itemBase: 86,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'D300br3c2',
          label: '+ additional dose of Capvaxive (PCV21) - RESPONSE WITH MERCK STORY',
          normalizedType: 'numeric_range',
          itemBase: 86,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
      variables: ['D300br1c1', 'D300br2c1', 'D300br3c1', 'D300br1c2', 'D300br2c2', 'D300br3c2'],
      variableCount: 6,
      questionBase: 86,
    });

    const planned = runTablePlanner({ entries: [entry], metadata: makeMetadata(), dataset: 'test' });

    expect(planned.plannedTables.some(t => t.tableKind === 'grid_row_detail' || t.tableKind === 'grid_col_detail')).toBe(false);
    expect(planned.plannedTables.filter(t => t.tableKind === 'allocation_item_detail')).toHaveLength(3);
    expect(planned.plannedTables.every(t => !(t.appliesToItem || '').includes('c1'))).toBe(true);
  });
});

// =============================================================================
// Scale Classification Tests
// =============================================================================

describe('Scale classification', () => {
  it('classifies 5-point odd scale as odd_substantive', () => {
    const labels = [
      { value: 1, label: 'Strongly disagree' },
      { value: 2, label: 'Disagree' },
      { value: 3, label: 'Neutral' },
      { value: 4, label: 'Agree' },
      { value: 5, label: 'Strongly agree' },
    ];
    const entry = makeScaleEntry(5, labels);
    const result = classifyScale(entry, entry.items as unknown as import('../canonical/types').QuestionItem[]);
    expect(result.mode).toBe('odd_substantive');
    expect(result.pointCount).toBe(5);
  });

  it('classifies 3-point scale as treat_as_standard', () => {
    const labels = [
      { value: 1, label: 'Low' },
      { value: 2, label: 'Medium' },
      { value: 3, label: 'High' },
    ];
    const entry = makeScaleEntry(3, labels);
    const result = classifyScale(entry, entry.items as unknown as import('../canonical/types').QuestionItem[]);
    expect(result.mode).toBe('treat_as_standard');
    expect(result.pointCount).toBe(3);
  });

  it('classifies 4-point scale as treat_as_standard', () => {
    const labels = [
      { value: 1, label: 'Very bad' },
      { value: 2, label: 'Bad' },
      { value: 3, label: 'Good' },
      { value: 4, label: 'Very good' },
    ];
    const entry = makeScaleEntry(4, labels);
    const result = classifyScale(entry, entry.items as unknown as import('../canonical/types').QuestionItem[]);
    expect(result.mode).toBe('treat_as_standard');
  });

  it('classifies 11-point NPS scale', () => {
    const labels = Array.from({ length: 11 }, (_, i) => ({
      value: i,
      label: String(i),
    }));
    const entry = makeScaleEntry(11, labels, {
      questionText: 'How likely are you to recommend?',
    });
    const result = classifyScale(entry, entry.items as unknown as import('../canonical/types').QuestionItem[]);
    expect(result.mode).toBe('nps');
    expect(result.pointCount).toBe(11);
  });

  it('classifies even bipolar scale', () => {
    const labels = [
      { value: 1, label: 'Strongly disagree' },
      { value: 2, label: 'Disagree' },
      { value: 3, label: 'Agree' },
      { value: 4, label: 'Strongly agree' },
      { value: 5, label: 'Very likely' },
      { value: 6, label: 'Extremely likely' },
    ];
    const entry = makeScaleEntry(6, labels);
    const result = classifyScale(entry, entry.items as unknown as import('../canonical/types').QuestionItem[]);
    expect(result.mode).toBe('even_bipolar');
  });

  it('returns unknown when no scale labels present', () => {
    const entry = makeScaleEntry(0, []);
    entry.items = [{
      column: 'S1_1',
      label: 'Item',
      normalizedType: 'categorical_select',
      itemBase: 100,
      messageCode: null,
      messageText: null,
      altCode: null,
      altText: null,
      matchMethod: null,
      matchConfidence: 0,
    }] as QuestionIdEntry['items'];
    const result = classifyScale(entry, entry.items as unknown as import('../canonical/types').QuestionItem[]);
    expect(result.mode).toBe('unknown');
  });

  it('detects non-substantive tail', () => {
    const labels = [
      { value: 1, label: 'Strongly disagree' },
      { value: 2, label: 'Disagree' },
      { value: 3, label: 'Neutral' },
      { value: 4, label: 'Agree' },
      { value: 5, label: 'Strongly agree' },
      { value: 6, label: "Don't know" },
    ];
    const entry = makeScaleEntry(6, labels);
    const result = classifyScale(entry, entry.items as unknown as import('../canonical/types').QuestionItem[]);
    expect(result.mode).toBe('odd_plus_non_sub_tail');
    expect(result.hasNonSubstantiveTail).toBe(true);
    expect(result.tailLabel).toBe("Don't know");
    expect(result.tailLabels).toEqual(["Don't know"]);
  });

  it('detects multiple trailing non-substantive labels', () => {
    const labels = [
      { value: 1, label: 'Strongly disagree' },
      { value: 2, label: 'Disagree' },
      { value: 3, label: 'Neutral' },
      { value: 4, label: 'Agree' },
      { value: 5, label: 'Strongly agree' },
      { value: 98, label: "Don't know" },
      { value: 99, label: 'Not applicable' },
    ];
    const entry = makeScaleEntry(7, labels);
    const result = classifyScale(entry, entry.items as unknown as import('../canonical/types').QuestionItem[]);
    expect(result.mode).toBe('odd_plus_non_sub_tail');
    expect(result.tailLabel).toBe("Don't know");
    expect(result.tailLabels).toEqual(["Don't know", 'Not applicable']);
  });
});

// =============================================================================
// buildContext and planEntryTables Tests
// =============================================================================

describe('buildContext', () => {
  it('builds context with correct family root', () => {
    const entry = makeEntry({ questionId: 'Q5' });
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('ds', entry, reportableMap);

    expect(ctx.familyRoot).toBe('Q5');
    expect(ctx.dataset).toBe('ds');
    expect(ctx.entry).toBe(entry);
  });

  it('uses loopQuestionId as family root for loop entries', () => {
    const entry = makeEntry({
      questionId: 'Q5_1',
      loopQuestionId: 'Q5',
      loop: {
        detected: true,
        familyBase: 'Q5',
        iterationIndex: 0,
        iterationCount: 3,
        siblingFamilyBases: [],
      },
    });
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('ds', entry, reportableMap);

    expect(ctx.familyRoot).toBe('Q5');
  });

  it('resolves base planning from baseContract before legacy flags', () => {
    const entry = makeEntry({
      totalN: 200,
      questionBase: 150,
      hasVariableItemBases: false,
      variableBaseReason: null,
      itemBaseRange: null,
      items: [
        {
          column: 'Q1_1',
          label: 'Option A',
          normalizedType: 'categorical_select',
          itemBase: 120,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_2',
          label: 'Option B',
          normalizedType: 'categorical_select',
          itemBase: 80,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
      baseContract: buildEntryBaseContract({
        totalN: 200,
        questionBase: 150,
        itemBase: null,
        itemBaseRange: [80, 120],
        hasVariableItemBases: true,
        variableBaseReason: 'genuine',
        rankingDetail: null,
        exclusionReason: null,
      }),
    });
    const reportableMap = new Map([[entry.questionId, entry]]);

    const ctx = buildContext('ds', entry, reportableMap);

    expect(ctx.basePlanning.minBase).toBe(80);
    expect(ctx.basePlanning.maxBase).toBe(120);
    expect(ctx.basePlanning.materialSplit).toBe(true);
    expect(ctx.basePlanning.legacyMismatchReasons.length).toBeGreaterThan(0);
  });
});

describe('planEntryTables', () => {
  it('dispatches standard subtype correctly', () => {
    const entry = makeEntry({ analyticalSubtype: 'standard' });
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('ds', entry, reportableMap);
    const ambiguities: PlannerAmbiguity[] = [];

    const tables = planEntryTables(ctx, ambiguities);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables[0].tableKind).toBe('standard_overview');
  });

  it('dispatches ranking subtype correctly', () => {
    const entry = makeRankingEntry(5, 5);
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('ds', entry, reportableMap);
    const ambiguities: PlannerAmbiguity[] = [];

    const tables = planEntryTables(ctx, ambiguities);
    const kinds = tables.map(t => t.tableKind);
    expect(kinds).toContain('ranking_overview_rank');
    expect(kinds).toContain('ranking_item_rank');
    expect(tables.some(t => t.tableKind === 'ranking_overview_rank' && t.tableRole === 'overview_rank_4')).toBe(true);
    expect(tables.some(t => t.tableKind === 'ranking_overview_rank' && t.tableRole === 'overview_rank_5')).toBe(true);
  });

  it('falls back to standard for null subtype', () => {
    const entry = makeEntry({ analyticalSubtype: null });
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('ds', entry, reportableMap);
    const ambiguities: PlannerAmbiguity[] = [];

    const tables = planEntryTables(ctx, ambiguities);
    expect(tables.length).toBeGreaterThan(0);
    expect(ambiguities.some(a => a.code === 'subtype_null_fallback')).toBe(true);
  });

  it('returns empty array for maxdiff_exercise subtype', () => {
    const entry = makeEntry({ analyticalSubtype: 'maxdiff_exercise' });
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('ds', entry, reportableMap);
    const ambiguities: PlannerAmbiguity[] = [];

    const tables = planEntryTables(ctx, ambiguities);
    expect(tables).toEqual([]);
  });

  it('keeps overview only for non-material varying standard bases and marks anchor row variance', () => {
    const entry = makeEntry({
      totalN: 200,
      questionBase: 150,
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [144, 150],
      items: [
        {
          column: 'Q1_1',
          label: 'Option A',
          normalizedType: 'categorical_select',
          itemBase: 150,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_2',
          label: 'Option B',
          normalizedType: 'categorical_select',
          itemBase: 144,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('ds', entry, reportableMap);
    const ambiguities: PlannerAmbiguity[] = [];

    const tables = planEntryTables(ctx, ambiguities);

    expect(tables.map(t => t.tableKind)).toEqual(['standard_overview']);
    expect(tables[0].baseViewRole).toBe('anchor');
    expect(tables[0].plannerBaseComparability).toBe('varying_but_acceptable');
    expect(tables[0].computeRiskSignals).toContain('row-base-varies-within-anchor-view');
    expect(ambiguities.some(a => a.code === 'anchor_view_row_base_variation')).toBe(true);
  });

  it('adds cluster precision tables for material varying standard bases when populations cluster cleanly', () => {
    const entry = makeEntry({
      totalN: 200,
      questionBase: 150,
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [60, 100],
      items: [
        {
          column: 'Q1_1',
          label: 'Option A',
          normalizedType: 'categorical_select',
          itemBase: 100,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_2',
          label: 'Option B',
          normalizedType: 'categorical_select',
          itemBase: 100,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_3',
          label: 'Option C',
          normalizedType: 'categorical_select',
          itemBase: 60,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_4',
          label: 'Option D',
          normalizedType: 'categorical_select',
          itemBase: 60,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
      variables: ['Q1_1', 'Q1_2', 'Q1_3', 'Q1_4'],
      variableCount: 4,
    });
    const reportableMap = new Map([[entry.questionId, entry]]);

    const tables = planEntryTables(buildContext('ds', entry, reportableMap), []);
    const kinds = tables.map(t => t.tableKind);

    expect(kinds).toContain('standard_overview');
    expect(kinds).toContain('standard_cluster_detail');
    expect(tables.find(t => t.tableKind === 'standard_overview')?.baseViewRole).toBe('anchor');
    expect(tables.filter(t => t.tableKind === 'standard_cluster_detail').every(t => t.baseViewRole === 'precision')).toBe(true);
  });

  it('adds item-detail precision fallback when material varying standard bases do not cluster cleanly', () => {
    const entry = makeEntry({
      totalN: 220,
      questionBase: 180,
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [60, 140],
      items: [
        {
          column: 'Q1_1',
          label: 'Option A',
          normalizedType: 'categorical_select',
          itemBase: 140,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_2',
          label: 'Option B',
          normalizedType: 'categorical_select',
          itemBase: 120,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_3',
          label: 'Option C',
          normalizedType: 'categorical_select',
          itemBase: 100,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_4',
          label: 'Option D',
          normalizedType: 'categorical_select',
          itemBase: 80,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q1_5',
          label: 'Option E',
          normalizedType: 'categorical_select',
          itemBase: 60,
          scaleLabels: [{ value: 1, label: 'Yes' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
      variables: ['Q1_1', 'Q1_2', 'Q1_3', 'Q1_4', 'Q1_5'],
      variableCount: 5,
    });
    const reportableMap = new Map([[entry.questionId, entry]]);

    const tables = planEntryTables(buildContext('ds', entry, reportableMap), []);

    expect(tables.map(t => t.tableKind)).toContain('standard_item_detail');
    expect(tables.filter(t => t.tableKind === 'standard_item_detail')).toHaveLength(5);
    expect(tables.filter(t => t.tableKind === 'standard_item_detail').every(t => t.basePolicy === 'item_base')).toBe(true);
  });

  it('emits explicit ambiguity for ranking-artifact overlap without treating it as a material split', () => {
    const entry = makeRankingEntry(3, 5);
    entry.totalN = 200;
    entry.questionBase = 150;
    entry.isFiltered = true;
    entry.hasVariableItemBases = true;
    entry.variableBaseReason = 'ranking-artifact';
    entry.itemBaseRange = [80, 120];
    entry.items = entry.items.map((item, idx) => ({
      ...item,
      itemBase: [120, 110, 100, 90, 80][idx],
    }));
    entry.baseContract = buildEntryBaseContract({
      totalN: 200,
      questionBase: 150,
      itemBase: null,
      itemBaseRange: [80, 120],
      hasVariableItemBases: true,
      variableBaseReason: 'ranking-artifact',
      rankingDetail: entry.rankingDetail,
      exclusionReason: null,
    });
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ambiguities: PlannerAmbiguity[] = [];

    const tables = planEntryTables(buildContext('ds', entry, reportableMap), ambiguities);

    expect(ambiguities.some(a => a.code === 'ranking_artifact_ambiguous')).toBe(true);
    expect(tables.some(t => t.tableKind === 'standard_cluster_detail')).toBe(false);
    expect(tables.filter(t => t.tableKind === 'ranking_item_rank').every(t => t.basePolicy === 'question_base_shared')).toBe(true);
    expect(tables.every(t => t.plannerBaseComparability === 'ambiguous')).toBe(true);
  });

  it('classifies existing scale detail tables as precision without changing table families', () => {
    const entry = makeEntry({
      questionId: 'S2',
      analyticalSubtype: 'scale',
      totalN: 220,
      questionBase: 180,
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [80, 120],
      items: [
        {
          column: 'S2_1',
          label: 'Scale item 1',
          normalizedType: 'categorical_select',
          itemBase: 120,
          scaleLabels: [
            { value: 1, label: 'Strongly disagree' },
            { value: 2, label: 'Disagree' },
            { value: 3, label: 'Neutral' },
            { value: 4, label: 'Agree' },
            { value: 5, label: 'Strongly agree' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'S2_2',
          label: 'Scale item 2',
          normalizedType: 'categorical_select',
          itemBase: 80,
          scaleLabels: [
            { value: 1, label: 'Strongly disagree' },
            { value: 2, label: 'Disagree' },
            { value: 3, label: 'Neutral' },
            { value: 4, label: 'Agree' },
            { value: 5, label: 'Strongly agree' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
      variables: ['S2_1', 'S2_2'],
      variableCount: 2,
      normalizedType: 'categorical_select',
    });
    const reportableMap = new Map([[entry.questionId, entry]]);

    const tables = planEntryTables(buildContext('ds', entry, reportableMap), []);
    const rollup = tables.find(t => t.tableKind === 'scale_overview_rollup_t2b');
    const detail = tables.find(t => t.tableKind === 'scale_item_detail_full');

    expect(rollup?.baseViewRole).toBe('anchor');
    expect(detail?.baseViewRole).toBe('precision');
    expect(detail?.basePolicy).toBe('item_base');
  });
});

describe('Per-set summary expansion', () => {
  it('plans and assembles per-set ranking summaries when one question spans all sets', () => {
    const metadata = makeMetadata({ isMessageTestingSurvey: true });
    const sourceEntries = makeStimuliSetSourceEntries();
    const rankingEntry = makePerSetRankingEntry();
    const reportableMap = new Map(
      [...sourceEntries, rankingEntry].map(entry => [entry.questionId, entry] as const),
    );

    const ctx = buildContext('test', rankingEntry, reportableMap, metadata);
    expect(ctx.stimuliSetSlices).toHaveLength(3);

    const planned = planEntryTables(ctx, []);
    const perSetRank1 = planned.filter(table =>
      table.tableKind === 'ranking_overview_rank'
      && table.tableRole === 'overview_rank_1_set_1',
    );
    expect(perSetRank1).toHaveLength(1);
    expect(perSetRank1[0]?.stimuliSetSlice).toMatchObject({
      familySource: 'B500',
      setIndex: 0,
      setLabel: 'Set 1',
      sourceQuestionId: 'B500',
    });
    expect(perSetRank1[0]?.binarySide).toBeNull();
    expect(perSetRank1[0]?.appliesToColumn?.split(',')).toEqual(['B700r101', 'B700r102', 'B700r103']);
    expect(planned.filter(table => table.stimuliSetSlice !== null)).toHaveLength(15);
    const setSequence = planned
      .filter(table => table.stimuliSetSlice !== null)
      .map(table => table.stimuliSetSlice?.setIndex ?? -1);
    const setBlocks = setSequence.filter((setIndex, idx) => idx === 0 || setIndex !== setSequence[idx - 1]);
    expect(setBlocks).toEqual([0, 1, 2]);
    expect(setSequence.filter(setIndex => setIndex === 0)).toHaveLength(5);
    expect(setSequence.filter(setIndex => setIndex === 1)).toHaveLength(5);
    expect(setSequence.filter(setIndex => setIndex === 2)).toHaveLength(5);

    const assembled = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: planned,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [...sourceEntries, rankingEntry],
      metadata,
      dataset: 'test',
    });

    const table = assembled.tables.find(t =>
      t.tableKind === 'ranking_overview_rank'
      && t.stimuliSetSlice?.setIndex === 0
      && t.rows[0]?.rankLevel === 1,
    );
    expect(table?.tableSubtitle).toBe('Set 1');
    expect(table?.baseText).toBe('Those who were shown B700');
    expect(table?.baseDisclosure?.defaultBaseText).toBe('Those who were shown B700');
    expect(table?.rows.map(row => row.variable)).toEqual(['B700r101', 'B700r102', 'B700r103']);
    expect(table?.rows.every(row => row.rankLevel === 1 && row.filterValue === '1')).toBe(true);
  });

  it('adds selected and unselected per-set binary summaries for message-testing surveys', () => {
    const metadata = makeMetadata({ isMessageTestingSurvey: true });
    const sourceEntries = makeStimuliSetSourceEntries();
    const binaryEntry = makePerSetBinaryEntry();
    const reportableMap = new Map(
      [...sourceEntries, binaryEntry].map(entry => [entry.questionId, entry] as const),
    );

    const ctx = buildContext('test', binaryEntry, reportableMap, metadata);
    expect(ctx.stimuliSetSlices).toHaveLength(3);

    const planned = planEntryTables(ctx, []);
    const selectedTable = planned.find(table => table.tableRole === 'overview_selected_set_1');
    const unselectedTable = planned.find(table => table.tableRole === 'overview_unselected_set_1');
    expect(selectedTable?.binarySide).toBe('selected');
    expect(unselectedTable?.binarySide).toBe('unselected');
    expect(selectedTable?.appliesToColumn?.split(',')).toEqual(['B800r101', 'B800r102', 'B800r103']);
    expect(planned.some(table => table.tableKind === 'standard_overview' && table.stimuliSetSlice === null)).toBe(false);
    expect(planned.filter(table => table.stimuliSetSlice !== null)).toHaveLength(6);

    const assembled = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: planned,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [...sourceEntries, binaryEntry],
      metadata,
      dataset: 'test',
    });

    const selected = assembled.tables.find(t =>
      t.tableKind === 'standard_overview'
      && t.stimuliSetSlice?.setIndex === 0
      && t.binarySide === 'selected',
    );
    const unselected = assembled.tables.find(t =>
      t.tableKind === 'standard_overview'
      && t.stimuliSetSlice?.setIndex === 0
      && t.binarySide === 'unselected',
    );
    expect(selected?.tableSubtitle).toBe('Set 1 — Selected');
    expect(unselected?.tableSubtitle).toBe('Set 1 — Not Selected');
    expect(selected?.baseText).toBe('Those who were shown B800');
    expect(unselected?.baseText).toBe('Those who were shown B800');
    expect(selected?.baseDisclosure?.defaultBaseText).toBe('Those who were shown B800');
    expect(selected?.rows.map(row => row.filterValue)).toEqual(['1', '1', '1']);
    expect(unselected?.rows.map(row => row.filterValue)).toEqual(['0', '0', '0']);
  });

  it('adds yes and no per-set summaries for message-testing categorical yes/no questions', () => {
    const metadata = makeMetadata({ isMessageTestingSurvey: true });
    const sourceEntries = makeStimuliSetSourceEntries();
    const yesNoEntry = makePerSetYesNoEntry();
    const reportableMap = new Map(
      [...sourceEntries, yesNoEntry].map(entry => [entry.questionId, entry] as const),
    );

    const ctx = buildContext('test', yesNoEntry, reportableMap, metadata);
    expect(ctx.stimuliSetSlices).toHaveLength(3);

    const planned = planEntryTables(ctx, []);
    expect(planned.some(table => table.tableKind === 'standard_overview' && table.stimuliSetSlice === null)).toBe(false);
    expect(planned.filter(table => table.stimuliSetSlice !== null)).toHaveLength(6);

    const assembled = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: planned,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [...sourceEntries, yesNoEntry],
      metadata,
      dataset: 'test',
    });

    const yesTable = assembled.tables.find(t =>
      t.tableKind === 'standard_overview'
      && t.stimuliSetSlice?.setIndex === 0
      && t.binarySide === 'selected',
    );
    const noTable = assembled.tables.find(t =>
      t.tableKind === 'standard_overview'
      && t.stimuliSetSlice?.setIndex === 0
      && t.binarySide === 'unselected',
    );

    expect(yesTable?.tableSubtitle).toBe('Set 1 — Yes');
    expect(noTable?.tableSubtitle).toBe('Set 1 — No');
    expect(yesTable?.rows.map(row => row.filterValue)).toEqual(['1', '1', '1']);
    expect(noTable?.rows.map(row => row.filterValue)).toEqual(['2', '2', '2']);
  });

  it('rejects partial coverage and non-testing surveys', () => {
    const sourceEntries = makeStimuliSetSourceEntries();
    const partialEntry = makePerSetBinaryEntry(6);
    const reportableMap = new Map(
      [...sourceEntries, partialEntry].map(entry => [entry.questionId, entry] as const),
    );

    const testingCtx = buildContext(
      'test',
      partialEntry,
      reportableMap,
      makeMetadata({ isMessageTestingSurvey: true }),
    );
    expect(testingCtx.stimuliSetSlices).toEqual([]);
    expect(planEntryTables(testingCtx, []).every(table => table.stimuliSetSlice === null)).toBe(true);

    const nonTestingCtx = buildContext('test', makePerSetBinaryEntry(), reportableMap, makeMetadata());
    expect(nonTestingCtx.stimuliSetSlices).toEqual([]);
    expect(planEntryTables(nonTestingCtx, []).every(table => table.stimuliSetSlice === null)).toBe(true);
  });

  it('ignores hidden stimuli-set source families', () => {
    const metadata = makeMetadata({ isMessageTestingSurvey: true });
    const sourceEntries = makeStimuliSetSourceEntries({ firstHidden: true });
    const binaryEntry = makePerSetBinaryEntry();
    const reportableMap = new Map(
      [...sourceEntries, binaryEntry].map(entry => [entry.questionId, entry] as const),
    );

    const ctx = buildContext('test', binaryEntry, reportableMap, metadata);
    expect(ctx.stimuliSetSlices).toEqual([]);
    expect(planEntryTables(ctx, []).every(table => table.stimuliSetSlice === null)).toBe(true);
  });

  it('populates stimuliSetResolution on EntryContext when sets detected', () => {
    const metadata = makeMetadata({ isMessageTestingSurvey: true });
    const sourceEntries = makeStimuliSetSourceEntries();
    const rankingEntry = makePerSetRankingEntry();
    const reportableMap = new Map(
      [...sourceEntries, rankingEntry].map(entry => [entry.questionId, entry] as const),
    );

    const ctx = buildContext('test', rankingEntry, reportableMap, metadata);
    expect(ctx.stimuliSetResolution).toBeDefined();
    expect(ctx.stimuliSetResolution?.detected).toBe(true);
    expect(ctx.stimuliSetResolution?.setCount).toBe(3);
    expect(ctx.stimuliSetResolution?.ambiguous).toBe(false);
  });

  it('uses dead-column-aware set counts so same-block registry can win over cross-block fallback', () => {
    const metadata = makeMetadata({ isMessageTestingSurvey: true });
    const sourceEntries = makeDeadColumnStimuliSetSourceEntries();
    const rankingEntry = makeEntry({
      questionId: 'C700',
      questionText: 'Scenario C ranking question',
      analyticalSubtype: 'ranking',
      normalizedType: 'numeric_range',
      rankingDetail: { K: 2, N: 4, pattern: '2 of 4', source: 'scale-labels' },
      items: [
        makeStimulusItem('C700r101', 'MSG01', 'Message MSG01', [{ value: 1, label: 'Rank 1' }, { value: 2, label: 'Rank 2' }]),
        makeStimulusItem('C700r102', 'MSG02', 'Message MSG02', [{ value: 1, label: 'Rank 1' }, { value: 2, label: 'Rank 2' }]),
        makeStimulusItem('C700r201', 'MSG03', 'Message MSG03', [{ value: 1, label: 'Rank 1' }, { value: 2, label: 'Rank 2' }]),
        makeStimulusItem('C700r202', 'MSG04', 'Message MSG04', [{ value: 1, label: 'Rank 1' }, { value: 2, label: 'Rank 2' }]),
      ],
      variables: ['C700r101', 'C700r102', 'C700r201', 'C700r202'],
      variableCount: 4,
      hasMessageMatches: true,
    });

    const reportableMap = new Map(
      [...sourceEntries, rankingEntry].map(entry => [entry.questionId, entry] as const),
    );

    const ctx = buildContext('test', rankingEntry, reportableMap, metadata);
    expect(ctx.stimuliSetSlices).toHaveLength(2);
    expect(ctx.stimuliSetResolution?.familySource).toBe('C500');
    expect(ctx.stimuliSetResolution?.blockMatch).toBe(true);
    expect(ctx.stimuliSetResolution?.setSizes).toEqual([2, 2]);
    expect(ctx.stimuliSetSlices[0]?.sourceQuestionId).toBe('C500_1');
    expect(ctx.stimuliSetSlices[1]?.sourceQuestionId).toBe('C500_2');
  });

  it('marks cross-block stimuli-set sourcing as ambiguous when no same-block registry exists', () => {
    const metadata = makeMetadata({ isMessageTestingSurvey: true });
    const sourceEntries = makeStimuliSetSourceEntries();
    const crossBlockEntry = makePerSetRankingEntry(9, 'C700');
    const reportableMap = new Map(
      [...sourceEntries, crossBlockEntry].map(entry => [entry.questionId, entry] as const),
    );

    const ctx = buildContext('test', crossBlockEntry, reportableMap, metadata);
    expect(ctx.stimuliSetSlices).toHaveLength(3);
    expect(ctx.stimuliSetResolution?.familySource).toBe('B500');
    expect(ctx.stimuliSetResolution?.blockMatch).toBe(false);
    expect(ctx.stimuliSetResolution?.ambiguous).toBe(true);
  });

  it('stimuliSetResolution is null when no sets detected', () => {
    const metadata = makeMetadata(); // not message testing
    const sourceEntries = makeStimuliSetSourceEntries();
    const rankingEntry = makePerSetRankingEntry();
    const reportableMap = new Map(
      [...sourceEntries, rankingEntry].map(entry => [entry.questionId, entry] as const),
    );

    const ctx = buildContext('test', rankingEntry, reportableMap, metadata);
    expect(ctx.stimuliSetResolution).toBeNull();
  });

  it('populates stimuliSetResolution on QuestionDiagnostic via runTablePlanner', () => {
    const metadata = makeMetadata({ isMessageTestingSurvey: true });
    const sourceEntries = makeStimuliSetSourceEntries();
    const binaryEntry = makePerSetBinaryEntry();
    const entries = [...sourceEntries, binaryEntry];

    const result = runTablePlanner({
      entries,
      metadata,
      dataset: 'test',
    });

    const diag = result.summary.questionDiagnostics.find(
      d => d.questionId === binaryEntry.questionId,
    );
    expect(diag).toBeDefined();
    expect(diag?.stimuliSetResolution).toBeDefined();
    expect(diag?.stimuliSetResolution?.detected).toBe(true);
    expect(diag?.stimuliSetResolution?.setCount).toBe(3);
    expect(diag?.stimuliSetResolution?.binarySplitApplied).toBe(true);
  });
});

// =============================================================================
// Canonical Assembly Tests (13d)
// =============================================================================

describe('Canonical assembly (13d)', () => {
  function makePlannedTable(overrides: Partial<PlannedTable> = {}): PlannedTable {
    const planned: PlannedTable = {
      dataset: 'test',
      sourceQuestionId: 'Q1',
      sourceLoopQuestionId: null,
      familyRoot: 'Q1',
      analyticalSubtype: 'standard',
      normalizedType: 'categorical_select',
      tableKind: 'standard_overview',
      tableRole: 'overview',
      tableIdCandidate: 'q1__standard_overview',
      sortBlock: 'test::Q1',
      sortFamily: 'survey_anchored',
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
      splitReason: null,
      baseViewRole: 'anchor',
      questionBase: 150,
      itemBase: null,
      baseContract: projectTableBaseContract(makeEmptyBaseContract(), {
        basePolicy: 'question_base_shared',
        questionBase: 150,
        itemBase: null,
      }),
      appliesToItem: null,
      computeMaskAnchorVariable: null,
      appliesToColumn: null,
      notes: [],
      inputsUsed: [],
      ...overrides,
      stimuliSetSlice: overrides.stimuliSetSlice ?? null,
      binarySide: overrides.binarySide ?? null,
    };
    planned.baseContract = overrides.baseContract ?? projectTableBaseContract(makeEmptyBaseContract(), {
      basePolicy: planned.basePolicy,
      questionBase: planned.questionBase,
      itemBase: planned.itemBase,
    });
    return planned;
  }

  it('produces canonical tables from planned tables', () => {
    const planned = makePlannedTable({
      baseViewRole: 'anchor',
      plannerBaseComparability: 'shared',
      plannerBaseSignals: ['filtered-base'],
      computeRiskSignals: ['compute-mask-required'],
      baseContract: projectTableBaseContract(buildEntryBaseContract({
        totalN: 200,
        questionBase: 150,
        itemBase: null,
        itemBaseRange: [120, 150],
        hasVariableItemBases: true,
        variableBaseReason: 'genuine',
        rankingDetail: null,
        exclusionReason: null,
      }), {
        basePolicy: 'question_base_shared',
        questionBase: 150,
        itemBase: null,
      }),
    });
    const entry = makeEntry();
    const metadata = makeMetadata();

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata,
      dataset: 'test',
    });

    expect(result.tables).toHaveLength(1);
    expect(planned.baseContract.policy.effectiveBaseMode).toBe('table_mask_then_row_observed_n');
    expect(result.tables[0].baseContract.policy.effectiveBaseMode).toBe('table_mask_then_row_observed_n');
    expect(result.tables[0].baseViewRole).toBe('anchor');
    expect(result.tables[0].plannerBaseComparability).toBe('shared');
    expect(result.tables[0].plannerBaseSignals).toEqual(['filtered-base']);
    expect(result.tables[0].computeRiskSignals).toEqual(['compute-mask-required']);
    expect(result.tables[0].baseDisclosure?.source).toBe('contract');
    expect(result.tables[0].baseDisclosure?.referenceBaseN).toBe(150);
    expect(result.tables[0].baseDisclosure?.itemBaseRange).toEqual([120, 150]);
    expect(result.metadata.totalTables).toBe(1);
    expect(result.metadata.assemblerVersion).toBe('13d-v1');
    expect(result.metadata.dataset).toBe('test');
  });

  it('collapses loop sibling plans into one canonical family-root table', () => {
    const a2_1 = makeEntry({
      questionId: 'A2_1',
      questionText: 'What time of day did you have this drink?',
      variables: ['A2_1'],
      variableCount: 1,
      loopQuestionId: 'A2',
      loop: {
        detected: true,
        familyBase: 'A2',
        iterationIndex: 1,
        iterationCount: 2,
        siblingFamilyBases: ['A2'],
      },
      items: [{
        column: 'A2_1',
        label: 'Occasion 1',
        normalizedType: 'categorical_select',
        itemBase: 5098,
        scaleLabels: [
          { value: 1, label: 'Breakfast' },
          { value: 2, label: 'Lunch' },
        ],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      }],
      totalN: 5098,
      questionBase: 5098,
      isFiltered: false,
    });
    const a2_2 = makeEntry({
      questionId: 'A2_2',
      questionText: 'What time of day did you have this drink?',
      variables: ['A2_2'],
      variableCount: 1,
      loopQuestionId: 'A2',
      loop: {
        detected: true,
        familyBase: 'A2',
        iterationIndex: 2,
        iterationCount: 2,
        siblingFamilyBases: ['A2'],
      },
      items: [{
        column: 'A2_2',
        label: 'Occasion 2',
        normalizedType: 'categorical_select',
        itemBase: 2322,
        scaleLabels: [
          { value: 1, label: 'Breakfast' },
          { value: 2, label: 'Lunch' },
        ],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      }],
      totalN: 5098,
      questionBase: 2322,
      isFiltered: true,
    });

    const plannedTables = [
      makePlannedTable({
        sourceQuestionId: 'A2_1',
        sourceLoopQuestionId: 'A2',
        familyRoot: 'A2',
        tableIdCandidate: 'a2__standard_overview',
        sortBlock: 'test::A2',
        sortFamily: 'survey_anchored',
        questionBase: 5098,
        baseDisclosure: buildPlannerBaseDisclosure({
          ...makePlannedTable({
            sourceQuestionId: 'A2_1',
            sourceLoopQuestionId: 'A2',
            familyRoot: 'A2',
            tableIdCandidate: 'a2__standard_overview',
            questionBase: 5098,
          }),
          questionBase: 5098,
        }, a2_1),
      }),
      makePlannedTable({
        sourceQuestionId: 'A2_2',
        sourceLoopQuestionId: 'A2',
        familyRoot: 'A2',
        tableIdCandidate: 'a2__standard_overview',
        sortBlock: 'test::A2',
        sortFamily: 'survey_anchored',
        questionBase: 2322,
        baseDisclosure: buildPlannerBaseDisclosure({
          ...makePlannedTable({
            sourceQuestionId: 'A2_2',
            sourceLoopQuestionId: 'A2',
            familyRoot: 'A2',
            tableIdCandidate: 'a2__standard_overview',
            questionBase: 2322,
          }),
          questionBase: 2322,
        }, a2_2),
      }),
    ];

    const loopMappings: LoopGroupMapping[] = [{
      skeleton: 'A-N-_-N',
      stackedFrameName: 'stacked_loop_8',
      iterations: ['1', '2'],
      familyBase: 'A2',
      variables: [{
        baseName: 'A2',
        label: 'What time of day did you have this drink?',
        iterationColumns: {
          '1': 'A2_1',
          '2': 'A2_2',
        },
      }],
    }];

    const output = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [a2_1, a2_2],
      loopMappings,
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(output.tables).toHaveLength(1);
    expect(output.tables[0]?.questionId).toBe('A2');
    expect(output.tables[0]?.tableId).toBe('a2__standard_overview');
    expect(output.tables[0]?.rows.map(row => row.variable)).toEqual(['A2', 'A2']);
    expect(output.tables[0]?.questionBase).toBe(7420);
    expect(output.tables[0]?.baseDisclosure?.referenceBaseN).toBe(7420);
    expect(output.tables[0]?.baseText).toBe('Those shown A2 across loop iterations');
  });

  it('uses the lowest loop iteration as the retained representative', () => {
    const q5_2 = makeEntry({
      questionId: 'Q5_2',
      questionText: 'Representative iteration',
      variables: ['Q5_2'],
      variableCount: 1,
      loopQuestionId: 'Q5',
      loop: {
        detected: true,
        familyBase: 'Q5',
        iterationIndex: 2,
        iterationCount: 2,
        siblingFamilyBases: ['Q5'],
      },
      items: [{
        column: 'Q5_2',
        label: 'Representative label',
        normalizedType: 'categorical_select',
        itemBase: 100,
        scaleLabels: [{ value: 1, label: 'Yes' }],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      }],
      totalN: 120,
      questionBase: 100,
      isFiltered: true,
    });
    const q5_4 = makeEntry({
      questionId: 'Q5_4',
      questionText: 'Later iteration',
      variables: ['Q5_4'],
      variableCount: 1,
      loopQuestionId: 'Q5',
      loop: {
        detected: true,
        familyBase: 'Q5',
        iterationIndex: 4,
        iterationCount: 2,
        siblingFamilyBases: ['Q5'],
      },
      items: [{
        column: 'Q5_4',
        label: 'Later label',
        normalizedType: 'categorical_select',
        itemBase: 50,
        scaleLabels: [{ value: 1, label: 'Yes' }],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      }],
      totalN: 120,
      questionBase: 50,
      isFiltered: true,
    });

    const output = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [
          makePlannedTable({
            sourceQuestionId: 'Q5_2',
            sourceLoopQuestionId: 'Q5',
            familyRoot: 'Q5',
            tableIdCandidate: 'q5__standard_overview',
            questionBase: 100,
          }),
          makePlannedTable({
            sourceQuestionId: 'Q5_4',
            sourceLoopQuestionId: 'Q5',
            familyRoot: 'Q5',
            tableIdCandidate: 'q5__standard_overview',
            questionBase: 50,
          }),
        ],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [q5_2, q5_4],
      loopMappings: [{
        skeleton: 'Q-N-_-N',
        stackedFrameName: 'stacked_loop_2',
        iterations: ['2', '4'],
        familyBase: 'Q5',
        variables: [{
          baseName: 'Q5',
          label: 'Representative iteration',
          iterationColumns: {
            '2': 'Q5_2',
            '4': 'Q5_4',
          },
        }],
      }],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(output.tables).toHaveLength(1);
    expect(output.tables[0]?.questionId).toBe('Q5');
    expect(output.tables[0]?.notes).toEqual(expect.arrayContaining([
      expect.stringContaining('Q5_2'),
    ]));
    expect(output.tables[0]?.questionText).toContain('Representative iteration');
  });

  it('enforces unique table IDs', () => {
    const plan1 = makePlannedTable({ tableIdCandidate: 'dup_id' });
    const plan2 = makePlannedTable({
      tableIdCandidate: 'dup_id',
      sourceQuestionId: 'Q2',
    });
    const entry = makeEntry();
    const metadata = makeMetadata();

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [plan1, plan2],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata,
      dataset: 'test',
    });

    const ids = result.tables.map(t => t.tableId);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
  });

  it('sets pipeline control defaults at 13d', () => {
    const planned = makePlannedTable();
    const entry = makeEntry();
    const metadata = makeMetadata();

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata,
      dataset: 'test',
    });

    const table = result.tables[0];
    expect(table.exclude).toBe(false);
    expect(table.excludeReason).toBe('');
    expect(table.filterReviewRequired).toBe(false);
    expect(table.lastModifiedBy).toBe('TableBlockAssembler');
    expect(table.statTestSpec).toBeNull();
    expect(table.derivationHint).toBeNull();
    expect(table.sourceTableId).toBe(table.tableId);
    expect(table.splitFromTableId).toBe('');
  });

  it('derives correct tableType from tableKind', () => {
    const freqPlan = makePlannedTable({ tableKind: 'standard_overview' });
    const meanPlan = makePlannedTable({
      tableKind: 'numeric_overview_mean',
      tableIdCandidate: 'q1__numeric_overview_mean',
    });
    const entry = makeEntry();
    const metadata = makeMetadata();

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [freqPlan, meanPlan],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata,
      dataset: 'test',
    });

    expect(result.tables[0].tableType).toBe('frequency');
    expect(result.tables[1].tableType).toBe('mean_rows');
  });

  it('generates deterministic base text', () => {
    const planned = makePlannedTable({ questionBase: 200 });
    const entry = makeEntry({ questionBase: 200 });
    const metadata = makeMetadata();

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata,
      dataset: 'test',
    });

    expect(result.tables[0].baseText).toBe('Total respondents');
    expect(result.tables[0].baseDisclosure?.defaultBaseText).toBe('Total respondents');
    expect(result.tables[0].baseDisclosure?.referenceBaseN).toBe(200);
  });

  it('preserves anchor range disclosure for varying-base overview tables', () => {
    const planned = makePlannedTable({
      baseViewRole: 'anchor',
      plannerBaseComparability: 'varying_but_acceptable',
      plannerBaseSignals: ['varying-item-bases'],
      baseContract: projectTableBaseContract(buildEntryBaseContract({
        totalN: 200,
        questionBase: 150,
        itemBase: null,
        itemBaseRange: [110, 150],
        hasVariableItemBases: true,
        variableBaseReason: 'ranking-artifact',
        rankingDetail: null,
        exclusionReason: null,
      }), {
        basePolicy: 'question_base_shared',
        questionBase: 150,
        itemBase: null,
      }),
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [makeEntry()],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(result.tables[0].baseDisclosure?.rangeDisclosure).toEqual({ min: 110, max: 150 });
    expect(result.tables[0].baseDisclosure?.defaultNoteTokens).toEqual([
      'anchor-base-varies-by-item',
      'anchor-base-range',
    ]);
  });

  it('uses question-base text for ranking-artifact precision tables', () => {
    const planned = makePlannedTable({
      sourceQuestionId: 'B500_1',
      familyRoot: 'B500_1',
      analyticalSubtype: 'ranking',
      normalizedType: 'categorical_select',
      tableKind: 'ranking_item_rank',
      tableRole: 'item_rank',
      tableIdCandidate: 'b500_1__ranking_item_rank_b500_1r101',
      baseViewRole: 'precision',
      questionBase: 177,
      itemBase: 67,
      baseContract: projectTableBaseContract(buildEntryBaseContract({
        totalN: 177,
        questionBase: 177,
        itemBase: 67,
        itemBaseRange: [45, 89],
        hasVariableItemBases: true,
        variableBaseReason: 'ranking-artifact',
        rankingDetail: { K: 5 },
        exclusionReason: null,
      }), {
        basePolicy: 'question_base_shared',
        questionBase: 177,
        itemBase: 67,
      }),
      appliesToItem: 'B500_1r101',
      computeMaskAnchorVariable: 'B500_1r101',
      appliesToColumn: 'B500_1r101',
      splitReason: 'ranking_artifact_variable_bases',
    });
    const entry = makeEntry({
      questionId: 'B500_1',
      analyticalSubtype: 'ranking',
      normalizedType: 'categorical_select',
      totalN: 177,
      questionBase: 177,
      isFiltered: false,
      gapFromTotal: 0,
      gapPct: 0,
      hasVariableItemBases: true,
      variableBaseReason: 'ranking-artifact',
      rankingDetail: { K: 5, N: 12, pattern: 'top 5 of 12', source: 'reconciliation' },
      items: [
        {
          column: 'B500_1r101',
          label: 'Message 101',
          normalizedType: 'categorical_select',
          itemBase: 67,
          scaleLabels: Array.from({ length: 5 }, (_, index) => ({
            value: index + 1,
            label: `Rank ${index + 1}`,
          })),
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
      variables: ['B500_1r101'],
      variableCount: 1,
      itemBaseRange: [45, 89],
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(result.tables[0].baseText).toBe('Total respondents');
    expect(result.tables[0].baseDisclosure?.defaultBaseText).toBe('Total respondents');
  });

  it('keeps rebased exclusion in note tokens, not default base text', () => {
    const planned = makePlannedTable({
      basePolicy: 'question_base_rebased_excluding_non_substantive_tail',
      baseContract: projectTableBaseContract(buildEntryBaseContract({
        totalN: 200,
        questionBase: 150,
        itemBase: null,
        itemBaseRange: null,
        hasVariableItemBases: false,
        variableBaseReason: null,
        rankingDetail: null,
        exclusionReason: null,
      }), {
        basePolicy: 'question_base_rebased_excluding_non_substantive_tail',
        questionBase: 150,
        itemBase: null,
      }),
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [makeEntry({ isFiltered: true, questionBase: 150 })],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(result.tables[0].baseDisclosure?.defaultBaseText).toBe('Those who were shown Q1');
    expect(result.tables[0].baseDisclosure?.defaultNoteTokens).toEqual(['rebased-exclusion']);
  });

  it('marks model-derived tables with model base disclosure', () => {
    const planned = makePlannedTable({
      basePolicy: 'score_family_model_base',
      questionBase: 180,
      baseContract: projectTableBaseContract(buildEntryBaseContract({
        totalN: 200,
        questionBase: 180,
        itemBase: null,
        itemBaseRange: null,
        hasVariableItemBases: false,
        variableBaseReason: null,
        rankingDetail: null,
        exclusionReason: null,
      }), {
        basePolicy: 'score_family_model_base',
        questionBase: 180,
        itemBase: null,
      }),
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [makeEntry()],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(result.tables[0].baseText).toBe('Model-derived base');
    expect(result.tables[0].baseDisclosure?.source).toBe('contract');
  });

  it('uses display overrides for canonical user-facing question fields', () => {
    const planned = makePlannedTable({
      sourceQuestionId: 'B500_1',
      tableIdCandidate: 'b500_1__ranking_overview_top3',
    });
    const entry = makeEntry({
      questionId: 'B500_1',
      questionText: 'B500_1',
      displayQuestionId: 'B500',
      displayQuestionText: 'Rank the most motivating messages',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(result.tables[0].questionId).toBe('B500');
    expect(result.tables[0].questionText).toBe('Rank the most motivating messages');
    // Internal table identity stays based on planned table ID candidate.
    expect(result.tables[0].tableId).toBe('b500_1__ranking_overview_top3');
  });

  it('populates summary with correct counts', () => {
    const plans = [
      makePlannedTable({ tableKind: 'standard_overview', tableIdCandidate: 'a' }),
      makePlannedTable({ tableKind: 'standard_overview', tableIdCandidate: 'b' }),
      makePlannedTable({
        tableKind: 'numeric_overview_mean',
        tableIdCandidate: 'c',
      }),
    ];
    const entry = makeEntry();
    const metadata = makeMetadata();

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: plans,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata,
      dataset: 'test',
    });

    expect(result.summary.byTableKind['standard_overview']).toBe(2);
    expect(result.summary.byTableKind['numeric_overview_mean']).toBe(1);
    expect(result.summary.byTableType['frequency']).toBe(2);
    expect(result.summary.byTableType['mean_rows']).toBe(1);
  });

  it('sets isDerived for rollup/topk/dimension tables', () => {
    const plans = [
      makePlannedTable({
        tableKind: 'scale_overview_rollup_t2b',
        tableIdCandidate: 'rollup',
      }),
      makePlannedTable({
        tableKind: 'ranking_overview_topk',
        tableIdCandidate: 'topk',
      }),
      makePlannedTable({
        tableKind: 'standard_overview',
        tableIdCandidate: 'plain',
      }),
    ];
    const entry = makeEntry();
    const metadata = makeMetadata();

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: plans,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata,
      dataset: 'test',
    });

    expect(result.tables.find(t => t.tableId === 'rollup')?.isDerived).toBe(true);
    expect(result.tables.find(t => t.tableId === 'topk')?.isDerived).toBe(true);
    expect(result.tables.find(t => t.tableId === 'plain')?.isDerived).toBe(false);
  });

  it('attaches WinCross denominator semantics for rollup and detail tables', () => {
    const rollupBaseContract = projectTableBaseContract(makeEmptyBaseContract(), {
      basePolicy: 'question_base_shared',
      questionBase: 150,
      itemBase: null,
    });
    rollupBaseContract.policy.rebasePolicy = 'exclude_non_substantive_tail';

    const plans = [
      makePlannedTable({
        tableKind: 'scale_overview_rollup_t2b',
        tableIdCandidate: 'scale_rollup',
        analyticalSubtype: 'scale',
        baseContract: rollupBaseContract,
      }),
      makePlannedTable({
        tableKind: 'scale_overview_full',
        tableIdCandidate: 'scale_full',
        analyticalSubtype: 'scale',
      }),
    ];
    const entry = makeEntry({
      analyticalSubtype: 'scale',
      items: [
        {
          column: 'Q1_1',
          label: 'Message A',
          normalizedType: 'categorical_select',
          itemBase: 100,
          scaleLabels: [
            { value: 1, label: '1 - Very negative' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
            { value: 4, label: '4' },
            { value: 5, label: '5' },
            { value: 6, label: '6' },
            { value: 7, label: '7 - Extremely positive' },
            { value: 98, label: 'Don\'t know' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });
    const metadata = makeMetadata();

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: plans,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata,
      dataset: 'test',
    });

    expect(result.tables.find(t => t.tableId === 'scale_rollup')?.wincrossDenominatorSemantic).toBe('qualified_respondents');
    expect(result.tables.find(t => t.tableId === 'scale_rollup')?.wincrossQualifiedCodes).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(result.tables.find(t => t.tableId === 'scale_full')?.wincrossDenominatorSemantic).toBe('answering_base');
  });

  it('builds scale full NET rows in T2B -> Middle -> B2B order for 7-point scales', () => {
    const scaleEntry = makeScaleEntry(7, [
      { value: 1, label: 'Strongly disagree' },
      { value: 2, label: 'Disagree' },
      { value: 3, label: 'Somewhat disagree' },
      { value: 4, label: 'Neutral' },
      { value: 5, label: 'Somewhat agree' },
      { value: 6, label: 'Agree' },
      { value: 7, label: 'Strongly agree' },
    ], { questionId: 'S_NET' });

    const planned = makePlannedTable({
      sourceQuestionId: 'S_NET',
      tableKind: 'scale_overview_full',
      tableIdCandidate: 's_net__full',
      analyticalSubtype: 'scale',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [scaleEntry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const netLabels = result.tables[0].rows
      .filter(r => r.rowKind === 'net')
      .map(r => r.label);
    expect(netLabels).toEqual(['Top 2 Box', 'Middle', 'Bottom 2 Box']);
  });

  it('does not add a singleton Middle NET on 5-point scales', () => {
    const scaleEntry = makeScaleEntry(5, [
      { value: 1, label: 'Strongly disagree' },
      { value: 2, label: 'Disagree' },
      { value: 3, label: 'Neutral' },
      { value: 4, label: 'Agree' },
      { value: 5, label: 'Strongly agree' },
    ], { questionId: 'S_NET' });

    const planned = makePlannedTable({
      sourceQuestionId: 'S_NET',
      tableKind: 'scale_overview_full',
      tableIdCandidate: 's_net__full',
      analyticalSubtype: 'scale',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [scaleEntry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const netLabels = result.tables[0].rows
      .filter(r => r.rowKind === 'net')
      .map(r => r.label);
    expect(netLabels).toEqual(['Top 2 Box', 'Bottom 2 Box']);
    expect(result.tables[0].rows.find(r => r.label === 'Middle')).toBeUndefined();

    const neutralRow = result.tables[0].rows.find(r => r.label === 'Neutral');
    expect(neutralRow?.rowKind).toBe('value');
    expect(neutralRow?.indent).toBe(0);
  });

  it('uses correct ordinal suffixes for ranking item rank labels', () => {
    const rankingEntry = makeRankingEntry(13, 13);
    const planned = makePlannedTable({
      sourceQuestionId: 'R1',
      tableKind: 'ranking_item_rank',
      tableIdCandidate: 'r1__item_rank',
      analyticalSubtype: 'ranking',
      appliesToItem: 'R1_1',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [rankingEntry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const labels = result.tables[0].rows
      .filter(r => r.rowKind === 'rank')
      .map(r => r.label);

    expect(labels[0]).toBe('Ranked 1st');
    expect(labels[10]).toBe('Ranked 11th');
    expect(labels[11]).toBe('Ranked 12th');
    expect(labels[12]).toBe('Ranked 13th');
  });

  it('adds cumulative top-k rows to ranking item detail without duplicating top 1', () => {
    const rankingEntry = makeRankingEntry(5, 5);
    const planned = makePlannedTable({
      sourceQuestionId: 'R1',
      tableKind: 'ranking_item_rank',
      tableIdCandidate: 'r1__item_rank',
      analyticalSubtype: 'ranking',
      appliesToItem: 'R1_1',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [rankingEntry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const topLabels = result.tables[0].rows
      .filter(r => r.rowKind === 'topk')
      .map(r => r.label);

    expect(topLabels).toEqual(['Top 2', 'Top 3', 'Top 4']);
  });

  it('does not reintroduce dead ranking grid columns during assembly', () => {
    const rankingEntry = makeEntry({
      questionId: 'C500_1',
      analyticalSubtype: 'ranking',
      normalizedType: 'categorical_select',
      rankingDetail: { K: 3, N: 2, pattern: '1-3 of 2', source: 'observed-range' },
      questionBase: 177,
      hasVariableItemBases: true,
      variableBaseReason: 'ranking-artifact',
      items: [
        {
          column: 'C500_1r101c1',
          label: 'Message 101 c1',
          normalizedType: 'categorical_select',
          itemBase: 0,
          scaleLabels: [
            { value: 1, label: 'Rank 1' },
            { value: 2, label: 'Rank 2' },
            { value: 3, label: 'Rank 3' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'C500_1r101c2',
          label: 'Message 101 c2',
          normalizedType: 'categorical_select',
          itemBase: 63,
          scaleLabels: [
            { value: 1, label: 'Rank 1' },
            { value: 2, label: 'Rank 2' },
            { value: 3, label: 'Rank 3' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'C500_1r102c1',
          label: 'Message 102 c1',
          normalizedType: 'categorical_select',
          itemBase: 0,
          scaleLabels: [
            { value: 1, label: 'Rank 1' },
            { value: 2, label: 'Rank 2' },
            { value: 3, label: 'Rank 3' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'C500_1r102c2',
          label: 'Message 102 c2',
          normalizedType: 'categorical_select',
          itemBase: 53,
          scaleLabels: [
            { value: 1, label: 'Rank 1' },
            { value: 2, label: 'Rank 2' },
            { value: 3, label: 'Rank 3' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
      variables: ['C500_1r101c1', 'C500_1r101c2', 'C500_1r102c1', 'C500_1r102c2'],
      variableCount: 4,
    });

    const planned = makePlannedTable({
      sourceQuestionId: 'C500_1',
      tableKind: 'ranking_overview_rank',
      tableRole: 'overview_rank_1',
      tableIdCandidate: 'c500_1__ranking_overview_rank1',
      analyticalSubtype: 'ranking',
      normalizedType: 'categorical_select',
      splitReason: 'ranking_artifact_variable_bases',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [rankingEntry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const vars = result.tables[0].rows.map(r => r.variable);
    expect(vars).toEqual(['C500_1r101c2', 'C500_1r102c2']);
  });

  it('uses contextual bins and numeric stats range for non-0-100 numeric detail', () => {
    const numericEntry = makeEntry({
      questionId: 'N_RANGE',
      normalizedType: 'numeric_range',
      analyticalSubtype: 'standard',
      items: [
        {
          column: 'N_RANGE_1',
          label: 'Numeric item',
          normalizedType: 'numeric_range',
          itemBase: 100,
          scaleLabels: [
            { value: 1, label: '1' },
            { value: 2, label: '2' },
            { value: 3, label: '3' },
            { value: 4, label: '4' },
            { value: 5, label: '5' },
            { value: 6, label: '6' },
            { value: 7, label: '7' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
    });

    const planned = makePlannedTable({
      sourceQuestionId: 'N_RANGE',
      tableKind: 'numeric_item_detail',
      tableIdCandidate: 'n_range__detail',
      normalizedType: 'numeric_range',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [numericEntry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const table = result.tables[0];
    expect(table.statsSpec?.valueRange).toEqual([1, 7]);
    const binLabels = table.rows.filter(r => r.rowKind === 'bin').map(r => r.binLabel);
    expect(binLabels).not.toContain('1-10');
  });

  it('populates excludeTailValues for numeric/allocation stats specs', () => {
    const entry = makeEntry({
      questionId: 'N_TAIL',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      items: [
        {
          column: 'N_TAIL_1',
          label: 'Numeric item 1',
          normalizedType: 'numeric_range',
          itemBase: 100,
          scaleLabels: [
            { value: 1, label: '1' },
            { value: 7, label: '7' },
            { value: 98, label: "Don't know" },
            { value: 99, label: 'Refused' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'N_TAIL_2',
          label: 'Numeric item 2',
          normalizedType: 'numeric_range',
          itemBase: 100,
          scaleLabels: [
            { value: 1, label: '1' },
            { value: 7, label: '7' },
            { value: 99, label: 'N/A' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
    });

    const plannedTables = [
      makePlannedTable({
        sourceQuestionId: 'N_TAIL',
        tableKind: 'numeric_overview_mean',
        analyticalSubtype: 'standard',
        tableIdCandidate: 'n_tail__numeric_overview_mean',
      }),
      makePlannedTable({
        sourceQuestionId: 'N_TAIL',
        tableKind: 'numeric_item_detail',
        analyticalSubtype: 'standard',
        appliesToItem: 'N_TAIL_1',
        tableIdCandidate: 'n_tail__numeric_item_detail',
      }),
      makePlannedTable({
        sourceQuestionId: 'N_TAIL',
        tableKind: 'allocation_overview',
        analyticalSubtype: 'allocation',
        tableIdCandidate: 'n_tail__allocation_overview',
      }),
      makePlannedTable({
        sourceQuestionId: 'N_TAIL',
        tableKind: 'allocation_item_detail',
        analyticalSubtype: 'allocation',
        appliesToItem: 'N_TAIL_1',
        tableIdCandidate: 'n_tail__allocation_item_detail',
      }),
    ];

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    for (const table of result.tables) {
      expect(table.statsSpec?.excludeTailValues).toEqual([98, 99]);
    }
  });

  it('leaves tableSubtitle blank when appliesToItem label duplicates question text', () => {
    const entry = makeEntry({
      questionId: 'S12',
      questionText: 'In a typical week, approximately how many unique patients do you personally manage/see?',
      normalizedType: 'numeric_range',
      analyticalSubtype: 'standard',
      items: [
        {
          column: 'S12_1',
          label: 'S12: In a typical week, approximately how many unique patients do you personally manage/see?',
          normalizedType: 'numeric_range',
          itemBase: 100,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
    });

    const planned = makePlannedTable({
      sourceQuestionId: 'S12',
      tableKind: 'numeric_item_detail',
      normalizedType: 'numeric_range',
      analyticalSubtype: 'standard',
      appliesToItem: 'S12_1',
      tableIdCandidate: 's12__numeric_item_detail',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(result.tables[0].tableSubtitle).toBe('');
  });

  it('builds non-empty rows for every supported table kind', () => {
    const standardEntry = makeEntry({ questionId: 'Q_STD' });
    const rankingEntry = makeRankingEntry(3, 4);
    const scaleEntry = makeScaleEntry(5, [
      { value: 1, label: 'Strongly disagree' },
      { value: 2, label: 'Disagree' },
      { value: 3, label: 'Neutral' },
      { value: 4, label: 'Agree' },
      { value: 5, label: 'Strongly agree' },
    ], { questionId: 'Q_SCALE' });
    const allocationEntry = makeEntry({
      questionId: 'Q_ALLOC',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      items: [
        {
          column: 'Q_ALLOC_r1c1',
          label: 'Alloc 1',
          normalizedType: 'numeric_range',
          itemBase: 100,
          scaleLabels: [
            { value: 0, label: '0' },
            { value: 50, label: '50' },
            { value: 100, label: '100' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'Q_ALLOC_r1c2',
          label: 'Alloc 2',
          normalizedType: 'numeric_range',
          itemBase: 100,
          scaleLabels: [
            { value: 0, label: '0' },
            { value: 50, label: '50' },
            { value: 100, label: '100' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
      variables: ['Q_ALLOC_r1c1', 'Q_ALLOC_r1c2'],
      variableCount: 2,
    });
    const maxdiffEntry = makeEntry({
      questionId: 'Q_MD',
      analyticalSubtype: 'maxdiff_exercise',
      variables: ['AnchProbInd_1', 'AnchProbInd_2'],
      items: [
        {
          column: 'AnchProbInd_1',
          label: 'Item 1',
          normalizedType: 'numeric_range',
          itemBase: 100,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
    });

    const allKinds: Array<{ kind: PlannedTable['tableKind']; qid: string; extras?: Partial<PlannedTable> }> = [
      { kind: 'standard_overview', qid: 'Q_STD' },
      { kind: 'standard_item_detail', qid: 'Q_STD', extras: { appliesToItem: 'Q_STD_1' } },
      { kind: 'standard_cluster_detail', qid: 'Q_STD' },
      { kind: 'grid_row_detail', qid: 'Q_ALLOC', extras: { appliesToColumn: 'Q_ALLOC_r1c1,Q_ALLOC_r1c2' } },
      { kind: 'grid_col_detail', qid: 'Q_ALLOC', extras: { appliesToColumn: 'Q_ALLOC_r1c1,Q_ALLOC_r1c2' } },
      { kind: 'numeric_overview_mean', qid: 'Q_ALLOC' },
      { kind: 'numeric_item_detail', qid: 'Q_ALLOC', extras: { appliesToItem: 'Q_ALLOC_r1c1' } },
      { kind: 'scale_overview_full', qid: 'Q_SCALE' },
      { kind: 'scale_overview_rollup_t2b', qid: 'Q_SCALE' },
      { kind: 'scale_overview_rollup_middle', qid: 'Q_SCALE' },
      { kind: 'scale_overview_rollup_b2b', qid: 'Q_SCALE' },
      { kind: 'scale_overview_rollup_nps', qid: 'Q_SCALE' },
      { kind: 'scale_overview_rollup_combined', qid: 'Q_SCALE' },
      { kind: 'scale_overview_rollup_mean', qid: 'Q_SCALE' },
      { kind: 'scale_item_detail_full', qid: 'Q_SCALE', extras: { appliesToItem: 'S1_1' } },
      { kind: 'scale_dimension_compare', qid: 'Q_ALLOC', extras: { appliesToColumn: 'Q_ALLOC_r1c1,Q_ALLOC_r1c2' } },
      { kind: 'ranking_overview_rank', qid: 'R1', extras: { tableRole: 'overview_rank_1', tableIdCandidate: 'rank1' } },
      { kind: 'ranking_overview_topk', qid: 'R1', extras: { tableRole: 'overview_top2', tableIdCandidate: 'top2' } },
      { kind: 'ranking_item_rank', qid: 'R1', extras: { appliesToItem: 'R1_1' } },
      { kind: 'allocation_overview', qid: 'Q_ALLOC' },
      { kind: 'allocation_item_detail', qid: 'Q_ALLOC', extras: { appliesToItem: 'Q_ALLOC_r1c1' } },
      { kind: 'maxdiff_api', qid: 'Q_MD' },
      { kind: 'maxdiff_ap', qid: 'Q_MD' },
      { kind: 'maxdiff_sharpref', qid: 'Q_MD' },
    ];

    const plannedTables = allKinds.map((row, i) =>
      makePlannedTable({
        sourceQuestionId: row.qid,
        tableKind: row.kind,
        tableIdCandidate: `kind_${i}_${row.kind}`,
        analyticalSubtype:
          row.kind.startsWith('ranking_') ? 'ranking'
            : row.kind.startsWith('scale_') ? 'scale'
              : row.kind.startsWith('allocation_') ? 'allocation'
                : row.kind.startsWith('maxdiff_') ? 'maxdiff'
                  : 'standard',
        normalizedType:
          row.kind.startsWith('numeric_') || row.kind.startsWith('allocation_') ? 'numeric_range' : 'categorical_select',
        ...row.extras,
      }),
    );

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [standardEntry, rankingEntry, scaleEntry, allocationEntry, maxdiffEntry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    expect(result.tables).toHaveLength(plannedTables.length);
    for (const table of result.tables) {
      expect(table.rows.length).toBeGreaterThan(0);
    }
  });

  it('auto-resolves blank frequency filterValue for binary_flag grid rows', () => {
    const entry = makeEntry({
      questionId: 'A22',
      analyticalSubtype: 'standard',
      normalizedType: 'binary_flag',
      items: [
        {
          column: 'A22r1c1',
          label: 'Brand 1',
          normalizedType: 'binary_flag',
          itemBase: 100,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'A22r1c2',
          label: 'Brand 2',
          normalizedType: 'binary_flag',
          itemBase: 100,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
      variables: ['A22r1c1', 'A22r1c2'],
      variableCount: 2,
    });

    const planned = makePlannedTable({
      sourceQuestionId: 'A22',
      tableKind: 'grid_row_detail',
      tableIdCandidate: 'a22__grid_row_r1',
      normalizedType: 'binary_flag',
      appliesToColumn: 'A22r1c1,A22r1c2',
      appliesToItem: 'r1',
      computeMaskAnchorVariable: 'A22r1c1',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const table = result.tables[0];
    expect(table.exclude).toBe(false);
    expect(table.filterReviewRequired).toBe(false);
    expect(table.appliesToItem).toBe('r1');
    expect(table.computeMaskAnchorVariable).toBe('A22r1c1');

    const valueRows = table.rows.filter(r => r.rowKind === 'value');
    expect(valueRows.length).toBeGreaterThan(0);
    for (const row of valueRows) {
      expect(row.filterValue).toBe('1');
    }
  });

  it('flags unresolved blank frequency filters upstream and keeps rows execution-safe', () => {
    const entry = makeEntry({
      questionId: 'UNRES',
      analyticalSubtype: 'standard',
      normalizedType: 'mystery_type',
      items: [
        {
          column: 'UNRES_1',
          label: 'Unknown coded row',
          normalizedType: 'mystery_type',
          itemBase: 100,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
      variables: ['UNRES_1'],
      variableCount: 1,
    });

    const planned = makePlannedTable({
      sourceQuestionId: 'UNRES',
      tableKind: 'standard_item_detail',
      tableIdCandidate: 'unres__item_detail',
      normalizedType: 'mystery_type',
      appliesToItem: 'UNRES_1',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const table = result.tables[0];
    expect(table.exclude).toBe(true);
    expect(table.filterReviewRequired).toBe(true);
    expect(table.excludeReason).toContain('canonical_missing_filtervalue_unresolved');
    expect(table.notes.some(n => n.includes('CRITICAL'))).toBe(true);

    // No frequency row that requires a filter should remain blank after 13d policy.
    const unresolvedRows = table.rows.filter((row) => {
      const requiresFilter =
        row.variable !== '_CAT_' &&
        row.rowKind !== 'stat' &&
        row.rowKind !== 'not_answered' &&
        !(row.isNet && row.netComponents.length > 0);
      return requiresFilter && row.filterValue.trim() === '';
    });
    expect(unresolvedRows).toHaveLength(0);
  });

  it('keeps allocation grid slices on the mean_rows path', () => {
    const entry = makeEntry({
      questionId: 'A4b',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      sumConstraint: {
        detected: true,
        constraintValue: 100,
        constraintAxis: 'across-cols',
        confidence: 1,
      },
      items: [
        {
          column: 'A4br1c1',
          label: 'Product A (generic)',
          normalizedType: 'numeric_range',
          itemBase: 144,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'A4br2c1',
          label: 'Product B (generic)',
          normalizedType: 'numeric_range',
          itemBase: 131,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'A4br1c2',
          label: 'Product A (generic)',
          normalizedType: 'numeric_range',
          itemBase: 144,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'A4br2c2',
          label: 'Product B (generic)',
          normalizedType: 'numeric_range',
          itemBase: 131,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
      variables: ['A4br1c1', 'A4br2c1', 'A4br1c2', 'A4br2c2'],
      variableCount: 4,
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [131, 144],
      questionBase: 180,
    });

    const planned = makePlannedTable({
      sourceQuestionId: 'A4b',
      analyticalSubtype: 'allocation',
      normalizedType: 'numeric_range',
      tableKind: 'grid_col_detail',
      tableIdCandidate: 'a4b__allocation_grid_col_c1',
      appliesToItem: 'c1',
      appliesToColumn: 'A4br1c1,A4br2c1',
      basePolicy: 'item_base',
      baseSource: 'items[].itemBase',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const table = result.tables[0];
    expect(table.tableType).toBe('mean_rows');
    expect(table.exclude).toBe(false);
    expect(table.excludeReason).toBe('');
    expect(table.statsSpec?.mean).toBe(true);
    expect(table.rows.every((row) => row.filterValue === '')).toBe(true);
  });

  it('keeps numeric grid slices on the mean_rows path', () => {
    const entry = makeEntry({
      questionId: 'A4',
      analyticalSubtype: 'standard',
      normalizedType: 'numeric_range',
      items: [
        {
          column: 'A4r7c1',
          label: 'Other',
          normalizedType: 'numeric_range',
          itemBase: 180,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
        {
          column: 'A4r7c2',
          label: 'Other',
          normalizedType: 'numeric_range',
          itemBase: 180,
          scaleLabels: [],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
      variables: ['A4r7c1', 'A4r7c2'],
      variableCount: 2,
      questionBase: 180,
    });

    const planned = makePlannedTable({
      sourceQuestionId: 'A4',
      analyticalSubtype: 'standard',
      normalizedType: 'numeric_range',
      tableKind: 'grid_row_detail',
      tableIdCandidate: 'a4__numeric_grid_row_r7',
      appliesToItem: 'r7',
      appliesToColumn: 'A4r7c1,A4r7c2',
      basePolicy: 'question_base_shared',
      baseSource: 'questionBase',
    });

    const result = runCanonicalAssembly({
      validatedPlan: {
        metadata: {},
        plannedTables: [planned],
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries: [entry],
      metadata: makeMetadata(),
      dataset: 'test',
    });

    const table = result.tables[0];
    expect(table.tableType).toBe('mean_rows');
    expect(table.exclude).toBe(false);
    expect(table.excludeReason).toBe('');
    expect(table.statsSpec?.mean).toBe(true);
    expect(table.rows.every((row) => row.filterValue === '')).toBe(true);
  });
});

// =============================================================================
// Correction Re-derivation Tests
// =============================================================================

describe('Correction re-derivation behavior', () => {
  it('re-derives tables with corrected subtype via buildContext + planEntryTables', () => {
    // Simulate: entry classified as standard, corrected to scale with 5 points
    const originalEntry = makeEntry({
      questionId: 'CORR1',
      analyticalSubtype: 'standard',
      items: [
        {
          column: 'CORR1_1',
          label: 'Item 1',
          normalizedType: 'categorical_select',
          itemBase: 100,
          scaleLabels: [
            { value: 1, label: 'Strongly disagree' },
            { value: 2, label: 'Disagree' },
            { value: 3, label: 'Neutral' },
            { value: 4, label: 'Agree' },
            { value: 5, label: 'Strongly agree' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
    });

    const reportableMap = new Map([['CORR1', originalEntry]]);
    const ambiguities: PlannerAmbiguity[] = [];

    // Plan with original subtype (standard)
    const ctxOriginal = buildContext('ds', originalEntry, reportableMap);
    const tablesOriginal = planEntryTables(ctxOriginal, ambiguities);

    // Re-derive with corrected subtype (scale)
    const correctedEntry = {
      ...originalEntry,
      analyticalSubtype: 'scale' as const,
    };
    const correctedMap = new Map([['CORR1', correctedEntry as QuestionIdEntry]]);
    const ctx = buildContext('ds', correctedEntry as QuestionIdEntry, correctedMap);
    const tablesAfter = planEntryTables(ctx, ambiguities);

    // Standard produces standard_overview; scale produces scale tables
    expect(tablesOriginal.some(t => t.tableKind === 'standard_overview')).toBe(true);
    expect(tablesAfter.some(t =>
      t.tableKind === 'scale_overview_full' || t.tableKind === 'scale_overview_rollup_combined',
    )).toBe(true);
  });

  it('planner guards override: scale with 3 points falls back to standard', () => {
    const entry = makeEntry({
      questionId: 'GUARD1',
      analyticalSubtype: 'scale',
      items: [
        {
          column: 'GUARD1_1',
          label: 'Item 1',
          normalizedType: 'categorical_select',
          itemBase: 100,
          scaleLabels: [
            { value: 1, label: 'Low' },
            { value: 2, label: 'Medium' },
            { value: 3, label: 'High' },
          ],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ] as QuestionIdEntry['items'],
    });

    const reportableMap = new Map([['GUARD1', entry]]);
    const ambiguities: PlannerAmbiguity[] = [];
    const ctx = buildContext('ds', entry, reportableMap);
    const tables = planEntryTables(ctx, ambiguities);

    // 3-point scale should fall back to standard frequency
    const allStandard = tables.every(t =>
      t.tableKind.startsWith('standard_') || t.tableKind.startsWith('numeric_'),
    );
    expect(allStandard).toBe(true);
  });
});

// =============================================================================
// End-to-end: planner → assembly integration
// =============================================================================

describe('Planner → Assembly integration', () => {
  it('planned tables pass through assembly without loss', () => {
    const entries = [
      makeEntry({ questionId: 'Q1' }),
      makeEntry({ questionId: 'Q2' }),
    ];
    const metadata = makeMetadata();

    const plan = runTablePlanner({ entries, metadata, dataset: 'test' });

    const canonical = runCanonicalAssembly({
      validatedPlan: {
        metadata: { plannerVersion: 'test' },
        plannedTables: plan.plannedTables,
        subtypeReviews: [],
        blockConfidence: [],
      },
      entries,
      metadata,
      dataset: 'test',
    });

    expect(canonical.tables.length).toBe(plan.plannedTables.length);

    // Every canonical table should have non-empty rows
    for (const table of canonical.tables) {
      expect(table.rows.length).toBeGreaterThan(0);
      expect(table.tableId).toBeTruthy();
      expect(table.questionId).toBeTruthy();
    }
  });
});

// =============================================================================
// Phase A: Planner structural base signal consumption
// =============================================================================

describe('Phase A: low-base detail suppression', () => {
  const lowBaseConfig: PlannerConfig = {
    lowBaseSuppression: { enabled: true, threshold: 30 },
  };

  function makeLowBaseEntry(itemBases: number[]): QuestionIdEntry {
    return makeEntry({
      questionId: 'LB1',
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [Math.min(...itemBases), Math.max(...itemBases)] as [number, number],
      totalN: 200,
      questionBase: 200,
      items: itemBases.map((base, i) => ({
        column: `LB1_${i + 1}`,
        label: `Item ${i + 1}`,
        normalizedType: 'categorical_select' as const,
        itemBase: base,
        scaleLabels: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      })),
      baseContract: buildEntryBaseContract({
        totalN: 200,
        questionBase: 200,
        itemBase: null,
        itemBaseRange: [Math.min(...itemBases), Math.max(...itemBases)] as [number, number],
        hasVariableItemBases: true,
        variableBaseReason: 'genuine',
        rankingDetail: null,
        exclusionReason: null,
      }),
    });
  }

  it('suppresses precision detail tables when all items have low base and suppression is enabled', () => {
    // Requirements for this test:
    // - All item bases < 30 (low-base threshold)
    // - Spread ≥ 20 absolute and ≥ 5% relative (triggers materialSplit)
    // - 4+ distinct bases (forces 'individual' routing → item_detail, not cluster)
    const entry = makeLowBaseEntry([5, 10, 15, 28]);
    const metadata = makeMetadata();
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('test', entry, reportableMap, metadata);
    const ambiguities: PlannerAmbiguity[] = [];
    const baseDecisions: BaseDecision[] = [];

    // Verify precondition: materialSplit must be true for detail tables to exist
    expect(ctx.basePlanning.materialSplit).toBe(true);

    // First verify without suppression: precision tables should exist
    const tablesNoSuppression = planEntryTables(
      buildContext('test', entry, reportableMap, metadata),
      [],
      undefined,
      { lowBaseSuppression: { enabled: false, threshold: 30 } },
    );
    const hasPrecisionBefore = tablesNoSuppression.some(t =>
      t.tableKind === 'standard_item_detail' || t.tableKind === 'standard_cluster_detail',
    );
    expect(hasPrecisionBefore).toBe(true);

    // Now with suppression enabled
    const tables = planEntryTables(ctx, ambiguities, undefined, lowBaseConfig, baseDecisions);

    // Should have overview but no precision detail (suppressed)
    expect(tables.some(t => t.tableKind === 'standard_overview')).toBe(true);
    expect(tables.some(t => t.tableKind === 'standard_item_detail')).toBe(false);
    expect(tables.some(t => t.tableKind === 'standard_cluster_detail')).toBe(false);
    expect(baseDecisions.some(d => d.decision === 'low_base_detail_suppressed')).toBe(true);
  });

  it('does not suppress when suppression is disabled', () => {
    const entry = makeLowBaseEntry([5, 10, 15, 28]);
    const metadata = makeMetadata();
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('test', entry, reportableMap, metadata);
    const ambiguities: PlannerAmbiguity[] = [];
    const baseDecisions: BaseDecision[] = [];

    const disabledConfig: PlannerConfig = {
      lowBaseSuppression: { enabled: false, threshold: 30 },
    };
    planEntryTables(ctx, ambiguities, undefined, disabledConfig, baseDecisions);

    // Detail tables should still be present (materialSplit is true, suppression disabled)
    expect(ctx.basePlanning.materialSplit).toBe(true);
    expect(baseDecisions.some(d => d.decision === 'low_base_detail_suppressed')).toBe(false);
  });

  it('does not suppress when only some items have low base', () => {
    const entry = makeLowBaseEntry([15, 200, 150]);
    const metadata = makeMetadata();
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('test', entry, reportableMap, metadata);
    const ambiguities: PlannerAmbiguity[] = [];
    const baseDecisions: BaseDecision[] = [];

    planEntryTables(ctx, ambiguities, undefined, lowBaseConfig, baseDecisions);

    expect(baseDecisions.some(d => d.decision === 'low_base_detail_suppressed')).toBe(false);
  });
});

describe('Phase A: ranking-artifact-ambiguous structure gate flag', () => {
  it('flags tables for StructureGateAgent review when ranking-artifact-ambiguous signal is present', () => {
    const entry = makeEntry({
      questionId: 'RA1',
      analyticalSubtype: 'ranking',
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      rankingDetail: { K: 3, N: 10, pattern: 'r1_to_rK', source: 'scale-labels' },
      baseContract: buildEntryBaseContract({
        totalN: 200,
        questionBase: 150,
        itemBase: null,
        itemBaseRange: [80, 150],
        hasVariableItemBases: true,
        variableBaseReason: 'genuine',
        rankingDetail: { K: 3 },
        exclusionReason: null,
      }),
    });

    // Manually inject the ambiguous signal (normally set by baseEnricher when
    // ranking + filtered overlap)
    entry.baseContract.classification.variationClass = 'ranking_ambiguous';
    entry.baseContract.classification.comparabilityStatus = 'ambiguous';
    entry.baseContract.signals.push('ranking-artifact-ambiguous');

    const metadata = makeMetadata();
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('test', entry, reportableMap, metadata);
    const ambiguities: PlannerAmbiguity[] = [];
    const baseDecisions: BaseDecision[] = [];

    const tables = planEntryTables(ctx, ambiguities, undefined, undefined, baseDecisions);

    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every(t => t.structureGateReviewRequired === true)).toBe(true);
    expect(baseDecisions.some(d => d.decision === 'ranking_ambiguous_flagged_for_structure_gate')).toBe(true);
    expect(ambiguities.some(a => a.code === 'ranking_artifact_ambiguous')).toBe(true);
  });
});

describe('Phase A: compute-mask-required verification', () => {
  it('sets computeMaskVerified on tables when compute-mask-required signal is present', () => {
    const entry = makeEntry({
      questionId: 'CM1',
      isFiltered: true,
      questionBase: 100,
      totalN: 200,
      baseContract: buildEntryBaseContract({
        totalN: 200,
        questionBase: 100,
        itemBase: null,
        itemBaseRange: null,
        hasVariableItemBases: false,
        variableBaseReason: null,
        rankingDetail: null,
        exclusionReason: null,
      }),
    });

    const metadata = makeMetadata();
    const reportableMap = new Map([[entry.questionId, entry]]);
    const ctx = buildContext('test', entry, reportableMap, metadata);
    const ambiguities: PlannerAmbiguity[] = [];
    const baseDecisions: BaseDecision[] = [];

    const tables = planEntryTables(ctx, ambiguities, undefined, undefined, baseDecisions);

    // If compute-mask-required signal was present, tables should be verified
    const hasMaskSignal = ctx.basePlanning.computeRiskSignals.includes('compute-mask-required');
    if (hasMaskSignal) {
      expect(tables.every(t => t.computeMaskVerified === true)).toBe(true);
      expect(baseDecisions.some(d => d.decision === 'compute_mask_verified')).toBe(true);
    }
  });
});

describe('Phase A: default config regression', () => {
  it('produces identical output with no config vs default config', () => {
    const entry = makeEntry();
    const metadata = makeMetadata();
    const reportableMap = new Map([[entry.questionId, entry]]);

    const ctx1 = buildContext('test', entry, reportableMap, metadata);
    const ambiguities1: PlannerAmbiguity[] = [];
    const tables1 = planEntryTables(ctx1, ambiguities1);

    const ctx2 = buildContext('test', entry, reportableMap, metadata);
    const ambiguities2: PlannerAmbiguity[] = [];
    const baseDecisions: BaseDecision[] = [];
    const tables2 = planEntryTables(ctx2, ambiguities2, undefined, DEFAULT_PLANNER_CONFIG, baseDecisions);

    expect(tables1.length).toBe(tables2.length);
    expect(tables1.map(t => t.tableKind)).toEqual(tables2.map(t => t.tableKind));
    // No low-base suppression should have fired
    expect(baseDecisions.some(d => d.decision === 'low_base_detail_suppressed')).toBe(false);
  });
});

// =============================================================================
// Phase C: Low-base handling becomes actionable
// =============================================================================

describe('Phase C: low-base-caution disclosure token', () => {
  it('emits low-base-caution token when plannerBaseSignals includes low-base', () => {
    const planned = {
      baseViewRole: 'anchor' as const,
      plannerBaseComparability: 'shared' as const,
      plannerBaseSignals: ['low-base' as const],
      baseContract: buildEntryBaseContract({
        totalN: 200,
        questionBase: 20,
        itemBase: null,
        itemBaseRange: null,
        hasVariableItemBases: false,
        variableBaseReason: null,
        rankingDetail: null,
        exclusionReason: null,
      }),
      basePolicy: 'question_base_shared',
      questionBase: 20,
      itemBase: null,
      appliesToItem: null,
      sourceQuestionId: 'Q1',
      familyRoot: 'Q1',
    };

    const disclosure = buildPlannerBaseDisclosure(planned, undefined);
    expect(disclosure.defaultNoteTokens).toContain('low-base-caution');
  });

  it('does not emit low-base-caution when no low-base signal', () => {
    const planned = {
      baseViewRole: 'anchor' as const,
      plannerBaseComparability: 'shared' as const,
      plannerBaseSignals: [] as PlannerBaseSignal[],
      baseContract: buildEntryBaseContract({
        totalN: 200,
        questionBase: 200,
        itemBase: null,
        itemBaseRange: null,
        hasVariableItemBases: false,
        variableBaseReason: null,
        rankingDetail: null,
        exclusionReason: null,
      }),
      basePolicy: 'question_base_shared',
      questionBase: 200,
      itemBase: null,
      appliesToItem: null,
      sourceQuestionId: 'Q1',
      familyRoot: 'Q1',
    };

    const disclosure = buildPlannerBaseDisclosure(planned, undefined);
    expect(disclosure.defaultNoteTokens).not.toContain('low-base-caution');
  });
});

describe('Phase C: low-base-caution rendering', () => {
  it('renders low-base-caution token as "Caution: Low base size"', () => {
    const notes = renderBaseDisclosureNoteParts(['low-base-caution'], null);
    expect(notes).toEqual(['Caution: Low base size']);
  });

  it('renders low-base-caution alongside other tokens', () => {
    const notes = renderBaseDisclosureNoteParts(
      ['anchor-base-varies-by-item', 'anchor-base-range', 'low-base-caution'],
      { min: 15, max: 28 },
    );
    expect(notes).toContain('Base varies by item (n=15-28)');
    expect(notes).toContain('Caution: Low base size');
  });
});

describe('Phase C: planner config wiring through runTablePlanner', () => {
  it('suppresses detail tables when config.lowBaseSuppression.enabled is true', () => {
    const entry = makeEntry({
      questionId: 'PC1',
      hasVariableItemBases: true,
      variableBaseReason: 'genuine',
      itemBaseRange: [5, 28] as [number, number],
      totalN: 200,
      questionBase: 200,
      items: [5, 10, 15, 28].map((base, i) => ({
        column: `PC1_${i + 1}`,
        label: `Item ${i + 1}`,
        normalizedType: 'categorical_select' as const,
        itemBase: base,
        scaleLabels: [{ value: 1, label: 'Yes' }, { value: 2, label: 'No' }],
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      })),
      baseContract: buildEntryBaseContract({
        totalN: 200,
        questionBase: 200,
        itemBase: null,
        itemBaseRange: [5, 28] as [number, number],
        hasVariableItemBases: true,
        variableBaseReason: 'genuine',
        rankingDetail: null,
        exclusionReason: null,
      }),
    });
    const metadata = makeMetadata();

    // Via runTablePlanner with enabled config
    const enabledResult = runTablePlanner({
      entries: [entry],
      metadata,
      dataset: 'test',
      config: { lowBaseSuppression: { enabled: true, threshold: 30 } },
    });

    // Via runTablePlanner with disabled config
    const disabledResult = runTablePlanner({
      entries: [entry],
      metadata,
      dataset: 'test',
      config: { lowBaseSuppression: { enabled: false, threshold: 30 } },
    });

    const enabledKinds = enabledResult.plannedTables.map(t => t.tableKind);
    const disabledKinds = disabledResult.plannedTables.map(t => t.tableKind);

    // Disabled config should have detail tables
    expect(disabledKinds.some(k => k === 'standard_item_detail' || k === 'standard_cluster_detail')).toBe(true);

    // Enabled config should not have detail tables (all items < 30)
    expect(enabledKinds.some(k => k === 'standard_item_detail' || k === 'standard_cluster_detail')).toBe(false);

    // Both should have overview
    expect(enabledKinds).toContain('standard_overview');
    expect(disabledKinds).toContain('standard_overview');
  });
});
