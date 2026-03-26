/**
 * Unit tests for Stage 13e — Table Context Triage
 *
 * Tests the deterministic triage logic that flags canonical tables for AI review.
 * Each signal is tested individually, then combinations and edge cases.
 */

import { describe, it, expect } from 'vitest';
import {
  runTableContextTriage,
  buildEntryResolutionLookups,
  computeNormalizedDivergence,
  resolveTableEntryContext,
  stripSpssArtifacts,
  LABEL_DIVERGENCE_THRESHOLD,
  type TableTriageInput,
  type TableTriageSignal,
} from '../triage';
import { buildEntryBaseContract, projectTableBaseContract } from '../../baseContract';
import type {
  CanonicalTableOutput,
  CanonicalTable,
  CanonicalRow,
  QuestionIdEntry,
  SurveyMetadata,
  QuestionDiagnostic,
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
    baseText: 'Total respondents',
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
    lastModifiedBy: 'TableMetadataPrefill',
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

function makeCanonicalOutput(tables: CanonicalTable[]): CanonicalTableOutput {
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
  dataset: 'test',
  generatedAt: '2026-03-17T00:00:00Z',
  scriptVersion: '1.0',
  isMessageTestingSurvey: false,
  hasMaxDiff: false,
  isDemandSurvey: false,
} as unknown as SurveyMetadata;

function runTriage(overrides: Partial<TableTriageInput> = {}): ReturnType<typeof runTableContextTriage> {
  return runTableContextTriage({
    canonicalOutput: overrides.canonicalOutput ?? makeCanonicalOutput([makeTable()]),
    entries: overrides.entries ?? [makeEntry()],
    metadata: overrides.metadata ?? METADATA,
    questionDiagnostics: overrides.questionDiagnostics,
  });
}

/** Extract signal names from a decision. */
function getSignals(result: ReturnType<typeof runTableContextTriage>, tableId = 'T001'): TableTriageSignal[] {
  const decision = result.decisions.find(d => d.tableId === tableId);
  return decision?.reasons.map(r => r.signal) ?? [];
}

describe('triage: loop family-root resolution', () => {
  it('resolves family-root questionIds to the representative loop entry', () => {
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
    });
    const table = makeTable({
      questionId: 'A2',
      familyRoot: 'A2',
    });

    const resolved = resolveTableEntryContext(
      table,
      buildEntryResolutionLookups([representative, sibling]),
    );

    expect(resolved.entry?.questionId).toBe('A2_1');
    expect(resolved.candidateQuestionIds).toEqual(expect.arrayContaining(['A2', 'A2_1']));
  });
});

// =============================================================================
// Signal 1: filtered-base
// =============================================================================

describe('triage: filtered-base', () => {
  it('flags table when plannerBaseSignals includes filtered-base', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionBase: 150, plannerBaseSignals: ['filtered-base'] }),
      ]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(getSignals(result)).toContain('filtered-base');
    expect(result.decisions[0].flagged).toBe(true);
  });

  it('flags table when baseContract signals include filtered-base', () => {
    const table = makeTable({ questionBase: 150 });
    table.baseContract = { ...table.baseContract, signals: ['filtered-base'] };
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(getSignals(result)).toContain('filtered-base');
  });

  it('does NOT flag when no filtered-base signal present even if questionBase < totalN', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionBase: 150 }),
      ]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(getSignals(result)).not.toContain('filtered-base');
  });

  it('does NOT flag when questionBase === totalN', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionBase: 200 }),
      ]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(getSignals(result)).not.toContain('filtered-base');
  });

  it('does NOT flag when questionBase > totalN (edge case)', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionBase: 250 }),
      ]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(getSignals(result)).not.toContain('filtered-base');
  });

  it('does NOT flag when questionBase is null and no signal present', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionBase: null }),
      ]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(getSignals(result)).not.toContain('filtered-base');
  });

  it('flags when plannerBaseSignals includes filtered-base even with null bases', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionBase: null, itemBase: 90, plannerBaseSignals: ['filtered-base'] }),
      ]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(getSignals(result)).toContain('filtered-base');
  });

  it('does NOT flag when no signal present even if totalN is null', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionBase: 150 }),
      ]),
      entries: [makeEntry({ totalN: null })],
    });

    expect(getSignals(result)).not.toContain('filtered-base');
  });

  it('includes base sizes in the detail message when signal present', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionBase: 120, plannerBaseSignals: ['filtered-base'] }),
      ]),
      entries: [makeEntry({ totalN: 300 })],
    });

    const reason = result.decisions[0].reasons.find(r => r.signal === 'filtered-base');
    expect(reason).toBeDefined();
    expect(reason?.detail).toContain('120');
  });
});

// =============================================================================
// Signal 2: grid-structure
// =============================================================================

