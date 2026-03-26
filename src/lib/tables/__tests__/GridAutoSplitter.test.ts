import { describe, it, expect, afterEach } from 'vitest';
import { splitOversizedGrids } from '../GridAutoSplitter';
import type { ExtendedTableDefinition } from '../../../schemas/verificationAgentSchema';
import type { VerboseDataMapType } from '../../../schemas/processingSchemas';

// =============================================================================
// Helpers
// =============================================================================

/** Build a minimal ExtendedTableDefinition for testing */
function makeTable(overrides: Partial<ExtendedTableDefinition> & { tableId: string; rows: ExtendedTableDefinition['rows'] }): ExtendedTableDefinition {
  return {
    questionId: 'Q1',
    questionText: 'Test question',
    tableType: 'frequency',
    sourceTableId: '',
    isDerived: false,
    exclude: false,
    excludeReason: '',
    surveySection: '',
    baseText: '',
    userNote: '',
    tableSubtitle: '',
    additionalFilter: '',
    filterReviewRequired: false,
    splitFromTableId: '',
    lastModifiedBy: 'FilterApplicator',
    ...overrides,
  };
}

/** Build rows for a grid: N variables × K values each */
function makeGridRows(variableCount: number, valuesPerVariable: number): ExtendedTableDefinition['rows'] {
  const rows: ExtendedTableDefinition['rows'] = [];
  for (let v = 1; v <= variableCount; v++) {
    const variable = `Q1r${v}`;
    for (let val = 1; val <= valuesPerVariable; val++) {
      rows.push({
        variable,
        label: `Item ${v} - Value ${val}`,
        filterValue: String(val),
        isNet: false,
        netComponents: [],
        indent: 0,
      });
    }
  }
  return rows;
}

/** Build a minimal VerboseDataMapType */
function makeDatamapEntry(column: string, description: string): VerboseDataMapType {
  return {
    level: 'sub',
    column,
    description,
    valueType: 'Nominal',
    answerOptions: '',
    parentQuestion: 'Q1',
  } as VerboseDataMapType;
}

// =============================================================================
// Tests
// =============================================================================

