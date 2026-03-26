/**
 * Unit tests for Stage 13e — Table Metadata Pre-fill
 *
 * Tests the deterministic enrichment of tableSubtitle, userNote, and baseText
 * on canonical tables produced by stage 13d.
 */

import { describe, it, expect } from 'vitest';
import { runTableMetadataPrefill } from '../prefill';
import { buildEntryBaseContract, projectTableBaseContract } from '../../baseContract';
import type {
  CanonicalTableOutput,
  CanonicalTable,
  CanonicalRow,
  QuestionIdEntry,
  SurveyMetadata,
} from '../types';

// =============================================================================
// Test helpers
// =============================================================================

function makeRow(overrides: Partial<CanonicalRow> = {}): CanonicalRow {
  return {
    variable: 'Q1_1',
    label: 'Option A',
    filterValue: '1',
    rowKind: 'value',
    isNet: false,
    indent: 0,
    netLabel: '',
    netComponents: [],
    statType: '',
    binRange: null,
    binLabel: '',
    rankLevel: null,
    topKLevel: null,
    excludeFromStats: false,
    rollupConfig: null,
    ...overrides,
  };
}

function makeTable(overrides: Partial<CanonicalTable> = {}): CanonicalTable {
  const table: CanonicalTable = {
    tableId: 'T001',
    questionId: 'Q1',
    familyRoot: 'Q1',
    sourceTableId: 'T001',
    splitFromTableId: '',
    tableKind: 'standard_overview',
    analyticalSubtype: 'standard',
    normalizedType: 'categorical',
    tableType: 'frequency',
    questionText: 'Which option do you prefer?',
    rows: [makeRow()],
    statsSpec: null,
    derivationHint: null,
    statTestSpec: null,
    basePolicy: 'total_base',
    baseSource: 'question',
    questionBase: 200,
    itemBase: null,
    baseContract: projectTableBaseContract(buildEntryBaseContract({
      totalN: 200,
      questionBase: 200,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy: 'total_base',
      questionBase: 200,
      itemBase: null,
    }),
    baseText: 'All respondents (n=200)',
    isDerived: false,
    sortOrder: 0,
    sortBlock: 'A',
    surveySection: '',
    userNote: '',
    tableSubtitle: '',
    splitReason: null,
    appliesToItem: null,
    computeMaskAnchorVariable: null,
    appliesToColumn: null,
    additionalFilter: '',
    exclude: false,
    excludeReason: '',
    filterReviewRequired: false,
    lastModifiedBy: 'CanonicalAssembler',
    notes: [],
    ...overrides,
    stimuliSetSlice: overrides.stimuliSetSlice ?? null,
    binarySide: overrides.binarySide ?? null,
  };
  table.baseContract = overrides.baseContract ?? projectTableBaseContract(buildEntryBaseContract({
    totalN: table.questionBase,
    questionBase: table.questionBase,
    itemBase: table.itemBase,
    itemBaseRange: null,
    hasVariableItemBases: false,
    variableBaseReason: null,
    rankingDetail: null,
    exclusionReason: null,
  }), {
    basePolicy: table.basePolicy,
    questionBase: table.questionBase,
    itemBase: table.itemBase,
  });
  return table;
}

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  const entry = {
    questionId: 'Q1',
    questionText: 'Which option do you prefer?',
    variables: ['Q1_1', 'Q1_2'],
    variableCount: 2,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'deterministic',
    subtypeConfidence: 1.0,
    rankingDetail: null,
    sumConstraint: null,
    pipeColumns: [],
    surveyMatch: null,
    surveyText: null,
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'categorical',
    items: [],
    totalN: 200,
    questionBase: 200,
    isFiltered: false,
    gapFromTotal: 0,
    gapPct: 0,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
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
    proposedBase: null,
    proposedBaseLabel: null,
    displayQuestionId: null,
    displayQuestionText: null,
    sectionHeader: null,
    itemActivity: null,
    hasMessageMatches: false,
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

function makeCanonicalOutput(
  tables: CanonicalTable[],
): CanonicalTableOutput {
  return {
    metadata: {
      generatedAt: '2026-03-17T00:00:00Z',
      assemblerVersion: '13d-v1',
      dataset: 'test',
      inputPlanPath: '',
      inputQuestionIdPath: '',
      totalTables: tables.length,
    },
    summary: {
      byTableKind: {},
      byTableType: {},
      byAnalyticalSubtype: {},
      totalRows: 0,
    },
    tables,
  };
}

const METADATA = {
  datasetName: 'test',
  dataset: 'test',
  totalN: 200,
  generatedAt: '2026-03-17T00:00:00Z',
  scriptVersion: '1.0',
  isMessageTestingSurvey: false,
  hasMaxDiff: false,
  isDemandSurvey: false,
  hasPipeColumns: false,
  hasLoops: false,
  loopFamilyCount: 0,
} as unknown as SurveyMetadata;

// =============================================================================
// tableSubtitle Tests
// =============================================================================

describe('13e tableSubtitle', () => {
  it('scale_overview_rollup_t2b → "Top 2 Box Summary" (from rollupConfig)', () => {
    const table = makeTable({
      tableKind: 'scale_overview_rollup_t2b',
      rows: [
        makeRow({
          rollupConfig: { scalePoints: 5, boxPosition: 'top', boxWidth: 2, defaultLabel: 'T2B' },
        }),
      ],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Top 2 Box Summary');
  });

  it('scale_overview_rollup_b2b → "Bottom 2 Box Summary"', () => {
    const table = makeTable({
      tableKind: 'scale_overview_rollup_b2b',
      rows: [
        makeRow({
          rollupConfig: { scalePoints: 5, boxPosition: 'bottom', boxWidth: 2, defaultLabel: 'B2B' },
        }),
      ],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Bottom 2 Box Summary');
  });

  it('scale_overview_rollup_t2b with boxWidth=3 → "Top 3 Box Summary"', () => {
    const table = makeTable({
      tableKind: 'scale_overview_rollup_t2b',
      rows: [
        makeRow({
          rollupConfig: { scalePoints: 7, boxPosition: 'top', boxWidth: 3, defaultLabel: 'T3B' },
        }),
      ],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Top 3 Box Summary');
  });

  it('scale_overview_rollup_middle with rollupConfig middle → "Middle Box Summary"', () => {
    const table = makeTable({
      tableKind: 'scale_overview_rollup_middle',
      rows: [
        makeRow({
          rollupConfig: { scalePoints: 7, boxPosition: 'middle', boxWidth: 3, defaultLabel: 'Middle 3' },
        }),
      ],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Middle Box Summary');
  });

  it('top rollup with malformed width falls back to Top 2 Box Summary width', () => {
    const table = makeTable({
      tableKind: 'scale_overview_rollup_t2b',
      rows: [
        makeRow({
          rollupConfig: { scalePoints: 5, boxPosition: 'top', boxWidth: undefined as unknown as number, defaultLabel: 'T2B' },
        }),
      ],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Top 2 Box Summary');
  });

  it('ranking_overview_rank with rankLevel=1 → "Ranked 1st Summary"', () => {
    const table = makeTable({
      tableKind: 'ranking_overview_rank',
      rows: [makeRow({ rankLevel: 1 })],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Ranked 1st Summary');
  });

  it('ranking_overview_topk with topKLevel=3 → "Top 3 Summary"', () => {
    const table = makeTable({
      tableKind: 'ranking_overview_topk',
      rows: [makeRow({ topKLevel: 3 })],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Top 3 Summary');
  });

  it('prepends ranking context to stimuli-set ranking subtitles', () => {
    const table = makeTable({
      tableKind: 'ranking_overview_rank',
      tableSubtitle: 'Set 1',
      rows: [makeRow({ rowKind: 'rank', rankLevel: 1, filterValue: '1' })],
      stimuliSetSlice: {
        familySource: 'B500',
        setIndex: 0,
        setLabel: 'Set 1',
        sourceQuestionId: 'B500_1',
      },
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Ranked 1st Summary — Set 1');
  });

  it('prepends top-k context to stimuli-set ranking subtitles', () => {
    const table = makeTable({
      tableKind: 'ranking_overview_topk',
      tableSubtitle: 'Set 1',
      rows: [makeRow({ rowKind: 'topk', topKLevel: 3, filterValue: '1-3' })],
      stimuliSetSlice: {
        familySource: 'B500',
        setIndex: 0,
        setLabel: 'Set 1',
        sourceQuestionId: 'B500_1',
      },
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Top 3 Summary — Set 1');
  });

  it('appends set number for iteration-family ranking rank summaries', () => {
    const table = makeTable({
      questionId: 'B500',
      familyRoot: 'B500_2',
      tableKind: 'ranking_overview_rank',
      rows: [makeRow({ rowKind: 'rank', rankLevel: 1, filterValue: '1' })],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Ranked 1st Summary - Set 2');
  });

  it('appends set number for iteration-family ranking top-k summaries', () => {
    const table = makeTable({
      questionId: 'B500',
      familyRoot: 'B500_3',
      tableKind: 'ranking_overview_topk',
      rows: [makeRow({ rowKind: 'topk', topKLevel: 4, filterValue: '1-4' })],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Top 4 Summary - Set 3');
  });

  it('scale_overview_rollup_mean → "Mean Summary"', () => {
    const table = makeTable({ tableKind: 'scale_overview_rollup_mean' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Mean Summary');
  });

  it('scale_overview_full → "Full Distribution"', () => {
    const table = makeTable({ tableKind: 'scale_overview_full' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Full Distribution');
  });

  it('numeric_overview_mean → "Mean Summary"', () => {
    const table = makeTable({ tableKind: 'numeric_overview_mean' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Mean Summary');
  });

  it('standard_overview → remains blank', () => {
    const table = makeTable({ tableKind: 'standard_overview' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('');
  });

  it('allocation_overview → remains blank', () => {
    const table = makeTable({ tableKind: 'allocation_overview' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('');
  });

  it('standard_item_detail → remains blank', () => {
    const table = makeTable({ tableKind: 'standard_item_detail' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('');
  });

  it('grid_row_detail → remains blank', () => {
    const table = makeTable({ tableKind: 'grid_row_detail' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('');
  });

  it('table with existing non-empty subtitle → not overwritten', () => {
    const table = makeTable({
      tableKind: 'scale_overview_rollup_mean',
      tableSubtitle: 'Custom subtitle from 13d',
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Custom subtitle from 13d');
  });

  it('maxdiff_api → "Anchored Probability Index"', () => {
    const table = makeTable({ tableKind: 'maxdiff_api' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Anchored Probability Index');
  });
});

// =============================================================================
// userNote Tests
// =============================================================================

describe('13e userNote', () => {
  it('ranking question → "Ranked top K of N items"', () => {
    const table = makeTable();
    const entry = makeEntry({
      analyticalSubtype: 'ranking',
      rankingDetail: { K: 4, N: 8, pattern: '1-4 of 8', source: 'sum-constraint' },
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('Ranked top 4 of 8 items');
  });

  it('binary_flag → "Multiple answers accepted"', () => {
    const table = makeTable();
    const entry = makeEntry({ normalizedType: 'binary_flag' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('Multiple answers accepted');
  });

  it('scale with anchors → "Scale: 1 = ... to 5 = ..."', () => {
    const table = makeTable();
    const entry = makeEntry({
      analyticalSubtype: 'scale',
      items: [
        {
          column: 'Q1_1',
          label: 'Attribute A',
          normalizedType: 'ordinal',
          itemBase: 200,
          scaleLabels: [
            { value: 1, label: 'Not at all likely' },
            { value: 2, label: 'Not very likely' },
            { value: 3, label: 'Somewhat likely' },
            { value: 4, label: 'Very likely' },
            { value: 5, label: 'Extremely likely' },
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

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe(
      'Scale: 1 = Not at all likely to 5 = Extremely likely',
    );
  });

  it('scale with non-substantive tail codes → excludes DK/Refused from anchor', () => {
    const table = makeTable();
    const entry = makeEntry({
      analyticalSubtype: 'scale',
      items: [
        {
          column: 'Q1_1',
          label: 'Attribute A',
          normalizedType: 'ordinal',
          itemBase: 200,
          scaleLabels: [
            { value: 1, label: 'Extremely negative' },
            { value: 2, label: 'Somewhat negative' },
            { value: 3, label: 'Neutral' },
            { value: 4, label: 'Somewhat positive' },
            { value: 5, label: 'Positive' },
            { value: 6, label: 'Very positive' },
            { value: 7, label: 'Extremely positive' },
            { value: 98, label: "Don't Know" },
            { value: 99, label: 'Not applicable' },
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

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    // Should show 1-7 scale, NOT "1 = Extremely negative to 99 = Not applicable"
    expect(result.tables[0].userNote).toBe(
      'Scale: 1 = Extremely negative to 7 = Extremely positive',
    );
  });

  it('allocation with sum constraint → "Allocations sum to 100%"', () => {
    const table = makeTable();
    const entry = makeEntry({
      analyticalSubtype: 'allocation',
      sumConstraint: {
        detected: true,
        constraintValue: 100,
        constraintAxis: 'down-rows',
        confidence: 0.95,
      },
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('Allocations sum to 100%');
  });

  it('stacking: ranking + variable bases → two notes joined by "; "', () => {
    const table = makeTable({
      baseDisclosure: {
        referenceBaseN: 200,
        itemBaseRange: [160, 200],
        defaultBaseText: 'Total respondents',
        defaultNoteTokens: ['anchor-base-varies-by-item', 'anchor-base-range'],
        rangeDisclosure: { min: 160, max: 200 },
        source: 'contract',
      },
    });
    const entry = makeEntry({
      analyticalSubtype: 'ranking',
      rankingDetail: { K: 3, N: 10, pattern: '1-3 of 10', source: 'observed-range' },
      hasVariableItemBases: true,
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe(
      'Ranked top 3 of 10 items; Base varies by item (n=160-200)',
    );
  });

  it('cap at 3 notes max', () => {
    const table = makeTable({ basePolicy: 'total_base_rebased' });
    const entry = makeEntry({
      analyticalSubtype: 'ranking',
      normalizedType: 'binary_flag',
      rankingDetail: { K: 2, N: 6, pattern: '1-2 of 6', source: 'sum-constraint' },
      hasVariableItemBases: true,
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    // ranking (1) + binary_flag (2) + rebased (3) — variable bases should be capped
    const notes = result.tables[0].userNote.split('; ');
    expect(notes).toHaveLength(3);
    expect(notes[0]).toBe('Ranked top 2 of 6 items');
    expect(notes[1]).toBe('Multiple answers accepted');
    expect(notes[2]).toBe('Rebased to exclude non-substantive responses');
  });

  it('table with existing non-empty userNote → not overwritten', () => {
    const table = makeTable({ userNote: 'Pre-existing note' });
    const entry = makeEntry({ normalizedType: 'binary_flag' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('Pre-existing note');
  });

  it('scale with empty items array → no scale anchor note', () => {
    const table = makeTable();
    const entry = makeEntry({
      analyticalSubtype: 'scale',
      items: [],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('');
  });

  it('scale with single scaleLabel entry → no scale anchor note', () => {
    const table = makeTable();
    const entry = makeEntry({
      analyticalSubtype: 'scale',
      items: [
        {
          column: 'Q1_1',
          label: 'Attribute A',
          normalizedType: 'ordinal',
          itemBase: 200,
          scaleLabels: [{ value: 1, label: 'Low' }],
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
        },
      ],
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('');
  });

  it('resolves entry by displayQuestionId when table.questionId is overridden', () => {
    const table = makeTable({
      questionId: 'B500',
      baseText: 'All respondents (n=120)',
      questionBase: 120,
    });
    const entry = makeEntry({
      questionId: 'B500_1',
      displayQuestionId: 'B500',
      normalizedType: 'binary_flag',
      totalN: 120,
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('Multiple answers accepted');
    expect(result.tables[0].baseText).toBe('Total respondents');
  });

  it('prefers table lineage when raw and display-ID candidates both exist', () => {
    const table = makeTable({
      tableId: 'b500_1__standard_overview',
      questionId: 'B500',
      baseText: 'All respondents (n=120)',
      questionBase: 120,
    });
    const parent = makeEntry({
      questionId: 'B500',
      normalizedType: 'categorical',
      totalN: 120,
    });
    const child = makeEntry({
      questionId: 'B500_1',
      displayQuestionId: 'B500',
      normalizedType: 'binary_flag',
      totalN: 120,
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [parent, child],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('Multiple answers accepted');
  });
});

// =============================================================================
// baseText Tests
// =============================================================================

describe('13e baseText', () => {
  it('uses baseDisclosure default text before legacy fallback rules', () => {
    const table = makeTable({
      basePolicy: 'total_base',
      baseText: 'Legacy text that should be ignored',
      questionBase: 200,
      baseDisclosure: {
        referenceBaseN: 150,
        itemBaseRange: [120, 150],
        defaultBaseText: 'Those who were shown Q5',
        defaultNoteTokens: ['anchor-base-varies-by-item', 'anchor-base-range'],
        rangeDisclosure: { min: 120, max: 150 },
        source: 'contract',
      },
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry({ totalN: 200, questionBase: 200, isFiltered: false })],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Those who were shown Q5');
    expect(result.tables[0].userNote).toBe('Base varies by item (n=120-150)');
  });

  it('does not surface anchor range notes on precision views', () => {
    const table = makeTable({
      tableId: 'T002',
      baseViewRole: 'precision',
      userNote: '',
      baseDisclosure: {
        referenceBaseN: 120,
        itemBaseRange: [120, 150],
        defaultBaseText: 'Respondents shown selected item',
        defaultNoteTokens: [],
        rangeDisclosure: null,
        source: 'contract',
      },
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('');
    expect(result.tables[0].baseText).toBe('Respondents shown selected item');
  });

  it('"All respondents (n=177)" with full sample → "Total respondents"', () => {
    const table = makeTable({
      baseText: 'All respondents (n=200)',
      questionBase: 200,
    });
    const entry = makeEntry({ totalN: 200 });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Total respondents');
  });

  it('filtered entry → "Those who were shown {questionId}"', () => {
    const table = makeTable({
      questionId: 'Q5',
      baseText: 'Respondents shown Q5r1 (n=150)',
      questionBase: 150,
      appliesToItem: 'Q5r1',
    });
    const entry = makeEntry({
      questionId: 'Q5',
      isFiltered: true,
      totalN: 200,
      questionBase: 150,
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Those who were shown Q5');
  });

  it('filtered entry without appliesToItem still maps to "Those who were shown {questionId}"', () => {
    const table = makeTable({
      questionId: 'Q6',
      baseText: 'Respondents shown Q6 routing branch (n=140)',
      questionBase: 140,
      appliesToItem: null,
    });
    const entry = makeEntry({
      questionId: 'Q6',
      isFiltered: true,
      totalN: 200,
      questionBase: 140,
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Those who were shown Q6');
  });

  it('resolves family-root questionIds to the representative loop entry', () => {
    const table = makeTable({
      questionId: 'A2',
      familyRoot: 'A2',
      baseText: 'Shown this question',
      questionBase: 200,
    });
    const representative = makeEntry({
      questionId: 'A2_1',
      loopQuestionId: 'A2',
      loop: {
        detected: true,
        familyBase: 'A2',
        iterationIndex: 1,
        iterationCount: 2,
        siblingFamilyBases: ['A2'],
      },
      totalN: 200,
      questionBase: 200,
      isFiltered: false,
    });
    const sibling = makeEntry({
      questionId: 'A2_2',
      loopQuestionId: 'A2',
      loop: {
        detected: true,
        familyBase: 'A2',
        iterationIndex: 2,
        iterationCount: 2,
        siblingFamilyBases: ['A2'],
      },
      totalN: 200,
      questionBase: 90,
      isFiltered: true,
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [representative, sibling],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Total respondents');
  });

  it('"Population cluster (n=varies)" → "Population cluster"', () => {
    const table = makeTable({
      baseText: 'Population cluster (n=varies)',
      basePolicy: 'cluster_base',
      questionBase: 80,
    });
    const entry = makeEntry({ totalN: 200 });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Population cluster');
  });

  it('cluster base is preserved even when questionBase equals totalN', () => {
    const table = makeTable({
      baseText: 'Population cluster (n=200)',
      basePolicy: 'cluster_base',
      questionBase: 200,
    });
    const entry = makeEntry({ totalN: 200 });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Population cluster');
  });

  it('rebased text → strips (n=XXX) but keeps description', () => {
    const table = makeTable({
      baseText: 'Total respondents',
      basePolicy: 'total_base_rebased',
      questionBase: 180,
    });
    const entry = makeEntry({ totalN: 200 });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Total respondents');
    expect(result.tables[0].userNote).toBe('Rebased to exclude non-substantive responses');
  });

  it('orders varying-base note before rebased note when both apply', () => {
    const table = makeTable({
      baseDisclosure: {
        referenceBaseN: 150,
        itemBaseRange: [110, 150],
        defaultBaseText: 'Those who were shown Q5',
        defaultNoteTokens: [
          'anchor-base-varies-by-item',
          'anchor-base-range',
          'rebased-exclusion',
        ],
        excludedResponseLabels: ["Don't Know"],
        rangeDisclosure: { min: 110, max: 150 },
        source: 'contract',
      },
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe(
      'Base varies by item (n=110-150); Rebased to exclude "Don\'t Know" from base',
    );
  });

  it('renders explicit excluded response labels when provided by base disclosure', () => {
    const table = makeTable({
      baseDisclosure: {
        referenceBaseN: 177,
        itemBaseRange: [177, 177],
        defaultBaseText: 'Total respondents',
        defaultNoteTokens: ['rebased-exclusion'],
        excludedResponseLabels: ["Don't Know", 'Not applicable'],
        rangeDisclosure: null,
        source: 'contract',
      },
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe(
      'Rebased to exclude "Don\'t Know" and "Not applicable" from base',
    );
  });

  it('strips (n=XXX) from arbitrary patterns', () => {
    const table = makeTable({
      baseText: 'Some custom base (n=42)',
      questionBase: 42,
    });
    const entry = makeEntry({ totalN: 200 });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    // questionBase (42) !== totalN (200), not filtered, not rebased, not cluster
    expect(result.tables[0].baseText).toBe('Some custom base');
  });

  it('strips (n=0) suffix', () => {
    const table = makeTable({
      baseText: 'Zero-base segment (n=0)',
      questionBase: 0,
    });
    const entry = makeEntry({ totalN: 200 });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Zero-base segment');
  });

  it('does not strip (n=...) when it appears in the middle of the text', () => {
    const table = makeTable({
      baseText: 'Segment (n=120) shown in region',
      questionBase: 120,
    });
    const entry = makeEntry({ totalN: 200 });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    expect(result.tables[0].baseText).toBe('Segment (n=120) shown in region');
  });
});

// =============================================================================
// lastModifiedBy tracking
// =============================================================================

describe('13e lastModifiedBy', () => {
  it('sets lastModifiedBy to "TableMetadataPrefill" on modified tables', () => {
    const table = makeTable({ tableKind: 'scale_overview_rollup_mean' });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry()],
      metadata: METADATA,
    });

    expect(result.tables[0].lastModifiedBy).toBe('TableMetadataPrefill');
  });

  it('preserves original lastModifiedBy when nothing changes', () => {
    // standard_overview + no notes + base matches totalN → only baseText changes
    // Actually standard_overview with questionBase === totalN will modify baseText
    // So let's construct a truly no-op case
    const table = makeTable({
      tableKind: 'standard_overview',
      baseText: 'Total respondents',
      questionBase: 200,
      lastModifiedBy: 'CanonicalAssembler',
    });
    const entry = makeEntry({ totalN: 200 });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [entry],
      metadata: METADATA,
    });

    // baseText already says "Total respondents" and refineBaseText will produce same
    expect(result.tables[0].lastModifiedBy).toBe('CanonicalAssembler');
  });
});

// =============================================================================
// Integration-style: multiple tables
// =============================================================================

describe('13e multiple tables', () => {
  it('processes each table independently', () => {
    const tables = [
      makeTable({
        tableId: 'T001',
        questionId: 'Q1',
        tableKind: 'scale_overview_rollup_t2b',
        rows: [
          makeRow({
            rollupConfig: { scalePoints: 5, boxPosition: 'top', boxWidth: 2, defaultLabel: 'T2B' },
          }),
        ],
      }),
      makeTable({
        tableId: 'T002',
        questionId: 'Q2',
        tableKind: 'standard_overview',
      }),
    ];

    const entries = [
      makeEntry({ questionId: 'Q1' }),
      makeEntry({ questionId: 'Q2', normalizedType: 'binary_flag' }),
    ];

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput(tables),
      entries,
      metadata: METADATA,
    });

    expect(result.tables[0].tableSubtitle).toBe('Top 2 Box Summary');
    expect(result.tables[1].tableSubtitle).toBe('');
    expect(result.tables[1].userNote).toBe('Multiple answers accepted');
  });

  it('applies same note to multiple tables sharing a questionId', () => {
    const tables = [
      makeTable({ tableId: 'T001', questionId: 'Q3' }),
      makeTable({ tableId: 'T002', questionId: 'Q3', tableKind: 'standard_item_detail' }),
    ];
    const entries = [
      makeEntry({ questionId: 'Q3', normalizedType: 'binary_flag' }),
    ];

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput(tables),
      entries,
      metadata: METADATA,
    });

    expect(result.tables[0].userNote).toBe('Multiple answers accepted');
    expect(result.tables[1].userNote).toBe('Multiple answers accepted');
  });

  it('orphaned table with no matching entry passes through without error', () => {
    const table = makeTable({
      questionId: 'Q_ORPHAN',
      baseText: 'All respondents (n=80)',
      tableKind: 'standard_overview',
    });

    const result = runTableMetadataPrefill({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry({ questionId: 'Q_OTHER' })],
      metadata: METADATA,
    });

    // No entry match: no userNote enrichment, but deterministic baseText cleanup still runs.
    expect(result.tables[0].userNote).toBe('');
    expect(result.tables[0].baseText).toBe('All respondents');
  });
});