describe('triage: grid-structure', () => {
  it('flags grid_row_detail tables', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableKind: 'grid_row_detail' }),
      ]),
    });

    expect(getSignals(result)).toContain('grid-structure');
    expect(result.decisions[0].flagged).toBe(true);
  });

  it('flags grid_col_detail tables', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableKind: 'grid_col_detail' }),
      ]),
    });

    expect(getSignals(result)).toContain('grid-structure');
  });

  it('does NOT flag standard_overview tables', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableKind: 'standard_overview' }),
      ]),
    });

    expect(getSignals(result)).not.toContain('grid-structure');
  });

  it('does NOT flag scale tables', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableKind: 'scale_overview_full' }),
      ]),
    });

    expect(getSignals(result)).not.toContain('grid-structure');
  });
});

// =============================================================================
// Signal 3: conceptual-grid
// =============================================================================

describe('triage: conceptual-grid', () => {
  it('flags table when diagnostic has gridDims ending in *', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionId: 'Q5' }),
      ]),
      entries: [makeEntry({ questionId: 'Q5' })],
      questionDiagnostics: [
        {
          dataset: 'test',
          questionId: 'Q5',
          analyticalSubtype: 'standard',
          normalizedType: 'categorical',
          itemCount: 12,
          tableCount: 3,
          splitReason: null,
          genuineSplit: false,
          clusterRouting: null,
          isHidden: false,
          isLoop: false,
          loopQuestionId: null,
          tableKinds: { grid_row_detail: 3 },
          suppressed: false,
          suppressionCode: null,
          suppressedWouldHaveTableCount: null,
          gridDims: '3x4*',
          maxValueCount: null,
        } satisfies QuestionDiagnostic,
      ],
    });

    expect(getSignals(result)).toContain('conceptual-grid');
    expect(result.decisions[0].flagged).toBe(true);
  });

  it('does NOT flag when gridDims does not end in *', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionId: 'Q5' }),
      ]),
      entries: [makeEntry({ questionId: 'Q5' })],
      questionDiagnostics: [
        {
          dataset: 'test',
          questionId: 'Q5',
          analyticalSubtype: 'standard',
          normalizedType: 'categorical',
          itemCount: 12,
          tableCount: 3,
          splitReason: null,
          genuineSplit: false,
          clusterRouting: null,
          isHidden: false,
          isLoop: false,
          loopQuestionId: null,
          tableKinds: { grid_row_detail: 3 },
          suppressed: false,
          suppressionCode: null,
          suppressedWouldHaveTableCount: null,
          gridDims: '3x4',
          maxValueCount: null,
        } satisfies QuestionDiagnostic,
      ],
    });

    expect(getSignals(result)).not.toContain('conceptual-grid');
  });

  it('does NOT flag when no diagnostic exists', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionId: 'Q5' }),
      ]),
      entries: [makeEntry({ questionId: 'Q5' })],
      questionDiagnostics: [],
    });

    expect(getSignals(result)).not.toContain('conceptual-grid');
  });

  it('does NOT flag when gridDims is null', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionId: 'Q5' }),
      ]),
      entries: [makeEntry({ questionId: 'Q5' })],
      questionDiagnostics: [
        {
          dataset: 'test',
          questionId: 'Q5',
          analyticalSubtype: 'standard',
          normalizedType: 'categorical',
          itemCount: 4,
          tableCount: 1,
          splitReason: null,
          genuineSplit: false,
          clusterRouting: null,
          isHidden: false,
          isLoop: false,
          loopQuestionId: null,
          tableKinds: { standard_overview: 1 },
          suppressed: false,
          suppressionCode: null,
          suppressedWouldHaveTableCount: null,
          gridDims: null,
          maxValueCount: null,
        } satisfies QuestionDiagnostic,
      ],
    });

    expect(getSignals(result)).not.toContain('conceptual-grid');
  });

  it('flags conceptual-grid when table.questionId is displayQuestionId', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          questionId: 'B500',
          tableId: 'b500_1__grid_row_detail',
        }),
      ]),
      entries: [
        makeEntry({
          questionId: 'B500_1',
          displayQuestionId: 'B500',
        }),
      ],
      questionDiagnostics: [
        {
          dataset: 'test',
          questionId: 'B500_1',
          analyticalSubtype: 'standard',
          normalizedType: 'categorical',
          itemCount: 9,
          tableCount: 3,
          splitReason: null,
          genuineSplit: false,
          clusterRouting: null,
          isHidden: false,
          isLoop: false,
          loopQuestionId: null,
          tableKinds: { grid_row_detail: 3 },
          suppressed: false,
          suppressionCode: null,
          suppressedWouldHaveTableCount: null,
          gridDims: '3x3*',
          maxValueCount: null,
        } satisfies QuestionDiagnostic,
      ],
    });

    expect(getSignals(result, 'b500_1__grid_row_detail')).toContain('conceptual-grid');
  });
});

// =============================================================================
// Signal 4: label-divergence
// =============================================================================

