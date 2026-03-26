import { describe, it, expect } from 'vitest';
import { runNetTriage } from '../netTriage';
import { buildEntryBaseContract, projectTableBaseContract } from '../../baseContract';
import type { CanonicalTable, CanonicalRow } from '../types';

// ─── Test Helpers ────────────────────────────────────────────────────────────

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
    tableId: 'Q1__standard_overview',
    questionId: 'Q1',
    familyRoot: 'Q1',
    sourceTableId: 'Q1__standard_overview',
    splitFromTableId: '',
    tableKind: 'standard_overview',
    analyticalSubtype: 'standard',
    normalizedType: 'categorical_select',
    tableType: 'frequency',
    questionText: 'Which options do you prefer?',
    rows: [
      makeRow({ variable: 'Q1_1', label: 'Option A', filterValue: '1' }),
      makeRow({ variable: 'Q1_2', label: 'Option B', filterValue: '2' }),
      makeRow({ variable: 'Q1_3', label: 'Option C', filterValue: '3' }),
      makeRow({ variable: 'Q1_4', label: 'Option D', filterValue: '4' }),
      makeRow({ variable: 'Q1_5', label: 'Option E', filterValue: '5' }),
    ],
    statsSpec: null,
    derivationHint: null,
    statTestSpec: null,
    basePolicy: 'total',
    baseSource: 'question',
    questionBase: 500,
    itemBase: null,
    baseContract: projectTableBaseContract(buildEntryBaseContract({
      totalN: 500,
      questionBase: 500,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }), {
      basePolicy: 'total',
      questionBase: 500,
      itemBase: null,
    }),
    baseText: 'Total Respondents',
    isDerived: false,
    sortOrder: 1,
    sortBlock: 'Q1',
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
    lastModifiedBy: 'assembler',
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

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('runNetTriage', () => {
  it('flags a standard_overview with 5+ value rows', () => {
    const result = runNetTriage({
      tables: [makeTable()],
    });
    expect(result.flagged).toHaveLength(1);
    expect(result.skipped).toHaveLength(0);
    expect(result.flagged[0].tableId).toBe('Q1__standard_overview');
    expect(result.flagged[0].rowCount).toBe(5);
  });

  it('skips tables with < 5 value rows', () => {
    const result = runNetTriage({
      tables: [makeTable({
        rows: [
          makeRow({ variable: 'Q1_1' }),
          makeRow({ variable: 'Q1_2' }),
          makeRow({ variable: 'Q1_3' }),
        ],
      })],
    });
    expect(result.flagged).toHaveLength(0);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('only 3 value rows');
  });

  it('skips non-standard_overview tables', () => {
    const result = runNetTriage({
      tables: [makeTable({ tableKind: 'scale_overview_full' })],
    });
    expect(result.flagged).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('not standard_overview');
  });

  it('skips tables with ineligible normalizedType', () => {
    const result = runNetTriage({
      tables: [makeTable({ normalizedType: 'numeric' })],
    });
    expect(result.flagged).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('normalizedType not eligible');
  });

  it('skips tables with excluded analyticalSubtype (scale)', () => {
    const result = runNetTriage({
      tables: [makeTable({ analyticalSubtype: 'scale' })],
    });
    expect(result.flagged).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('excluded analyticalSubtype');
  });

  it('skips tables with excluded analyticalSubtype (ranking)', () => {
    const result = runNetTriage({
      tables: [makeTable({ analyticalSubtype: 'ranking' })],
    });
    expect(result.flagged).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('excluded analyticalSubtype');
  });

  it('skips tables with existing NET rows', () => {
    const result = runNetTriage({
      tables: [makeTable({
        rows: [
          makeRow({ variable: 'Q1_1' }),
          makeRow({ variable: 'Q1_2' }),
          makeRow({ variable: 'Q1_3' }),
          makeRow({ variable: 'Q1_4' }),
          makeRow({ variable: 'Q1_5' }),
          makeRow({ variable: 'Q1', rowKind: 'net', isNet: true, netLabel: 'Existing NET' }),
        ],
      })],
    });
    expect(result.flagged).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('already has NET rows');
  });

  it('skips excluded tables', () => {
    const result = runNetTriage({
      tables: [makeTable({ exclude: true })],
    });
    expect(result.flagged).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('table is excluded');
  });

  it('flags binary_flag tables', () => {
    const result = runNetTriage({
      tables: [makeTable({ normalizedType: 'binary_flag' })],
    });
    expect(result.flagged).toHaveLength(1);
  });

  it('handles mix of flagged and skipped', () => {
    const result = runNetTriage({
      tables: [
        makeTable({ tableId: 'flagged_1' }),
        makeTable({ tableId: 'skipped_1', tableKind: 'scale_overview_full' }),
        makeTable({ tableId: 'flagged_2', normalizedType: 'binary_flag' }),
        makeTable({ tableId: 'skipped_2', rows: [makeRow()] }),
      ],
    });
    expect(result.flagged).toHaveLength(2);
    expect(result.skipped).toHaveLength(2);
    expect(result.summary.totalTables).toBe(4);
    expect(result.summary.flaggedCount).toBe(2);
    expect(result.summary.skippedCount).toBe(2);
  });

  it('counts only value rows for threshold (ignores stat rows)', () => {
    const result = runNetTriage({
      tables: [makeTable({
        rows: [
          makeRow({ variable: 'Q1_1' }),
          makeRow({ variable: 'Q1_2' }),
          makeRow({ variable: 'Q1_3' }),
          makeRow({ variable: 'Q1_4' }),
          makeRow({ variable: 'Q1', rowKind: 'stat', statType: 'mean' }),
        ],
      })],
    });
    // Only 4 value rows, stat row doesn't count
    expect(result.flagged).toHaveLength(0);
    expect(result.skipped[0].reason).toContain('only 4 value rows');
  });
});
