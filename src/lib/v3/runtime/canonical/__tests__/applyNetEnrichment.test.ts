import { describe, it, expect, vi } from 'vitest';
import { applyNetEnrichmentResults } from '../applyNetEnrichment';
import { buildEntryBaseContract, projectTableBaseContract } from '../../baseContract';
import type { CanonicalTableOutput, CanonicalTable, CanonicalRow } from '../types';
import type { NetEnrichmentResult } from '../../../../../schemas/netEnrichmentSchema';

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
    normalizedType: 'binary_flag',
    tableType: 'frequency',
    questionText: 'Which do you use?',
    rows: [
      makeRow({ variable: 'Q1_1', label: 'Option A', filterValue: '1' }),
      makeRow({ variable: 'Q1_2', label: 'Option B', filterValue: '1' }),
      makeRow({ variable: 'Q1_3', label: 'Option C', filterValue: '1' }),
      makeRow({ variable: 'Q1_4', label: 'Option D', filterValue: '1' }),
      makeRow({ variable: 'Q1_5', label: 'Option E', filterValue: '1' }),
      makeRow({ variable: 'Q1_6', label: 'None of the above', filterValue: '1' }),
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

function makeCanonicalOutput(tables: CanonicalTable[]): CanonicalTableOutput {
  const totalRows = tables.reduce((sum, t) => sum + t.rows.length, 0);
  return {
    metadata: {
      generatedAt: '2026-03-18T00:00:00Z',
      assemblerVersion: '1.0.0',
      dataset: 'test',
      inputPlanPath: 'tables/table-plan.json',
      inputQuestionIdPath: 'questionid-final.json',
      totalTables: tables.length,
    },
    summary: {
      byTableKind: {},
      byTableType: {},
      byAnalyticalSubtype: {},
      totalRows,
    },
    tables,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('applyNetEnrichmentResults', () => {
  it('returns unchanged output when all results are noNetsNeeded', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: true,
      reasoning: 'No groupings.',
      suggestedSubtitle: '',
      nets: [],
    }];

    const result = applyNetEnrichmentResults(output, results);

    expect(result.tables).toHaveLength(1);
    expect(result.metadata.totalTables).toBe(1);
  });

  it('creates companion table for multi-variable NET (binary_flag)', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'A/B/C form a natural group.',
      suggestedSubtitle: 'NET Summary',
      nets: [{
        netLabel: 'Group ABC (NET)',
        components: ['Q1_1', 'Q1_2', 'Q1_3'],
        reasoning: 'Related items',
      }],
    }];

    const result = applyNetEnrichmentResults(output, results);

    // Should have original + companion
    expect(result.tables).toHaveLength(2);
    expect(result.metadata.totalTables).toBe(2);

    const companion = result.tables[1];
    expect(companion.tableId).toBe('Q1__standard_overview__net_summary');
    expect(companion.sourceTableId).toBe('Q1__standard_overview');
    expect(companion.isDerived).toBe(true);
    expect(companion.lastModifiedBy).toBe('NETEnrichmentAgent');
    expect(companion.sortOrder).toBe(1.5);
    expect(companion.tableSubtitle).toBe('NET Summary');

    // Check rows: 1 NET header + 3 indented components + 3 un-netted + 0 non-value
    const netRow = companion.rows.find(r => r.isNet);
    expect(netRow).toBeDefined();
    expect(netRow!.netLabel).toBe('Group ABC (NET)');
    expect(netRow!.rowKind).toBe('net');
    expect(netRow!.indent).toBe(0);
    // Multi-variable: netComponents populated, filterValue empty
    expect(netRow!.netComponents).toEqual(['Q1_1', 'Q1_2', 'Q1_3']);
    expect(netRow!.filterValue).toBe('');
    expect(netRow!.variable).toMatch(/^_NET_Q1_0$/);

    // Component rows should be indented
    const componentRows = companion.rows.filter(r => r.indent === 1);
    expect(componentRows).toHaveLength(3);
    expect(componentRows.map(r => r.variable)).toEqual(['Q1_1', 'Q1_2', 'Q1_3']);

    // Un-netted rows at indent 0
    const unNettedRows = companion.rows.filter(r => !r.isNet && r.indent === 0 && r.rowKind === 'value');
    expect(unNettedRows).toHaveLength(3);
    expect(unNettedRows.map(r => r.variable)).toEqual(['Q1_4', 'Q1_5', 'Q1_6']);
  });

  it('creates same-variable NET (categorical_select)', () => {
    // All rows share the same variable with different filterValues
    const table = makeTable({
      normalizedType: 'categorical_select',
      rows: [
        makeRow({ variable: 'Q8', label: 'Very Satisfied', filterValue: '5' }),
        makeRow({ variable: 'Q8', label: 'Satisfied', filterValue: '4' }),
        makeRow({ variable: 'Q8', label: 'Neutral', filterValue: '3' }),
        makeRow({ variable: 'Q8', label: 'Dissatisfied', filterValue: '2' }),
        makeRow({ variable: 'Q8', label: 'Very Dissatisfied', filterValue: '1' }),
      ],
    });
    const output = makeCanonicalOutput([table]);
    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Top/bottom box grouping.',
      suggestedSubtitle: 'Satisfaction NET Summary',
      nets: [{
        netLabel: 'Satisfied (NET)',
        components: ['5', '4'],
        reasoning: 'Top 2 satisfaction levels',
      }],
    }];

    const result = applyNetEnrichmentResults(output, results);

    const companion = result.tables[1];
    expect(companion).toBeDefined();
    expect(companion.tableSubtitle).toBe('Satisfaction NET Summary');

    // Same-variable: filterValue is comma-joined, netComponents empty
    const netRow = companion.rows.find(r => r.isNet);
    expect(netRow).toBeDefined();
    expect(netRow!.variable).toBe('Q8');
    expect(netRow!.filterValue).toBe('5,4');
    expect(netRow!.netComponents).toEqual([]);

    const indentedRows = companion.rows.filter(r => r.indent === 1);
    expect(indentedRows.map(r => r.filterValue)).toEqual(['5', '4']);

    const unNettedRows = companion.rows.filter(r => !r.isNet && r.indent === 0 && r.rowKind === 'value');
    expect(unNettedRows.map(r => r.filterValue)).toEqual(['3', '2', '1']);
  });

  it('discards NET with unknown component variables', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Test invalid components.',
      suggestedSubtitle: 'NET Summary',
      nets: [{
        netLabel: 'Bad NET',
        components: ['Q1_1', 'NONEXISTENT'],
        reasoning: 'Has an invalid component',
      }],
    }];

    const result = applyNetEnrichmentResults(output, results);

    // NET should be discarded, no companion table
    expect(result.tables).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('NONEXISTENT'));

    warnSpy.mockRestore();
  });

  it('keeps valid NETs when some NETs have invalid components', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Mixed valid/invalid.',
      suggestedSubtitle: 'NET Summary',
      nets: [
        {
          netLabel: 'Valid NET',
          components: ['Q1_1', 'Q1_2'],
          reasoning: 'Valid group',
        },
        {
          netLabel: 'Invalid NET',
          components: ['Q1_3', 'MISSING_VAR'],
          reasoning: 'Invalid group',
        },
      ],
    }];

    const result = applyNetEnrichmentResults(output, results);

    // Companion should exist with only the valid NET
    expect(result.tables).toHaveLength(2);
    const companion = result.tables[1];
    const netRows = companion.rows.filter(r => r.isNet);
    expect(netRows).toHaveLength(1);
    expect(netRows[0].netLabel).toBe('Valid NET');

    warnSpy.mockRestore();
  });

  it('inserts companion immediately after source table', () => {
    const table1 = makeTable({ tableId: 'Q1__standard_overview', sortOrder: 1 });
    const table2 = makeTable({ tableId: 'Q2__standard_overview', questionId: 'Q2', sortOrder: 2 });
    const table3 = makeTable({ tableId: 'Q3__standard_overview', questionId: 'Q3', sortOrder: 3 });
    const output = makeCanonicalOutput([table1, table2, table3]);

    const results: NetEnrichmentResult[] = [{
      tableId: 'Q2__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Group needed.',
      suggestedSubtitle: 'NET Summary',
      nets: [{
        netLabel: 'Group (NET)',
        components: ['Q1_1', 'Q1_2'],
        reasoning: 'Natural group',
      }],
    }];

    const result = applyNetEnrichmentResults(output, results);

    expect(result.tables).toHaveLength(4);
    expect(result.tables[0].tableId).toBe('Q1__standard_overview');
    expect(result.tables[1].tableId).toBe('Q2__standard_overview');
    expect(result.tables[2].tableId).toBe('Q2__standard_overview__net_summary');
    expect(result.tables[3].tableId).toBe('Q3__standard_overview');
  });

  it('does not mutate the source table', () => {
    const table = makeTable();
    const originalRows = [...table.rows];
    const output = makeCanonicalOutput([table]);

    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Test immutability.',
      suggestedSubtitle: 'NET Summary',
      nets: [{
        netLabel: 'Group (NET)',
        components: ['Q1_1', 'Q1_2'],
        reasoning: 'Group',
      }],
    }];

    applyNetEnrichmentResults(output, results);

    // Source table rows should be unchanged
    expect(table.rows).toEqual(originalRows);
    expect(table.lastModifiedBy).toBe('assembler');
  });

  it('updates metadata totalTables and summary totalRows', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);

    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Needs NETs.',
      suggestedSubtitle: 'NET Summary',
      nets: [{
        netLabel: 'Group (NET)',
        components: ['Q1_1', 'Q1_2'],
        reasoning: 'Group',
      }],
    }];

    const result = applyNetEnrichmentResults(output, results);

    expect(result.metadata.totalTables).toBe(2);
    expect(result.summary.totalRows).toBeGreaterThan(output.summary.totalRows);
  });

  it('uses default subtitle when suggestedSubtitle is empty', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);

    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Needs NETs.',
      suggestedSubtitle: '',
      nets: [{
        netLabel: 'Group (NET)',
        components: ['Q1_1', 'Q1_2'],
        reasoning: 'Group',
      }],
    }];

    const result = applyNetEnrichmentResults(output, results);

    const companion = result.tables[1];
    expect(companion.tableSubtitle).toBe('NET Summary');
  });

  it('discards NET with fewer than 2 components', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const table = makeTable();
    const output = makeCanonicalOutput([table]);

    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Single item NET.',
      suggestedSubtitle: 'NET Summary',
      nets: [{
        netLabel: 'Single (NET)',
        components: ['Q1_1'],
        reasoning: 'Just one item',
      }],
    }];

    const result = applyNetEnrichmentResults(output, results);

    // Single-component NET should be discarded
    expect(result.tables).toHaveLength(1);

    warnSpy.mockRestore();
  });

  it('supports same-variable components expressed as repeated shared-variable tokens', () => {
    const table = makeTable({
      normalizedType: 'categorical_select',
      rows: [
        makeRow({ variable: 'Q8', filterValue: '1' }),
        makeRow({ variable: 'Q8', filterValue: '2' }),
        makeRow({ variable: 'Q8', filterValue: '3' }),
        makeRow({ variable: 'Q8', filterValue: '4' }),
        makeRow({ variable: 'Q8', filterValue: '5' }),
      ],
    });
    const output = makeCanonicalOutput([table]);
    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Ambiguous components.',
      suggestedSubtitle: 'NET Summary',
      nets: [{
        netLabel: 'Sequential (NET)',
        components: ['Q8', 'Q8'],
        reasoning: 'Uses repeated shared variable',
      }],
    }];

    const result = applyNetEnrichmentResults(output, results);

    expect(result.tables).toHaveLength(2);
    const companion = result.tables[1];
    const netRow = companion.rows.find(r => r.isNet);
    expect(netRow).toBeDefined();
    expect(netRow!.filterValue).toBe('1,2');
  });

  it('prevents overlapping component rows from appearing under multiple NETs', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const table = makeTable();
    const output = makeCanonicalOutput([table]);
    const results: NetEnrichmentResult[] = [{
      tableId: 'Q1__standard_overview',
      noNetsNeeded: false,
      reasoning: 'Overlap test.',
      suggestedSubtitle: 'NET Summary',
      nets: [
        {
          netLabel: 'Group 1 (NET)',
          components: ['Q1_1', 'Q1_2', 'Q1_3'],
          reasoning: 'First group',
        },
        {
          netLabel: 'Group 2 (NET)',
          components: ['Q1_3', 'Q1_4'],
          reasoning: 'Second group overlaps Q1_3',
        },
      ],
    }];

    const result = applyNetEnrichmentResults(output, results);
    const companion = result.tables[1];
    const netRows = companion.rows.filter(r => r.isNet);
    expect(netRows).toHaveLength(1);

    const groupedRows = companion.rows.filter(r => r.rowKind === 'value' && r.indent === 1);
    expect(groupedRows.map(r => r.variable)).toEqual(['Q1_1', 'Q1_2', 'Q1_3']);

    // Q1_3 should only appear once in grouped rows, under the first NET.
    expect(groupedRows.filter(r => r.variable === 'Q1_3')).toHaveLength(1);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('fewer than 2 non-overlapping components'));
    warnSpy.mockRestore();
  });

  it('returns unchanged output when agentResults is empty', () => {
    const table = makeTable();
    const output = makeCanonicalOutput([table]);

    const result = applyNetEnrichmentResults(output, []);

    expect(result.tables).toHaveLength(1);
    expect(result).toEqual(output);
  });
});