describe('triage: label-divergence', () => {
  it('flags when savLabel and surveyLabel differ significantly', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          items: [
            {
              column: 'Q1_1',
              label: 'Completely satisfied',
              savLabel: 'Very happy with the product',
              surveyLabel: 'Completely satisfied with experience',
              normalizedType: 'categorical',
              itemBase: 200,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    expect(getSignals(result)).toContain('label-divergence');
    expect(result.decisions[0].flagged).toBe(true);
  });

  it('does NOT flag when labels are identical', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          items: [
            {
              column: 'Q1_1',
              label: 'Option A',
              savLabel: 'Option A',
              surveyLabel: 'Option A',
              normalizedType: 'categorical',
              itemBase: 200,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    expect(getSignals(result)).not.toContain('label-divergence');
  });

  it('does NOT flag when only savLabel is present (no surveyLabel)', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          items: [
            {
              column: 'Q1_1',
              label: 'Option A',
              savLabel: 'Option A from sav',
              normalizedType: 'categorical',
              itemBase: 200,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    expect(getSignals(result)).not.toContain('label-divergence');
  });

  it('does NOT flag minor differences below threshold', () => {
    // "Option A" vs "Option a" — Levenshtein 1, maxLen 8, ratio 0.125 < 0.3
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          items: [
            {
              column: 'Q1_1',
              label: 'Option A',
              savLabel: 'Option A',
              surveyLabel: 'Option a',
              normalizedType: 'categorical',
              itemBase: 200,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    expect(getSignals(result)).not.toContain('label-divergence');
  });

  it('flags with severity high when 3+ items diverge', () => {
    const divergentItems = Array.from({ length: 4 }, (_, i) => ({
      column: `Q1_${i + 1}`,
      label: `Completely different label ${i}`,
      savLabel: `Original SPSS label for item number ${i}`,
      surveyLabel: `Survey parsed text is very different ${i}`,
      normalizedType: 'categorical',
      itemBase: 200,
      messageCode: null,
      messageText: null,
      altCode: null,
      altText: null,
      matchMethod: null as null,
      matchConfidence: 0,
    }));

    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry({ items: divergentItems })],
    });

    const reason = result.decisions[0].reasons.find(r => r.signal === 'label-divergence');
    expect(reason).toBeDefined();
    expect(reason!.severity).toBe('high');
  });

  it('flags with severity medium when fewer than 3 items diverge', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          items: [
            {
              column: 'Q1_1',
              label: 'Divergent label',
              savLabel: 'Original SPSS label for item',
              surveyLabel: 'Survey parsed text is very different',
              normalizedType: 'categorical',
              itemBase: 200,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    const reason = result.decisions[0].reasons.find(r => r.signal === 'label-divergence');
    expect(reason).toBeDefined();
    expect(reason!.severity).toBe('medium');
  });

  it('does NOT flag when entry has no items', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry({ items: [] })],
    });

    expect(getSignals(result)).not.toContain('label-divergence');
  });

  it('flags when scaleLabels have significant sav vs survey divergence', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          items: [
            {
              column: 'Q1_1',
              label: 'Satisfaction',
              savLabel: 'Satisfaction',
              surveyLabel: 'Satisfaction',
              normalizedType: 'categorical',
              itemBase: 200,
              scaleLabels: [
                {
                  value: 1,
                  label: 'Somewhat dissatisfied',
                  savLabel: 'Strongly disagree',
                  surveyLabel: 'Extremely likely to recommend',
                },
              ],
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    expect(getSignals(result)).toContain('label-divergence');
  });

  it('threshold constant is 0.3', () => {
    expect(LABEL_DIVERGENCE_THRESHOLD).toBe(0.3);
  });

  it('does NOT flag SPSS question-text concatenation (VarName: ItemLabel - QuestionText)', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          questionText: 'Thinking of your patients, what percent typically need this?',
          items: [
            {
              column: 'Q1_1',
              label: 'Aware prior to initiating series',
              savLabel: 'Q1r1: Aware prior to initiating series - Thinking of your patients, what percent typically need this?',
              surveyLabel: 'Aware prior to initiating series',
              normalizedType: 'categorical',
              itemBase: 200,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    expect(getSignals(result)).not.toContain('label-divergence');
  });

  it('DOES flag genuine divergence even when variable prefix is stripped', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          questionText: 'How would you allocate your next patients?',
          items: [
            {
              column: 'Q1_1',
              label: 'Treatment A',
              savLabel: 'Q1r1: Treatment A - Original Allocation',
              surveyLabel: 'Treatment A (generic name)',
              normalizedType: 'categorical',
              itemBase: 200,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    // "Treatment A - Original Allocation" vs "Treatment A (generic name)" — genuine divergence
    expect(getSignals(result)).toContain('label-divergence');
  });

  it('DOES flag grid column context like "Without a statin - Drug"', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [
        makeEntry({
          questionText: 'How would you treat these patients?',
          items: [
            {
              column: 'Q1_1',
              label: 'Drug A',
              savLabel: 'Without a statin - Drug A (generic)',
              surveyLabel: 'Drug A (generic)',
              normalizedType: 'categorical',
              itemBase: 200,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    // "Without a statin" is NOT the question text — it's programmer-added grid context
    expect(getSignals(result)).toContain('label-divergence');
  });
});

// =============================================================================
// stripSpssArtifacts unit tests
// =============================================================================

describe('stripSpssArtifacts', () => {
  it('strips variable name prefix', () => {
    expect(stripSpssArtifacts('A6r4: Start statin first')).toBe('Start statin first');
  });

  it('strips variable name prefix with underscores', () => {
    expect(stripSpssArtifacts('S14r15c1: Some label text')).toBe('Some label text');
  });

  it('strips question text suffix when questionText provided', () => {
    const result = stripSpssArtifacts(
      'A6r4: Start statin first - Again, please assume that the FDA decides all PCSK9 inhibitors will be indicated',
      'Again, please assume that the FDA decides all PCSK9 inhibitors will be indicated for use',
    );
    expect(result).toBe('Start statin first');
  });

  it('preserves label when no SPSS artifacts present', () => {
    expect(stripSpssArtifacts('Just a plain label')).toBe('Just a plain label');
  });

  it('preserves grid context prefix (not question text)', () => {
    const result = stripSpssArtifacts(
      'Without a statin - Drug A (generic)',
      'How would you treat these patients?',
    );
    // "Without a statin" is NOT the question text, so it stays
    expect(result).toBe('Without a statin - Drug A (generic)');
  });

  it('does not strip when questionText is not found after separator', () => {
    const result = stripSpssArtifacts(
      'Original Allocation - Drug A',
      'Totally different question text here',
    );
    expect(result).toBe('Original Allocation - Drug A');
  });

  it('handles empty questionText gracefully', () => {
    expect(stripSpssArtifacts('Q1: Some label', '')).toBe('Some label');
  });

  it('handles no questionText argument', () => {
    expect(stripSpssArtifacts('Q1: Some label')).toBe('Some label');
  });
});

// =============================================================================
// computeNormalizedDivergence unit tests
// =============================================================================

describe('computeNormalizedDivergence', () => {
  it('returns null when both labels missing', () => {
    expect(computeNormalizedDivergence(undefined, undefined)).toBeNull();
  });

  it('returns null when one label missing', () => {
    expect(computeNormalizedDivergence('hello', undefined)).toBeNull();
    expect(computeNormalizedDivergence(undefined, 'hello')).toBeNull();
  });

  it('returns 0 when labels are identical', () => {
    expect(computeNormalizedDivergence('Same text', 'Same text')).toBe(0);
  });

  it('returns 0 after SPSS stripping makes labels match', () => {
    const result = computeNormalizedDivergence(
      'Q1r1: Aware of issue - What percent of your patients need this?',
      'Aware of issue',
      'What percent of your patients need this?',
    );
    expect(result).toBe(0);
  });

  it('returns positive divergence for genuinely different labels', () => {
    const result = computeNormalizedDivergence(
      'Product A - Original Allocation',
      'Product A (generic name)',
    );
    expect(result).not.toBeNull();
    expect(result!).toBeGreaterThan(0);
  });
});

// =============================================================================
// Signal 5: rebased-base
// =============================================================================

describe('triage: rebased-base', () => {
  it('flags table with rebased base policy', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ basePolicy: 'total_base_rebased' }),
      ]),
    });

    expect(getSignals(result)).toContain('rebased-base');
    expect(result.decisions[0].flagged).toBe(true);
  });

  it('flags table with item_base_rebased', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ basePolicy: 'item_base_rebased' }),
      ]),
    });

    expect(getSignals(result)).toContain('rebased-base');
  });

  it('does NOT flag table with plain total_base', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ basePolicy: 'total_base' }),
      ]),
    });

    expect(getSignals(result)).not.toContain('rebased-base');
  });
});

