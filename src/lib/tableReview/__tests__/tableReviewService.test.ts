import { describe, it, expect } from 'vitest';
import {
  applyExcludeUpdates,
  detectTableVariants,
  rebuildAllWorkbooks,
} from '../tableReviewService';
import type { TablesJson, TablesJsonMetadata, TableData } from '../../excel/ExcelFormatter';

function makeTablesJson(overrides: {
  tables?: Record<string, TableData>;
  metadata?: Partial<TablesJsonMetadata>;
} = {}): TablesJson {
  const defaultMetadata: TablesJsonMetadata = {
    generatedAt: new Date().toISOString(),
    tableCount: 2,
    cutCount: 2,
    significanceLevel: 0.10,
    totalRespondents: 200,
    bannerGroups: [
      {
        groupName: 'Total',
        columns: [{ name: 'Total', statLetter: 'T' }],
      },
      {
        groupName: 'Gender',
        columns: [
          { name: 'Male', statLetter: 'A' },
          { name: 'Female', statLetter: 'B' },
        ],
      },
    ],
    comparisonGroups: ['A/B'],
    ...overrides.metadata,
  };

  const defaultTables: Record<string, TableData> = {
    q1: {
      tableId: 'q1',
      questionId: 'Q1',
      questionText: 'First question',
      tableType: 'frequency',
      isDerived: false,
      sourceTableId: '',
      data: {
        T: { base: 200, rows: { 'Q1::1': { count: 120, percent: 60 } } },
        A: { base: 100, rows: { 'Q1::1': { count: 70, percent: 70 } } },
        B: { base: 100, rows: { 'Q1::1': { count: 50, percent: 50 } } },
      },
    },
    q2: {
      tableId: 'q2',
      questionId: 'Q2',
      questionText: 'Second question',
      tableType: 'frequency',
      isDerived: false,
      sourceTableId: '',
      data: {
        T: { base: 200, rows: { 'Q2::1': { count: 100, percent: 50 } } },
        A: { base: 100, rows: { 'Q2::1': { count: 60, percent: 60 } } },
        B: { base: 100, rows: { 'Q2::1': { count: 40, percent: 40 } } },
      },
    },
    ...overrides.tables,
  };

  return {
    metadata: defaultMetadata,
    tables: defaultTables,
  };
}

// ---- applyExcludeUpdates ----

describe('applyExcludeUpdates', () => {
  it('excludes a table and sets reason', () => {
    const json = makeTablesJson();
    const { tablesJson, applied, notFound } = applyExcludeUpdates(json, [
      { tableId: 'q1', exclude: true, excludeReason: 'Low base' },
    ]);
    expect(applied).toBe(1);
    expect(notFound).toEqual([]);
    expect(tablesJson.tables.q1.excluded).toBe(true);
    expect(tablesJson.tables.q1.excludeReason).toBe('Low base');
  });

  it('includes a previously excluded table and clears reason', () => {
    const json = makeTablesJson({
      tables: {
        q1: {
          tableId: 'q1', questionId: 'Q1', questionText: 'Q', tableType: 'frequency',
          isDerived: false, sourceTableId: '',
          excluded: true, excludeReason: 'Old reason',
          data: { T: { base: 100, rows: {} } },
        },
      },
    });
    const { tablesJson, applied } = applyExcludeUpdates(json, [
      { tableId: 'q1', exclude: false },
    ]);
    expect(applied).toBe(1);
    expect(tablesJson.tables.q1.excluded).toBe(false);
    expect(tablesJson.tables.q1.excludeReason).toBeUndefined();
  });

  it('reports not-found table IDs', () => {
    const json = makeTablesJson();
    const { applied, notFound } = applyExcludeUpdates(json, [
      { tableId: 'nonexistent', exclude: true },
    ]);
    expect(applied).toBe(0);
    expect(notFound).toEqual(['nonexistent']);
  });

  it('is idempotent for same exclude state', () => {
    const json = makeTablesJson({
      tables: {
        q1: {
          tableId: 'q1', questionId: 'Q1', questionText: 'Q', tableType: 'frequency',
          isDerived: false, sourceTableId: '',
          excluded: true, excludeReason: 'Already excluded',
          data: { T: { base: 100, rows: {} } },
        },
      },
    });
    const { applied } = applyExcludeUpdates(json, [
      { tableId: 'q1', exclude: true, excludeReason: 'Already excluded' },
    ]);
    expect(applied).toBe(0);
  });

  it('handles multiple updates', () => {
    const json = makeTablesJson();
    const { applied, notFound } = applyExcludeUpdates(json, [
      { tableId: 'q1', exclude: true, excludeReason: 'Low base' },
      { tableId: 'q2', exclude: true },
      { tableId: 'missing', exclude: false },
    ]);
    expect(applied).toBe(2);
    expect(notFound).toEqual(['missing']);
    expect(json.tables.q1.excluded).toBe(true);
    expect(json.tables.q2.excluded).toBe(true);
  });
});

