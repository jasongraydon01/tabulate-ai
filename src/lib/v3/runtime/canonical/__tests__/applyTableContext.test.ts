import { describe, it, expect, vi } from 'vitest';
import { applyTableContextResults } from '../applyTableContext';
import type { CanonicalTableOutput, CanonicalTable } from '../types';
import type { TableContextOutput } from '../../../../../schemas/tableContextSchema';

// =============================================================================
// Test Helpers
// =============================================================================

function makeTable(overrides: Partial<CanonicalTable> = {}): CanonicalTable {
  return {
    tableId: 'Q1_overview',
    questionId: 'Q1',
    familyRoot: 'Q1',
    sourceTableId: 'Q1_overview',
    splitFromTableId: '',
    tableKind: 'standard_overview',
    analyticalSubtype: 'standard_single',
    normalizedType: 'standard',
    tableType: 'frequency',
    questionText: 'Which brand do you prefer?',
    rows: [
      {
        variable: 'Q1_1',
        label: 'Brand A',
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
      },
      {
        variable: 'Q1_2',
        label: 'Brand B',
        filterValue: '2',
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
      },
    ],
    statsSpec: null,
    derivationHint: null,
    statTestSpec: null,
    basePolicy: 'total',
    baseSource: 'question',
    questionBase: 500,
    itemBase: null,
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
  } as CanonicalTable;
}