// =============================================================================
// Excluded tables
// =============================================================================

describe('triage: excluded tables', () => {
  it('skips excluded tables entirely', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ exclude: true, questionBase: 50 }),
      ]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(result.decisions).toHaveLength(0);
    expect(result.summary.totalTables).toBe(0);
  });
});

// =============================================================================
// Multiple signals on same table
// =============================================================================

describe('triage: signal combinations', () => {
  it('accumulates multiple signals on a single table', () => {
    const table = makeTable({
      questionId: 'Q3',
      tableKind: 'grid_row_detail',
      questionBase: 100,
      basePolicy: 'total_base_rebased',
      plannerBaseSignals: ['filtered-base', 'rebased-base'],
    });
    table.baseContract = {
      ...table.baseContract,
      policy: { ...table.baseContract.policy, rebasePolicy: 'exclude_non_substantive_tail' },
    };

    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([table]),
      entries: [
        makeEntry({
          questionId: 'Q3',
          totalN: 200,
          items: [
            {
              column: 'Q3_1',
              label: 'Row item',
              savLabel: 'Original SPSS label for the row',
              surveyLabel: 'Completely different survey text here',
              normalizedType: 'categorical',
              itemBase: 100,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    const signals = getSignals(result);
    expect(signals).toContain('filtered-base');
    expect(signals).toContain('grid-structure');
    expect(signals).toContain('label-divergence');
    expect(signals).toContain('rebased-base');
    expect(result.decisions[0].reasons.length).toBeGreaterThanOrEqual(4);
  });
});

// =============================================================================
// Clean tables — no flags
// =============================================================================

describe('triage: clean table (no flags)', () => {
  it('returns flagged=false for a clean standard overview table', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableKind: 'standard_overview',
          questionBase: 200,
          basePolicy: 'total_base',
        }),
      ]),
      entries: [makeEntry({ totalN: 200, items: [] })],
    });

    expect(result.decisions[0].flagged).toBe(false);
    expect(result.decisions[0].reasons).toHaveLength(0);
  });

  it('preserves structural base signals without flagging AI review', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          plannerBaseSignals: ['varying-item-bases', 'low-base'],
        }),
      ]),
      entries: [makeEntry({ totalN: 200, items: [] })],
    });

    expect(result.decisions[0].flagged).toBe(false);
    expect(result.decisions[0].reasons).toEqual([]);
    expect(result.decisions[0].presentationReasons).toEqual([]);
    expect(result.decisions[0].structuralBaseSignals).toEqual(['varying-item-bases', 'low-base']);
  });

  it('preserves compute-risk signals without flagging AI review', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          computeRiskSignals: ['compute-mask-required', 'row-base-varies-within-anchor-view'],
        }),
      ]),
      entries: [makeEntry({ totalN: 200, items: [] })],
    });

    expect(result.decisions[0].flagged).toBe(false);
    expect(result.decisions[0].computeRiskSignals).toEqual([
      'compute-mask-required',
      'row-base-varies-within-anchor-view',
    ]);
  });
});