// ---- detectTableVariants ----

describe('detectTableVariants', () => {
  it('finds default variant', () => {
    const result = detectTableVariants({
      'results/tables.json': 'org/proj/run/results/tables.json',
      'results/crosstabs.xlsx': 'org/proj/run/results/crosstabs.xlsx',
    });
    expect(result).toEqual(['results/tables.json']);
  });

  it('finds weighted + unweighted variants', () => {
    const result = detectTableVariants({
      'results/tables-weighted.json': 'key1',
      'results/tables-unweighted.json': 'key2',
      'results/crosstabs-weighted.xlsx': 'key3',
    });
    expect(result).toContain('results/tables-weighted.json');
    expect(result).toContain('results/tables-unweighted.json');
    expect(result).not.toContain('results/tables.json');
  });

  it('returns empty array when no variants exist', () => {
    const result = detectTableVariants({
      'results/crosstabs.xlsx': 'key1',
      'r/master.R': 'key2',
    });
    expect(result).toEqual([]);
  });
});

// ---- rebuildAllWorkbooks ----

describe('rebuildAllWorkbooks', () => {
  it('produces correct buffer count for single variant', async () => {
    const variants = new Map<string, TablesJson>();
    variants.set('results/tables.json', makeTablesJson());

    const buffers = await rebuildAllWorkbooks(variants, { format: 'standard', displayMode: 'frequency' });
    // Single variant, single display mode → 1 workbook
    expect(buffers.size).toBe(1);
    expect(buffers.has('results/crosstabs.xlsx')).toBe(true);
    const buf = buffers.get('results/crosstabs.xlsx')!;
    expect(buf.length).toBeGreaterThan(0);
  });

  it('produces primary + counts for separateWorkbooks mode', async () => {
    const variants = new Map<string, TablesJson>();
    variants.set('results/tables.json', makeTablesJson());

    const buffers = await rebuildAllWorkbooks(variants, {
      format: 'standard',
      displayMode: 'both',
      separateWorkbooks: true,
    });
    expect(buffers.has('results/crosstabs.xlsx')).toBe(true);
    expect(buffers.has('results/crosstabs-counts.xlsx')).toBe(true);
    expect(buffers.size).toBe(2);
  });

  it('handles weighted + unweighted variants', async () => {
    const variants = new Map<string, TablesJson>();
    variants.set('results/tables-weighted.json', makeTablesJson());
    variants.set('results/tables-unweighted.json', makeTablesJson());

    const buffers = await rebuildAllWorkbooks(variants, { format: 'standard', displayMode: 'frequency' });
    expect(buffers.has('results/crosstabs-weighted.xlsx')).toBe(true);
    expect(buffers.has('results/crosstabs-unweighted.xlsx')).toBe(true);
    expect(buffers.size).toBe(2);
  });

  it('skips unknown variant paths', async () => {
    const variants = new Map<string, TablesJson>();
    variants.set('results/tables-custom.json', makeTablesJson());

    const buffers = await rebuildAllWorkbooks(variants, { format: 'standard', displayMode: 'frequency' });
    expect(buffers.size).toBe(0);
  });
});
