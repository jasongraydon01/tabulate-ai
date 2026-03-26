import { describe, it, expect } from 'vitest';
import { applyBaseDirectives } from '../BaseDirectiveApplicator';
import { makeTable, makeRow } from '../../__tests__/fixtures';
import type { BaseDirective } from '../types';

function makeDirective(overrides: Partial<BaseDirective>): BaseDirective {
  return {
    tableId: 'q1',
    questionId: 'Q1',
    totalN: 200,
    tableAskedN: 200,
    tableGapPct: 0,
    tableFilter: '',
    tableBaseText: '',
    needsTableFilter: false,
    rowGroups: [],
    needsRowSplit: false,
    sumConstraint: null,
    ...overrides,
  };
}

describe('applyBaseDirectives', () => {
  it('passes through tables with no matching directive', () => {
    const tables = [makeTable({ tableId: 'q1', questionId: 'Q1' })];
    const result = applyBaseDirectives(tables, []);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].tableId).toBe('q1');
    expect(result.summary.passCount).toBe(1);
    expect(result.summary.filterCount).toBe(0);
    expect(result.summary.splitCount).toBe(0);
  });

  it('passes through tables where directive has no gap', () => {
    const tables = [makeTable({ tableId: 'q1', questionId: 'Q1' })];
    const directives = [makeDirective({ tableId: 'q1', needsTableFilter: false })];
    const result = applyBaseDirectives(tables, directives);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].additionalFilter).toBe('');
    expect(result.summary.passCount).toBe(1);
  });

  it('applies table-level filter when gap detected', () => {
    const tables = [makeTable({ tableId: 'q5', questionId: 'Q5' })];
    const directives = [
      makeDirective({
        tableId: 'q5',
        questionId: 'Q5',
        needsTableFilter: true,
        tableFilter: '!is.na(`Q5`)',
        tableBaseText: 'Those answering Q5',
        tableGapPct: 15,
      }),
    ];
    const result = applyBaseDirectives(tables, directives);

    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].additionalFilter).toBe('!is.na(`Q5`)');
    expect(result.tables[0].baseText).toBe('Those answering Q5');
    expect(result.tables[0].lastModifiedBy).toBe('DeterministicBaseEngine');
    expect(result.summary.filterCount).toBe(1);
  });

  it('preserves existing baseText when directive has empty baseText', () => {
    const tables = [makeTable({ tableId: 'q5', questionId: 'Q5', baseText: 'Original base text' })];
    const directives = [
      makeDirective({
        tableId: 'q5',
        needsTableFilter: true,
        tableFilter: '!is.na(`Q5`)',
        tableBaseText: '',
      }),
    ];
    const result = applyBaseDirectives(tables, directives);

    expect(result.tables[0].baseText).toBe('Original base text');
  });

  it('creates split tables when row groups differ', () => {
    const tables = [
      makeTable({
        tableId: 'q5_grid',
        questionId: 'Q5',
        rows: [
          makeRow({ variable: 'Q5r1c1' }),
          makeRow({ variable: 'Q5r1c2' }),
          makeRow({ variable: 'Q5r2c1' }),
          makeRow({ variable: 'Q5r2c2' }),
          makeRow({ variable: 'Q5_other' }),
        ],
      }),
    ];

    const directives = [
      makeDirective({
        tableId: 'q5_grid',
        questionId: 'Q5',
        needsTableFilter: true,
        needsRowSplit: true,
        tableFilter: '!is.na(`Q5r1c1`) | !is.na(`Q5r1c2`) | !is.na(`Q5r2c1`) | !is.na(`Q5r2c2`) | !is.na(`Q5_other`)',
        tableBaseText: 'Those answering Q5',
        rowGroups: [
          {
            groupId: 'Q5r1',
            variables: ['Q5r1c1', 'Q5r1c2'],
            askedN: 180,
            gapPct: 10,
            gapVsTable: 5,
            filter: '!is.na(`Q5r1c1`) | !is.na(`Q5r1c2`)',
          },
          {
            groupId: 'Q5r2',
            variables: ['Q5r2c1', 'Q5r2c2'],
            askedN: 150,
            gapPct: 25,
            gapVsTable: 15,
            filter: '!is.na(`Q5r2c1`) | !is.na(`Q5r2c2`)',
          },
        ],
      }),
    ];

    const result = applyBaseDirectives(tables, directives);

    // Should have 3 tables: Q5r1 group, Q5r2 group, and remainder (Q5_other)
    expect(result.tables.length).toBeGreaterThanOrEqual(2);
    expect(result.summary.splitCount).toBeGreaterThanOrEqual(2);

    // Check that all split tables have provenance
    for (const table of result.tables) {
      expect(table.splitFromTableId).toBe('q5_grid');
      expect(table.lastModifiedBy).toBe('DeterministicBaseEngine');
      expect(table.additionalFilter).toBeTruthy();
    }
  });

  it('sets splitFromTableId on split tables', () => {
    const tables = [
      makeTable({
        tableId: 'q10',
        questionId: 'Q10',
        rows: [
          makeRow({ variable: 'Q10r1c1' }),
          makeRow({ variable: 'Q10r1c2' }),
          makeRow({ variable: 'Q10r2c1' }),
          makeRow({ variable: 'Q10r2c2' }),
        ],
      }),
    ];

    const directives = [
      makeDirective({
        tableId: 'q10',
        questionId: 'Q10',
        needsTableFilter: true,
        needsRowSplit: true,
        tableFilter: '!is.na(`Q10r1c1`) | !is.na(`Q10r1c2`) | !is.na(`Q10r2c1`) | !is.na(`Q10r2c2`)',
        tableBaseText: 'Those answering Q10',
        rowGroups: [
          {
            groupId: 'Q10r1',
            variables: ['Q10r1c1', 'Q10r1c2'],
            askedN: 180,
            gapPct: 10,
            gapVsTable: 3,
            filter: '!is.na(`Q10r1c1`) | !is.na(`Q10r1c2`)',
          },
          {
            groupId: 'Q10r2',
            variables: ['Q10r2c1', 'Q10r2c2'],
            askedN: 160,
            gapPct: 20,
            gapVsTable: 10,
            filter: '!is.na(`Q10r2c1`) | !is.na(`Q10r2c2`)',
          },
        ],
      }),
    ];

    const result = applyBaseDirectives(tables, directives);

    for (const table of result.tables) {
      expect(table.splitFromTableId).toBe('q10');
    }
  });

  it('falls back to table-level filter when row split has only one effective group', () => {
    const tables = [
      makeTable({
        tableId: 'q3',
        questionId: 'Q3',
        rows: [
          makeRow({ variable: 'Q3r1c1' }),
          makeRow({ variable: 'Q3r1c2' }),
        ],
      }),
    ];

    // Only one row group → all rows belong to same group
    const directives = [
      makeDirective({
        tableId: 'q3',
        questionId: 'Q3',
        needsTableFilter: true,
        needsRowSplit: true,
        tableFilter: '!is.na(`Q3r1c1`) | !is.na(`Q3r1c2`)',
        tableBaseText: 'Those answering Q3',
        rowGroups: [
          {
            groupId: 'Q3r1',
            variables: ['Q3r1c1', 'Q3r1c2'],
            askedN: 180,
            gapPct: 10,
            gapVsTable: 5,
            filter: '!is.na(`Q3r1c1`) | !is.na(`Q3r1c2`)',
          },
        ],
      }),
    ];

    const result = applyBaseDirectives(tables, directives);

    // Only one group with rows → falls back to table-level filter (no split)
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].additionalFilter).toBe('!is.na(`Q3r1c1`) | !is.na(`Q3r1c2`)');
    expect(result.tables[0].lastModifiedBy).toBe('DeterministicBaseEngine');
  });

  it('handles multiple tables with mixed treatment', () => {
    const tables = [
      makeTable({ tableId: 'q1', questionId: 'Q1' }),
      makeTable({ tableId: 'q2', questionId: 'Q2' }),
      makeTable({ tableId: 'q3', questionId: 'Q3' }),
    ];

    const directives = [
      makeDirective({ tableId: 'q1', needsTableFilter: false }), // pass
      makeDirective({ tableId: 'q2', needsTableFilter: true, tableFilter: '!is.na(`Q2`)', tableBaseText: 'Those answering Q2' }), // filter
      // q3 has no directive → pass
    ];

    const result = applyBaseDirectives(tables, directives);

    expect(result.tables).toHaveLength(3);
    expect(result.summary.passCount).toBe(2);
    expect(result.summary.filterCount).toBe(1);
    expect(result.summary.totalInputTables).toBe(3);
    expect(result.summary.totalOutputTables).toBe(3);
  });
});