// =============================================================================
// Summary statistics
// =============================================================================

describe('triage: summary', () => {
  it('counts flagged and skipped tables correctly', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableId: 'T001', questionId: 'Q1', questionBase: 200 }),
        makeTable({ tableId: 'T002', questionId: 'Q2', questionBase: 100, tableKind: 'grid_row_detail' }),
        makeTable({ tableId: 'T003', questionId: 'Q3', questionBase: 200 }),
      ]),
      entries: [
        makeEntry({ questionId: 'Q1', totalN: 200 }),
        makeEntry({ questionId: 'Q2', totalN: 200 }),
        makeEntry({ questionId: 'Q3', totalN: 200 }),
      ],
    });

    expect(result.summary.totalTables).toBe(3);
    expect(result.summary.flaggedTables).toBe(1); // T002 has grid + filtered-base
    expect(result.summary.skippedTables).toBe(2);
  });

  it('tracks counts by signal', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableId: 'T001', questionId: 'Q1', tableKind: 'grid_row_detail', plannerBaseSignals: ['filtered-base'] }),
        makeTable({ tableId: 'T002', questionId: 'Q2', tableKind: 'grid_col_detail' }),
      ]),
      entries: [
        makeEntry({ questionId: 'Q1', totalN: 200 }),
        makeEntry({ questionId: 'Q2', totalN: 200 }),
      ],
    });

    expect(result.summary.bySignal['grid-structure']).toBe(2);
    expect(result.summary.bySignal['filtered-base']).toBe(1);
  });

  it('tracks structural and compute-risk summary counts separately', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'T001',
          plannerBaseSignals: ['low-base', 'varying-item-bases'],
          computeRiskSignals: ['compute-mask-required'],
        }),
      ]),
      entries: [makeEntry({ totalN: 200 })],
    });

    expect(result.summary.byStructuralBaseSignal['low-base']).toBe(1);
    expect(result.summary.byStructuralBaseSignal['varying-item-bases']).toBe(1);
    expect(result.summary.byComputeRiskSignal['compute-mask-required']).toBe(1);
  });
});

// =============================================================================
// Entry resolution
// =============================================================================

describe('triage: entry resolution', () => {
  it('resolves entry by displayQuestionId for label-divergence detection', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionId: 'B500', questionBase: 100 }),
      ]),
      entries: [
        makeEntry({
          questionId: 'B500_1',
          displayQuestionId: 'B500',
          totalN: 200,
          items: [
            {
              column: 'B500_1',
              label: 'Item',
              savLabel: 'Original SPSS label for this item row',
              surveyLabel: 'Completely different survey text here',
              normalizedType: 'categorical',
              itemBase: 100,
              messageCode: null,
              messageText: null,
              altCode: null,
              altText: null,
              matchMethod: null,
              matchConfidence: 0,
            },
          ],
        }),
      ],
    });

    // Should resolve via displayQuestionId and detect label-divergence
    expect(getSignals(result)).toContain('label-divergence');
  });

  it('prefers table lineage when multiple displayQuestionId candidates exist', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'b500_2__standard_overview',
          questionId: 'B500',
          questionBase: 70,
          plannerBaseSignals: ['filtered-base'],
        }),
      ]),
      entries: [
        makeEntry({
          questionId: 'B500_1',
          displayQuestionId: 'B500',
          totalN: 200,
          items: [],
        }),
        makeEntry({
          questionId: 'B500_2',
          displayQuestionId: 'B500',
          totalN: 80,
          items: [],
        }),
      ],
    });

    // Planner signal should trigger filtered-base regardless of entry resolution
    expect(getSignals(result, 'b500_2__standard_overview')).toContain('filtered-base');
  });

  it('handles orphaned table with no matching entry gracefully', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ questionId: 'Q_ORPHAN', questionBase: 100 }),
      ]),
      entries: [makeEntry({ questionId: 'Q_OTHER' })],
    });

    // Should not crash — just won't trigger entry-dependent signals
    expect(result.decisions[0].flagged).toBe(false);
  });
});