describe('GridAutoSplitter', () => {
  const originalEnv = process.env.GRID_SPLIT_THRESHOLD;

  afterEach(() => {
    // Restore env
    if (originalEnv === undefined) {
      delete process.env.GRID_SPLIT_THRESHOLD;
    } else {
      process.env.GRID_SPLIT_THRESHOLD = originalEnv;
    }
  });

  // ---------------------------------------------------------------------------
  // Pass-through cases
  // ---------------------------------------------------------------------------

  describe('pass-through', () => {
    it('passes through tables below threshold', () => {
      const rows = makeGridRows(10, 7); // 70 rows
      const table = makeTable({ tableId: 'q1', rows });
      const result = splitOversizedGrids([table]);

      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].tableId).toBe('q1');
      expect(result.actions).toHaveLength(0);
      expect(result.summary.tablesPassedThrough).toBe(1);
      expect(result.summary.tablesSplit).toBe(0);
    });

    it('passes through mean_rows tables even if above threshold', () => {
      const rows = makeGridRows(30, 7); // 210 rows
      const table = makeTable({ tableId: 'q1', rows, tableType: 'mean_rows' });
      const result = splitOversizedGrids([table]);

      expect(result.tables).toHaveLength(1);
      expect(result.tables[0].tableId).toBe('q1');
      expect(result.actions).toHaveLength(0);
    });

    it('passes through single-variable tables even if above threshold', () => {
      // All rows share the same variable name
      const rows: ExtendedTableDefinition['rows'] = [];
      for (let i = 1; i <= 150; i++) {
        rows.push({
          variable: 'Q1',
          label: `Value ${i}`,
          filterValue: String(i),
          isNet: false,
          netComponents: [],
          indent: 0,
        });
      }
      const table = makeTable({ tableId: 'q1', rows });
      const result = splitOversizedGrids([table]);

      expect(result.tables).toHaveLength(1);
      expect(result.actions).toHaveLength(0);
    });

    it('passes through tables at exactly the threshold', () => {
      const rows = makeGridRows(20, 7); // 140 rows exactly
      const table = makeTable({ tableId: 'q1', rows });
      const result = splitOversizedGrids([table]);

      expect(result.tables).toHaveLength(1);
      expect(result.actions).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Split cases
  // ---------------------------------------------------------------------------

  describe('splitting', () => {
    it('splits a basic grid into one sub-table per variable', () => {
      const rows = makeGridRows(30, 7); // 210 rows, 30 variables
      const table = makeTable({ tableId: 'b3', rows });
      const result = splitOversizedGrids([table]);

      expect(result.tables).toHaveLength(30);
      expect(result.actions).toHaveLength(1);
      expect(result.summary.tablesSplit).toBe(1);
      expect(result.summary.tablesPassedThrough).toBe(0);
      expect(result.summary.totalInput).toBe(1);
      expect(result.summary.totalOutput).toBe(30);

      // Each sub-table should have 7 rows
      for (const subTable of result.tables) {
        expect(subTable.rows).toHaveLength(7);
      }

      // Check first sub-table
      expect(result.tables[0].tableId).toBe('b3_q1r1');
      expect(result.tables[0].splitFromTableId).toBe('b3');
      expect(result.tables[0].lastModifiedBy).toBe('GridAutoSplitter');
    });

    it('preserves questionId and questionText', () => {
      const rows = makeGridRows(25, 7); // 175 rows
      const table = makeTable({
        tableId: 'b3',
        questionId: 'B3',
        questionText: 'Rate each treatment',
        rows,
      });
      const result = splitOversizedGrids([table]);

      for (const subTable of result.tables) {
        expect(subTable.questionId).toBe('B3');
        expect(subTable.questionText).toBe('Rate each treatment');
      }
    });

    it('generates tableSubtitle from datamap', () => {
      const rows = makeGridRows(25, 7);
      const table = makeTable({ tableId: 'b3', rows });

      const verboseDataMap: VerboseDataMapType[] = [
        makeDatamapEntry('Q1r1', 'Treatment Alpha'),
        makeDatamapEntry('Q1r2', 'Treatment Beta'),
      ];

      const result = splitOversizedGrids([table], { verboseDataMap });

      expect(result.tables[0].tableSubtitle).toBe('Q1r1: Treatment Alpha');
      expect(result.tables[1].tableSubtitle).toBe('Q1r2: Treatment Beta');
      // Variables not in datamap use the variable name as subtitle
      expect(result.tables[2].tableSubtitle).toBe('Q1r3');
    });
  });

  // ---------------------------------------------------------------------------
  // Filter field preservation
  // ---------------------------------------------------------------------------

  describe('filter field preservation', () => {
    it('preserves additionalFilter through split', () => {
      const rows = makeGridRows(25, 7);
      const table = makeTable({
        tableId: 'b3',
        rows,
        additionalFilter: 'S1 == 1',
        baseText: 'Doctors only',
        filterReviewRequired: true,
      });

      const result = splitOversizedGrids([table]);

      for (const subTable of result.tables) {
        expect(subTable.additionalFilter).toBe('S1 == 1');
        expect(subTable.baseText).toBe('Doctors only');
        expect(subTable.filterReviewRequired).toBe(true);
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Provenance chain
  // ---------------------------------------------------------------------------

  describe('provenance chain', () => {
    it('sets splitFromTableId to original tableId for fresh tables', () => {
      const rows = makeGridRows(25, 7);
      const table = makeTable({ tableId: 'b3', rows, splitFromTableId: '' });

      const result = splitOversizedGrids([table]);

      for (const subTable of result.tables) {
        expect(subTable.splitFromTableId).toBe('b3');
      }
    });

    it('chains splitFromTableId when already split by FilterApplicator', () => {
      const rows = makeGridRows(25, 7);
      const table = makeTable({
        tableId: 'b3_group_a',
        rows,
        splitFromTableId: 'b3',
      });

      const result = splitOversizedGrids([table]);

      // Should chain from the FilterApplicator split, not the original
      for (const subTable of result.tables) {
        expect(subTable.splitFromTableId).toBe('b3');
      }

      // Table IDs should chain from the FilterApplicator ID
      expect(result.tables[0].tableId).toBe('b3_group_a_q1r1');
    });
  });

  // ---------------------------------------------------------------------------
  // Custom threshold
  // ---------------------------------------------------------------------------

  describe('custom threshold', () => {
    it('respects threshold option', () => {
      const rows = makeGridRows(10, 7); // 70 rows
      const table = makeTable({ tableId: 'q1', rows });

      // Default threshold (140) — should not split
      const resultDefault = splitOversizedGrids([table]);
      expect(resultDefault.actions).toHaveLength(0);

      // Custom threshold of 50 — should split
      const resultCustom = splitOversizedGrids([table], { threshold: 50 });
      expect(resultCustom.actions).toHaveLength(1);
      expect(resultCustom.tables).toHaveLength(10);
    });

    it('respects GRID_SPLIT_THRESHOLD env var', () => {
      process.env.GRID_SPLIT_THRESHOLD = '60';

      const rows = makeGridRows(10, 7); // 70 rows
      const table = makeTable({ tableId: 'q1', rows });

      const result = splitOversizedGrids([table]);
      expect(result.actions).toHaveLength(1);
      expect(result.tables).toHaveLength(10);
    });

    it('option overrides env var', () => {
      process.env.GRID_SPLIT_THRESHOLD = '50';

      const rows = makeGridRows(10, 7); // 70 rows
      const table = makeTable({ tableId: 'q1', rows });

      // option threshold of 200 — should NOT split
      const result = splitOversizedGrids([table], { threshold: 200 });
      expect(result.actions).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Mixed input
  // ---------------------------------------------------------------------------

  describe('mixed input', () => {
    it('handles mix of splittable and non-splittable tables', () => {
      const smallTable = makeTable({ tableId: 'a1', rows: makeGridRows(5, 7) }); // 35 rows
      const bigTable = makeTable({ tableId: 'b3', rows: makeGridRows(30, 7) }); // 210 rows
      const meanTable = makeTable({ tableId: 'c1', rows: makeGridRows(30, 7), tableType: 'mean_rows' });

      const result = splitOversizedGrids([smallTable, bigTable, meanTable]);

      // smallTable (1) + bigTable split (30) + meanTable (1) = 32
      expect(result.tables).toHaveLength(32);
      expect(result.summary.tablesSplit).toBe(1);
      expect(result.summary.tablesPassedThrough).toBe(2);
      expect(result.actions).toHaveLength(1);
      expect(result.actions[0].originalTableId).toBe('b3');

      // Order preserved: small first, then 30 splits, then mean
      expect(result.tables[0].tableId).toBe('a1');
      expect(result.tables[1].tableId).toBe('b3_q1r1');
      expect(result.tables[31].tableId).toBe('c1');
    });
  });

  // ---------------------------------------------------------------------------
  // Action logging
  // ---------------------------------------------------------------------------

  describe('action logging', () => {
    it('logs correct action details', () => {
      const rows = makeGridRows(33, 7); // 231 rows, 33 variables
      const table = makeTable({ tableId: 'b3', rows });
      const result = splitOversizedGrids([table]);

      expect(result.actions).toHaveLength(1);
      const action = result.actions[0];
      expect(action.originalTableId).toBe('b3');
      expect(action.rowCount).toBe(231);
      expect(action.uniqueVariables).toBe(33);
      expect(action.subTablesCreated).toBe(33);
      expect(action.reason).toContain('231 rows');
      expect(action.reason).toContain('33 unique variables');
    });
  });
});