function makeCanonicalOutput(tables: CanonicalTable[]): CanonicalTableOutput {
  return {
    metadata: {
      generatedAt: '2026-03-17T00:00:00Z',
      assemblerVersion: '1.0.0',
      dataset: 'test-dataset',
      inputPlanPath: 'tables/plan.json',
      inputQuestionIdPath: 'questionid-final.json',
      totalTables: tables.length,
    },
    summary: {
      byTableKind: {},
      byTableType: {},
      byAnalyticalSubtype: {},
      totalRows: tables.reduce((sum, t) => sum + t.rows.length, 0),
    },
    tables,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('applyTableContextResults', () => {
  it('applies metadata when noChangesNeeded is false', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_overview',
            tableSubtitle: 'Brand Preference',
            userNote: 'Single response',
            baseText: 'All Survey Respondents',
            noChangesNeeded: false,
            reasoning: 'Subtitle added for clarity.',
            rowLabelOverrides: [],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].tableSubtitle).toBe('Brand Preference');
    expect(result.tables[0].userNote).toBe('Single response');
    expect(result.tables[0].baseText).toBe('All Survey Respondents');
  });

  it('skips when noChangesNeeded is true', () => {
    const table = makeTable({
      tableSubtitle: 'Original subtitle',
      userNote: 'Original note',
      baseText: 'Original base',
    });
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_overview',
            tableSubtitle: 'Different subtitle',
            userNote: 'Different note',
            baseText: 'Different base',
            noChangesNeeded: true,
            reasoning: 'All good.',
            rowLabelOverrides: [],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].tableSubtitle).toBe('Original subtitle');
    expect(result.tables[0].userNote).toBe('Original note');
    expect(result.tables[0].baseText).toBe('Original base');
    expect(result.tables[0].lastModifiedBy).toBe('assembler');
  });

  it('applies row label overrides when variable matches', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_overview',
            tableSubtitle: '',
            userNote: '',
            baseText: 'Total Respondents',
            noChangesNeeded: false,
            reasoning: 'Row labels improved.',
            rowLabelOverrides: [
              {
                variable: 'Q1_1',
                label: 'Premium Brand A',
                reason: 'Survey label more descriptive',
              },
            ],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].rows[0].label).toBe('Premium Brand A');
    expect(result.tables[0].rows[1].label).toBe('Brand B'); // unchanged
  });

  it('does not downgrade ranking stimuli-set subtitles to bare set labels', () => {
    const table = makeTable({
      tableKind: 'ranking_overview_rank',
      tableSubtitle: 'Ranked 1st Summary — Set 1',
      stimuliSetSlice: {
        familySource: 'B500',
        setIndex: 0,
        setLabel: 'Set 1',
        sourceQuestionId: 'B500_1',
      },
    });
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_overview',
            tableSubtitle: 'Set 1',
            userNote: '',
            baseText: 'Total Respondents',
            noChangesNeeded: false,
            reasoning: 'Use the set label as subtitle.',
            rowLabelOverrides: [],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].tableSubtitle).toBe('Ranked 1st Summary — Set 1');
    expect(result.tables[0].baseText).toBe('Total Respondents');
  });

  it('does not strip set context from iteration-family ranking summaries', () => {
    const table = makeTable({
      questionId: 'B500',
      familyRoot: 'B500_1',
      tableKind: 'ranking_overview_rank',
      tableSubtitle: 'Ranked 1st Summary - Set 1',
    });
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_overview',
            tableSubtitle: 'Ranked 1st Summary',
            userNote: '',
            baseText: 'Total Respondents',
            noChangesNeeded: false,
            reasoning: 'Shortened subtitle.',
            rowLabelOverrides: [],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].tableSubtitle).toBe('Ranked 1st Summary - Set 1');
  });

  it('skips row label override when variable not found and warns', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_overview',
            tableSubtitle: 'Updated',
            userNote: '',
            baseText: 'Total Respondents',
            noChangesNeeded: false,
            reasoning: 'Test',
            rowLabelOverrides: [
              {
                variable: 'Q1_NONEXISTENT',
                label: 'Should not apply',
                reason: 'test',
              },
            ],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].rows[0].label).toBe('Brand A'); // unchanged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Q1_NONEXISTENT'),
    );
    consoleSpy.mockRestore();
  });

  it('sets lastModifiedBy to TableContextAgent', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_overview',
            tableSubtitle: 'Updated',
            userNote: '',
            baseText: 'Total Respondents',
            noChangesNeeded: false,
            reasoning: 'Test',
            rowLabelOverrides: [],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].lastModifiedBy).toBe('TableContextAgent');
  });

  it('leaves tables not in AI output unchanged', () => {
    const table1 = makeTable({ tableId: 'Q1_overview' });
    const table2 = makeTable({ tableId: 'Q2_overview', questionId: 'Q2' });
    const output = makeCanonicalOutput([table1, table2]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_overview',
            tableSubtitle: 'Changed',
            userNote: '',
            baseText: 'Total',
            noChangesNeeded: false,
            reasoning: 'Test',
            rowLabelOverrides: [],
          },
          // Q2_overview not included in AI results
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].tableSubtitle).toBe('Changed');
    expect(result.tables[1].tableSubtitle).toBe(''); // unchanged default
    expect(result.tables[1].lastModifiedBy).toBe('assembler');
  });

  it('skips invalid tableId and warns', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'NONEXISTENT_TABLE',
            tableSubtitle: 'Updated',
            userNote: '',
            baseText: 'Total',
            noChangesNeeded: false,
            reasoning: 'Test',
            rowLabelOverrides: [],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].tableSubtitle).toBe(''); // unchanged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('NONEXISTENT_TABLE'),
    );
    consoleSpy.mockRestore();
  });

  it('enforces baseText consistency within same questionId+basePolicy group', () => {
    const table1 = makeTable({ tableId: 'Q1_full', basePolicy: 'total', baseText: 'Original' });
    const table2 = makeTable({ tableId: 'Q1_t2b', basePolicy: 'total', baseText: 'Original' });
    const table3 = makeTable({ tableId: 'Q1_mean', basePolicy: 'total', baseText: 'Original' });
    const output = makeCanonicalOutput([table1, table2, table3]);

    // AI sets baseText on table1 and table2 but not table3
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_full',
            tableSubtitle: '',
            userNote: '',
            baseText: 'All Participants (n=500)',
            noChangesNeeded: false,
            reasoning: 'Test',
            rowLabelOverrides: [],
          },
          {
            tableId: 'Q1_t2b',
            tableSubtitle: '',
            userNote: '',
            baseText: 'All Participants (n=500)',
            noChangesNeeded: false,
            reasoning: 'Test',
            rowLabelOverrides: [],
          },
          // Q1_mean not included — should get propagated
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    // All three should have the same baseText
    expect(result.tables[0].baseText).toBe('All Participants (n=500)');
    expect(result.tables[1].baseText).toBe('All Participants (n=500)');
    expect(result.tables[2].baseText).toBe('All Participants (n=500)');
    expect(result.tables[2].lastModifiedBy).toBe('TableContextAgent');
  });

  it('does not propagate baseText across different disclosure scopes', () => {
    const anchor = makeTable({
      tableId: 'Q1_anchor',
      baseText: 'Original anchor',
      baseViewRole: 'anchor',
      baseDisclosure: {
        referenceBaseN: 500,
        itemBaseRange: [420, 500],
        defaultBaseText: 'Those who were shown Q1',
        defaultNoteTokens: ['anchor-base-varies-by-item', 'anchor-base-range'],
        rangeDisclosure: { min: 420, max: 500 },
        source: 'contract',
      },
    });
    const precision = makeTable({
      tableId: 'Q1_precision',
      baseText: 'Original precision',
      baseViewRole: 'precision',
      baseDisclosure: {
        referenceBaseN: 420,
        itemBaseRange: [420, 500],
        defaultBaseText: 'Respondents shown selected item',
        defaultNoteTokens: [],
        rangeDisclosure: null,
        source: 'contract',
      },
    });

    const result = applyTableContextResults(
      makeCanonicalOutput([anchor, precision]),
      [
        {
          tables: [
            {
              tableId: 'Q1_anchor',
              tableSubtitle: '',
              userNote: '',
              baseText: 'Those who were shown Q1',
              noChangesNeeded: false,
              reasoning: 'Use the anchor universe wording.',
              rowLabelOverrides: [],
            },
          ],
        },
      ],
    );

    expect(result.tables[0].baseText).toBe('Those who were shown Q1');
    expect(result.tables[1].baseText).toBe('Original precision');
  });

  it('returns canonical output unchanged when results array is empty', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const aiResults: TableContextOutput[] = [];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].tableSubtitle).toBe('');
    expect(result.tables[0].lastModifiedBy).toBe('assembler');
  });

  it('does NOT flatten baseText across binarySide boundaries', () => {
    const selected = makeTable({
      tableId: 'Q1_sel',
      baseText: 'Original selected',
      binarySide: 'selected',
    });
    const unselected = makeTable({
      tableId: 'Q1_unsel',
      baseText: 'Original unselected',
      binarySide: 'unselected',
    });
    const output = makeCanonicalOutput([selected, unselected]);

    // AI sets different baseText for each side
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_sel',
            tableSubtitle: '',
            userNote: '',
            baseText: 'Those who selected the message',
            noChangesNeeded: false,
            reasoning: 'Selected side.',
            rowLabelOverrides: [],
          },
          // Q1_unsel not in AI results — should NOT get selected's baseText
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].baseText).toBe('Those who selected the message');
    expect(result.tables[1].baseText).toBe('Original unselected');
  });

  it('propagates baseText within same binarySide group', () => {
    const sel1 = makeTable({
      tableId: 'Q1_sel_full',
      baseText: 'Original',
      binarySide: 'selected',
    });
    const sel2 = makeTable({
      tableId: 'Q1_sel_t2b',
      baseText: 'Original',
      binarySide: 'selected',
    });
    const output = makeCanonicalOutput([sel1, sel2]);

    // AI sets baseText only on sel1 — sel2 should get it via consistency
    const aiResults: TableContextOutput[] = [
      {
        tables: [
          {
            tableId: 'Q1_sel_full',
            tableSubtitle: '',
            userNote: '',
            baseText: 'Those who selected the message',
            noChangesNeeded: false,
            reasoning: 'Test',
            rowLabelOverrides: [],
          },
        ],
      },
    ];

    const result = applyTableContextResults(output, aiResults);

    expect(result.tables[0].baseText).toBe('Those who selected the message');
    expect(result.tables[1].baseText).toBe('Those who selected the message');
  });
});