// =============================================================================
// Signal 7: stimuli-set-slice
// =============================================================================

describe('triage: stimuli-set-slice', () => {
  it('flags table with stimuliSetSlice metadata', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
        }),
      ]),
    });

    expect(getSignals(result)).toContain('stimuli-set-slice');
    expect(result.decisions[0].flagged).toBe(true);
    const reason = result.decisions[0].reasons.find(r => r.signal === 'stimuli-set-slice');
    expect(reason?.severity).toBe('medium');
    expect(reason?.detail).toContain('Set 1');
    expect(reason?.detail).toContain('B500');
  });

  it('includes binarySide in detail when present', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
          binarySide: 'selected',
        }),
      ]),
    });

    const reason = result.decisions[0].reasons.find(r => r.signal === 'stimuli-set-slice');
    expect(reason?.detail).toContain('selected view');
  });

  it('does NOT include binarySide label when binarySide is null', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
          binarySide: null,
        }),
      ]),
    });

    const reason = result.decisions[0].reasons.find(r => r.signal === 'stimuli-set-slice');
    expect(reason?.detail).not.toContain('view');
  });

  it('does NOT flag table without stimuliSetSlice', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ stimuliSetSlice: null }),
      ]),
    });

    expect(getSignals(result)).not.toContain('stimuli-set-slice');
  });

  it('counts stimuli-set-slice in summary bySignal', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'T001',
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
        }),
        makeTable({
          tableId: 'T002',
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 1,
            setLabel: 'Set 2',
            sourceQuestionId: 'B500',
          },
        }),
      ]),
    });

    expect(result.summary.bySignal['stimuli-set-slice']).toBe(2);
    expect(result.summary.flaggedTables).toBe(2);
  });
});

// =============================================================================
// Signal 8: stimuli-set-ambiguous
// =============================================================================

describe('triage: stimuli-set-ambiguous', () => {
  function makeDiagWithResolution(
    ambiguous: boolean,
    overrides: Partial<QuestionDiagnostic> = {},
  ): QuestionDiagnostic {
    return {
      dataset: 'test',
      questionId: 'Q1',
      analyticalSubtype: 'standard',
      normalizedType: 'categorical',
      itemCount: 6,
      tableCount: 3,
      splitReason: null,
      genuineSplit: false,
      clusterRouting: null,
      isHidden: false,
      isLoop: false,
      loopQuestionId: null,
      tableKinds: { standard_overview: 3 },
      suppressed: false,
      suppressionCode: null,
      suppressedWouldHaveTableCount: null,
      gridDims: null,
      maxValueCount: null,
      stimuliSetResolution: {
        detected: true,
        setCount: 3,
        matchMethod: 'label',
        averageScore: ambiguous ? 1.5 : 3.8,
        ambiguous,
        binarySplitApplied: false,
      },
      ...overrides,
    } satisfies QuestionDiagnostic;
  }

  it('flags table when stimuli set resolution is ambiguous', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
        }),
      ]),
      questionDiagnostics: [makeDiagWithResolution(true)],
    });

    expect(getSignals(result)).toContain('stimuli-set-ambiguous');
    const reason = result.decisions[0].reasons.find(r => r.signal === 'stimuli-set-ambiguous');
    expect(reason?.severity).toBe('high');
    expect(reason?.detail).toContain('ambiguous');
    expect(reason?.detail).toContain('label');
  });

  it('does NOT flag when resolution is not ambiguous', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
        }),
      ]),
      questionDiagnostics: [makeDiagWithResolution(false)],
    });

    expect(getSignals(result)).not.toContain('stimuli-set-ambiguous');
  });

  it('does NOT flag when table has no stimuliSetSlice (even if diagnostic is ambiguous)', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ stimuliSetSlice: null }),
      ]),
      questionDiagnostics: [makeDiagWithResolution(true)],
    });

    expect(getSignals(result)).not.toContain('stimuli-set-ambiguous');
  });

  it('does NOT flag when no diagnostic exists', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
        }),
      ]),
      questionDiagnostics: [],
    });

    expect(getSignals(result)).not.toContain('stimuli-set-ambiguous');
  });

  it('does NOT flag when diagnostic has no stimuliSetResolution', () => {
    const diag = makeDiagWithResolution(true);
    delete (diag as unknown as Record<string, unknown>).stimuliSetResolution;
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
        }),
      ]),
      questionDiagnostics: [diag],
    });

    expect(getSignals(result)).not.toContain('stimuli-set-ambiguous');
  });

  it('both stimuli-set-slice and stimuli-set-ambiguous fire together', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: {
            familySource: 'B500',
            setIndex: 0,
            setLabel: 'Set 1',
            sourceQuestionId: 'B500',
          },
        }),
      ]),
      questionDiagnostics: [makeDiagWithResolution(true)],
    });

    const signals = getSignals(result);
    expect(signals).toContain('stimuli-set-slice');
    expect(signals).toContain('stimuli-set-ambiguous');
  });
});

