/**
 * @deprecated Tests for deprecated FilterApplicator. Kept passing for reference.
 * Retained for reference. Do not invoke from active pipeline code.
 */

import { describe, it, expect, vi } from 'vitest';
import { applyFilters } from '../FilterApplicator';
import { makeTable, makeRow } from '../../__tests__/fixtures';
import type { FilterTranslationOutput, TableFilter } from '@/schemas/skipLogicSchema';

// Mock the review module to avoid env dependency
vi.mock('../../review', () => ({
  shouldFlagForReview: () => false,
  getReviewThresholds: () => ({
    banner: 0.7,
    crosstab: 0.7,
    filter: 0.7,
    verification: 0.7,
    loopSemantics: 0.7,
  }),
}));

function makeFilter(overrides: Partial<TableFilter>): TableFilter {
  return {
    ruleId: 'rule1',
    questionId: 'Q1',
    action: 'filter',
    filterExpression: 'S1 == 1',
    baseText: 'Those who said yes to S1',
    splits: [],
    columnSplits: [],
    alternatives: [],
    confidence: 0.95,
    reasoning: 'Test filter',
    ...overrides,
  };
}

function makeTranslation(filters: TableFilter[]): FilterTranslationOutput {
  return { filters };
}

describe('FilterApplicator', () => {
  const validVariables = new Set(['Q1', 'Q2', 'S1', 'S2', 'Q1r1', 'Q1r2', 'Q1r3']);

  it('passes tables through unchanged when no filters match', () => {
    const tables = [
      makeTable({ tableId: 't1', questionId: 'Q1' }),
      makeTable({ tableId: 't2', questionId: 'Q2' }),
    ];
    const filters = makeTranslation([]);
    const result = applyFilters(tables, filters, validVariables);
    expect(result.tables).toHaveLength(2);
    expect(result.summary.passCount).toBe(2);
    expect(result.summary.filterCount).toBe(0);
  });

  it('applies table-level filter (sets additionalFilter and baseText)', () => {
    const tables = [
      makeTable({ tableId: 't1', questionId: 'Q1' }),
    ];
    const filters = makeTranslation([
      makeFilter({
        questionId: 'Q1',
        action: 'filter',
        filterExpression: 'S1 == 1',
        baseText: 'Those who said yes',
      }),
    ]);
    const result = applyFilters(tables, filters, validVariables);
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].additionalFilter).toBe('S1 == 1');
    expect(result.tables[0].baseText).toBe('Those who said yes');
    expect(result.tables[0].lastModifiedBy).toBe('FilterApplicator');
  });

  it('applies row-level split (1 table → N tables)', () => {
    const tables = [
      makeTable({
        tableId: 't1',
        questionId: 'Q1',
        rows: [
          makeRow({ variable: 'Q1r1', filterValue: '1' }),
          makeRow({ variable: 'Q1r2', filterValue: '1' }),
          makeRow({ variable: 'Q1r3', filterValue: '1' }),
        ],
      }),
    ];
    const filters = makeTranslation([
      makeFilter({
        questionId: 'Q1',
        action: 'split',
        filterExpression: '',
        baseText: '',
        splits: [
          {
            rowVariables: ['Q1r1', 'Q1r2'],
            filterExpression: 'S1 == 1',
            baseText: 'Group A',
            splitLabel: 'Group_A',
          },
          {
            rowVariables: ['Q1r3'],
            filterExpression: 'S1 == 2',
            baseText: 'Group B',
            splitLabel: 'Group_B',
          },
        ],
      }),
    ]);
    const result = applyFilters(tables, filters, validVariables);
    expect(result.tables).toHaveLength(2);
    expect(result.tables[0].rows).toHaveLength(2);
    expect(result.tables[1].rows).toHaveLength(1);
    expect(result.summary.splitCount).toBe(1);
  });

  it('flags tables with invalid filter variables for review', () => {
    const tables = [
      makeTable({ tableId: 't1', questionId: 'Q1' }),
    ];
    const filters = makeTranslation([
      makeFilter({
        questionId: 'Q1',
        action: 'filter',
        filterExpression: 'NONEXISTENT == 1',
        baseText: 'Test',
      }),
    ]);
    const result = applyFilters(tables, filters, validVariables);
    // Table passed through with review flag set
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].filterReviewRequired).toBe(true);
  });

  it('passes through table with empty filter expression', () => {
    const tables = [
      makeTable({ tableId: 't1', questionId: 'Q1' }),
    ];
    const filters = makeTranslation([
      makeFilter({
        questionId: 'Q1',
        action: 'filter',
        filterExpression: '',
        baseText: '',
      }),
    ]);
    const result = applyFilters(tables, filters, validVariables);
    expect(result.tables).toHaveLength(1);
    expect(result.summary.passCount).toBe(1);
  });

  it('tracks summary counts correctly', () => {
    const tables = [
      makeTable({ tableId: 't1', questionId: 'Q1' }),
      makeTable({ tableId: 't2', questionId: 'Q2' }),
    ];
    const filters = makeTranslation([
      makeFilter({
        questionId: 'Q1',
        action: 'filter',
        filterExpression: 'S1 == 1',
        baseText: 'Test',
      }),
    ]);
    const result = applyFilters(tables, filters, validVariables);
    expect(result.summary.totalInputTables).toBe(2);
    expect(result.summary.totalOutputTables).toBe(2);
    expect(result.summary.filterCount).toBe(1);
    expect(result.summary.passCount).toBe(1);
  });

  it('sets splitFromTableId on split tables', () => {
    const tables = [
      makeTable({
        tableId: 't1',
        questionId: 'Q1',
        rows: [
          makeRow({ variable: 'Q1r1', filterValue: '1' }),
          makeRow({ variable: 'Q1r2', filterValue: '1' }),
        ],
      }),
    ];
    const filters = makeTranslation([
      makeFilter({
        questionId: 'Q1',
        action: 'split',
        filterExpression: '',
        baseText: '',
        splits: [
          {
            rowVariables: ['Q1r1'],
            filterExpression: 'S1 == 1',
            baseText: 'Split A',
            splitLabel: 'A',
          },
          {
            rowVariables: ['Q1r2'],
            filterExpression: 'S1 == 2',
            baseText: 'Split B',
            splitLabel: 'B',
          },
        ],
      }),
    ]);
    const result = applyFilters(tables, filters, validVariables);
    expect(result.tables[0].splitFromTableId).toBe('t1');
    expect(result.tables[1].splitFromTableId).toBe('t1');
  });

  it('generates descriptive tableIds for split tables', () => {
    const tables = [
      makeTable({
        tableId: 't1',
        questionId: 'Q1',
        rows: [
          makeRow({ variable: 'Q1r1', filterValue: '1' }),
        ],
      }),
    ];
    const filters = makeTranslation([
      makeFilter({
        questionId: 'Q1',
        action: 'split',
        filterExpression: '',
        baseText: '',
        splits: [
          {
            rowVariables: ['Q1r1'],
            filterExpression: 'S1 == 1',
            baseText: 'Split A',
            splitLabel: 'Group A',
          },
        ],
      }),
    ]);
    const result = applyFilters(tables, filters, validVariables);
    expect(result.tables[0].tableId).toContain('t1_');
    expect(result.tables[0].tableId).toContain('group_a');
  });
});