// =============================================================================
// Signal 9: binary-pair
// =============================================================================

describe('triage: binary-pair', () => {
  const STIMULI_SET_1 = {
    familySource: 'B500',
    setIndex: 0,
    setLabel: 'Set 1',
    sourceQuestionId: 'B500',
  };

  const STIMULI_SET_2 = {
    familySource: 'B500',
    setIndex: 1,
    setLabel: 'Set 2',
    sourceQuestionId: 'B500',
  };

  it('flags both tables when a binary pair exists', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'T_sel',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'T_unsel',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'unselected',
        }),
      ]),
    });

    expect(getSignals(result, 'T_sel')).toContain('binary-pair');
    expect(getSignals(result, 'T_unsel')).toContain('binary-pair');
  });

  it('detail text includes counterpart tableId', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'T_sel',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'T_unsel',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'unselected',
        }),
      ]),
    });

    const selReason = result.decisions.find(d => d.tableId === 'T_sel')
      ?.reasons.find(r => r.signal === 'binary-pair');
    const unselReason = result.decisions.find(d => d.tableId === 'T_unsel')
      ?.reasons.find(r => r.signal === 'binary-pair');

    expect(selReason?.detail).toContain('T_unsel');
    expect(selReason?.detail).toContain('selected view');
    expect(unselReason?.detail).toContain('T_sel');
    expect(unselReason?.detail).toContain('unselected view');
  });

  it('severity is medium', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'T_sel',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'T_unsel',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'unselected',
        }),
      ]),
    });

    const reason = result.decisions.find(d => d.tableId === 'T_sel')
      ?.reasons.find(r => r.signal === 'binary-pair');
    expect(reason?.severity).toBe('medium');
  });

  it('does NOT fire on solo binary tables (no counterpart)', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'T_solo',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'selected',
        }),
      ]),
    });

    expect(getSignals(result, 'T_solo')).not.toContain('binary-pair');
  });

  it('does NOT fire when binarySide is null', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: null,
        }),
      ]),
    });

    expect(getSignals(result)).not.toContain('binary-pair');
  });

  it('correctly matches pairs across multiple sets (no cross-pairing)', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableId: 'S1_sel', stimuliSetSlice: STIMULI_SET_1, binarySide: 'selected' }),
        makeTable({ tableId: 'S1_unsel', stimuliSetSlice: STIMULI_SET_1, binarySide: 'unselected' }),
        makeTable({ tableId: 'S2_sel', stimuliSetSlice: STIMULI_SET_2, binarySide: 'selected' }),
        makeTable({ tableId: 'S2_unsel', stimuliSetSlice: STIMULI_SET_2, binarySide: 'unselected' }),
      ]),
    });

    // Set 1 selected paired with Set 1 unselected
    const s1SelReason = result.decisions.find(d => d.tableId === 'S1_sel')
      ?.reasons.find(r => r.signal === 'binary-pair');
    expect(s1SelReason?.detail).toContain('S1_unsel');

    // Set 2 selected paired with Set 2 unselected
    const s2SelReason = result.decisions.find(d => d.tableId === 'S2_sel')
      ?.reasons.find(r => r.signal === 'binary-pair');
    expect(s2SelReason?.detail).toContain('S2_unsel');

    // No cross-pairing
    expect(s1SelReason?.detail).not.toContain('S2_unsel');
    expect(s2SelReason?.detail).not.toContain('S1_unsel');
  });

  it('does NOT pair across different questionIds', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'A_sel',
          questionId: 'QA',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'B_unsel',
          questionId: 'QB',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'unselected',
        }),
      ]),
      entries: [
        makeEntry({ questionId: 'QA' }),
        makeEntry({ questionId: 'QB' }),
      ],
    });

    expect(getSignals(result, 'A_sel')).not.toContain('binary-pair');
    expect(getSignals(result, 'B_unsel')).not.toContain('binary-pair');
  });

  it('does NOT pair across different familySource', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'X_sel',
          stimuliSetSlice: { ...STIMULI_SET_1, familySource: 'B500' },
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'Y_unsel',
          stimuliSetSlice: { ...STIMULI_SET_1, familySource: 'C600' },
          binarySide: 'unselected',
        }),
      ]),
    });

    expect(getSignals(result, 'X_sel')).not.toContain('binary-pair');
    expect(getSignals(result, 'Y_unsel')).not.toContain('binary-pair');
  });

  it('binary-pair and stimuli-set-slice fire together', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({
          tableId: 'T_sel',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'selected',
        }),
        makeTable({
          tableId: 'T_unsel',
          stimuliSetSlice: STIMULI_SET_1,
          binarySide: 'unselected',
        }),
      ]),
    });

    const signals = getSignals(result, 'T_sel');
    expect(signals).toContain('binary-pair');
    expect(signals).toContain('stimuli-set-slice');
  });

  it('summary counts binary-pair correctly', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableId: 'S1_sel', stimuliSetSlice: STIMULI_SET_1, binarySide: 'selected' }),
        makeTable({ tableId: 'S1_unsel', stimuliSetSlice: STIMULI_SET_1, binarySide: 'unselected' }),
        makeTable({ tableId: 'S2_sel', stimuliSetSlice: STIMULI_SET_2, binarySide: 'selected' }),
        makeTable({ tableId: 'S2_unsel', stimuliSetSlice: STIMULI_SET_2, binarySide: 'unselected' }),
      ]),
    });

    expect(result.summary.bySignal['binary-pair']).toBe(4);
  });
});

// =============================================================================
// Signal 10: borderline-materiality
// =============================================================================

describe('triage: borderline-materiality', () => {
  function makeBorderlineDiag(
    relativeSpread: number | null,
    baseComparability: 'shared' | 'varying_but_acceptable' | 'split_recommended' | 'ambiguous' = 'varying_but_acceptable',
    overrides: Partial<QuestionDiagnostic> = {},
  ): QuestionDiagnostic {
    return {
      dataset: 'test',
      questionId: 'Q1',
      analyticalSubtype: 'standard',
      normalizedType: 'categorical',
      itemCount: 5,
      tableCount: 1,
      splitReason: null,
      genuineSplit: false,
      clusterRouting: null,
      isHidden: false,
      isLoop: false,
      loopQuestionId: null,
      tableKinds: { standard_overview: 1 },
      suppressed: false,
      suppressionCode: null,
      suppressedWouldHaveTableCount: null,
      gridDims: null,
      maxValueCount: null,
      baseComparability,
      relativeSpread,
      ...overrides,
    } satisfies QuestionDiagnostic;
  }

  it('flags table when baseComparability is varying_but_acceptable and relativeSpread is in borderline range', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(0.05)],
    });

    expect(getSignals(result)).toContain('borderline-materiality');
    expect(result.decisions[0].flagged).toBe(true);
  });

  it('flags at lower bound of borderline range (4%)', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(0.04)],
    });

    expect(getSignals(result)).toContain('borderline-materiality');
  });

  it('flags at upper bound of borderline range (6%)', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(0.06)],
    });

    expect(getSignals(result)).toContain('borderline-materiality');
  });

  it('does NOT flag when relativeSpread is below borderline range', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(0.02)],
    });

    expect(getSignals(result)).not.toContain('borderline-materiality');
  });

  it('does NOT flag when relativeSpread is above borderline range', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(0.08)],
    });

    expect(getSignals(result)).not.toContain('borderline-materiality');
  });

  it('does NOT flag when baseComparability is shared', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(0.05, 'shared')],
    });

    expect(getSignals(result)).not.toContain('borderline-materiality');
  });

  it('does NOT flag when baseComparability is split_recommended', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(0.05, 'split_recommended')],
    });

    expect(getSignals(result)).not.toContain('borderline-materiality');
  });

  it('does NOT flag when relativeSpread is null', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(null)],
    });

    expect(getSignals(result)).not.toContain('borderline-materiality');
  });

  it('does NOT flag when no diagnostic exists', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [],
    });

    expect(getSignals(result)).not.toContain('borderline-materiality');
  });

  it('detail message includes the spread percentage', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([makeTable()]),
      entries: [makeEntry()],
      questionDiagnostics: [makeBorderlineDiag(0.045)],
    });

    const decision = result.decisions[0];
    const reason = decision.reasons.find(r => r.signal === 'borderline-materiality');
    expect(reason).toBeDefined();
    expect(reason!.detail).toContain('4.5%');
    expect(reason!.severity).toBe('low');
  });

  it('summary counts borderline-materiality', () => {
    const result = runTriage({
      canonicalOutput: makeCanonicalOutput([
        makeTable({ tableId: 'T1', questionId: 'Q1' }),
        makeTable({ tableId: 'T2', questionId: 'Q1' }),
      ]),
      entries: [makeEntry({ questionId: 'Q1' })],
      questionDiagnostics: [makeBorderlineDiag(0.05)],
    });

    expect(result.summary.bySignal['borderline-materiality']).toBe(2);
  });
});
