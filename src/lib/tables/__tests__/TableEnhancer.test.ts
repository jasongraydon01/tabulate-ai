import { describe, expect, it } from 'vitest';
import { enhanceTables } from '../TableEnhancer';
import { makeTable, makeRow } from '../../__tests__/fixtures';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';

function makeVerbose(overrides: Partial<VerboseDataMapType> & { column: string }): VerboseDataMapType {
  return {
    level: 'sub',
    column: overrides.column,
    description: overrides.description || overrides.column,
    valueType: overrides.valueType || 'Values: 1-5',
    answerOptions: overrides.answerOptions || '',
    parentQuestion: overrides.parentQuestion || 'Q1',
    normalizedType: overrides.normalizedType,
    allowedValues: overrides.allowedValues,
    scaleLabels: overrides.scaleLabels,
  } as VerboseDataMapType;
}

function makeRepeatingRows(variables: string[], filterValues: string[]): ReturnType<typeof makeRow>[] {
  const rows: ReturnType<typeof makeRow>[] = [];
  for (const variable of variables) {
    for (const filterValue of filterValues) {
      rows.push(makeRow({ variable, filterValue, label: `Value ${filterValue}` }));
    }
  }
  return rows;
}

describe('TableEnhancer', () => {
  it('adds scale rollups and emits enhancement report', () => {
    const table = makeTable({
      tableId: 'q1',
      questionId: 'Q1',
      tableType: 'frequency',
      rows: [
        makeRow({ variable: 'Q1', label: 'Very dissatisfied', filterValue: '1' }),
        makeRow({ variable: 'Q1', label: 'Dissatisfied', filterValue: '2' }),
        makeRow({ variable: 'Q1', label: 'Neutral', filterValue: '3' }),
        makeRow({ variable: 'Q1', label: 'Satisfied', filterValue: '4' }),
        makeRow({ variable: 'Q1', label: 'Very satisfied', filterValue: '5' }),
      ],
      lastModifiedBy: 'FilterApplicator',
    });

    const verbose: VerboseDataMapType[] = [
      makeVerbose({
        column: 'Q1',
        normalizedType: 'ordinal_scale',
        allowedValues: [1, 2, 3, 4, 5],
      }),
    ];

    const result = enhanceTables({ tables: [table], verboseDataMap: verbose });

    expect(result.tables.length).toBeGreaterThan(1);
    expect(result.report.scaleEnrichments).toBe(1);
    expect(result.report.tablesCreated).toBe(result.tables.length);
    expect(result.report.ruleApplications).toHaveLength(1);
    expect(result.tables[0].rows.some((row) => /Top 2 Box/i.test(row.label))).toBe(true);
  });

  it('creates a deterministic any-net for binary flag families', () => {
    const table = makeTable({
      tableId: 'q2',
      questionId: 'Q2',
      rows: [
        makeRow({ variable: 'Q2_a', label: 'Option A', filterValue: '1' }),
        makeRow({ variable: 'Q2_b', label: 'Option B', filterValue: '1' }),
      ],
      lastModifiedBy: 'FilterApplicator',
    });

    const verbose: VerboseDataMapType[] = [
      makeVerbose({ column: 'Q2_a', normalizedType: 'binary_flag', valueType: 'Values: 0-1' }),
      makeVerbose({ column: 'Q2_b', normalizedType: 'binary_flag', valueType: 'Values: 0-1' }),
    ];

    const result = enhanceTables({ tables: [table], verboseDataMap: verbose });

    expect(result.report.netsCreated).toBe(1);
    expect(result.tables[0].rows[0].isNet).toBe(true);
    expect(result.tables[0].rows[0].netComponents).toEqual(['Q2_a', 'Q2_b']);
    expect(result.tables[0].rows[0].variable).toContain('_NET_Q2_Any');
  });

  it('does not apply scale rollups to nominal categorical labels with contiguous numeric codes', () => {
    const table = makeTable({
      tableId: 's2',
      questionId: 'S2',
      questionText: 'What is your primary specialty?',
      tableType: 'frequency',
      rows: [
        makeRow({ variable: 'S2', label: 'Cardiologist', filterValue: '1' }),
        makeRow({ variable: 'S2', label: 'Internal Medicine', filterValue: '2' }),
        makeRow({ variable: 'S2', label: 'Nephrologist', filterValue: '3' }),
        makeRow({ variable: 'S2', label: 'Endocrinologist', filterValue: '4' }),
        makeRow({ variable: 'S2', label: 'Lipidologist', filterValue: '5' }),
        makeRow({ variable: 'S2', label: 'Nurse Practitioner', filterValue: '6' }),
        makeRow({ variable: 'S2', label: 'Physician Assistant', filterValue: '7' }),
      ],
      lastModifiedBy: 'FilterApplicator',
    });

    const verbose: VerboseDataMapType[] = [
      makeVerbose({
        column: 'S2',
        normalizedType: 'categorical_select',
        allowedValues: [1, 2, 3, 4, 5, 6, 7],
      }),
    ];

    const result = enhanceTables({ tables: [table], verboseDataMap: verbose });
    expect(result.tables[0].rows.some((row) => /Top 2 Box|Bottom 2 Box|Middle 3 Box/i.test(row.label))).toBe(false);
  });

  it('creates detail splits for repeating sub-variable families (r# without c#)', () => {
    const variables = ['A1r1', 'A1r2', 'A1r3', 'A1r4'];
    const table = makeTable({
      tableId: 'a1',
      questionId: 'A1',
      tableType: 'frequency',
      rows: makeRepeatingRows(variables, ['1', '2']),
      lastModifiedBy: 'FilterApplicator',
    });

    const verbose: VerboseDataMapType[] = variables.map((variable, index) =>
      makeVerbose({
        column: variable,
        description: `Product ${index + 1}`,
      }),
    );

    const result = enhanceTables({ tables: [table], verboseDataMap: verbose });
    const details = result.tables.filter((candidate) => candidate.tableId.startsWith('a1_detail_'));

    expect(details).toHaveLength(4);
    expect(details[0].rows).toHaveLength(2);
    expect(details[0].tableSubtitle).toContain('Product 1');
    expect(result.report.gridSplits).toBe(1);
  });

  it('allows full detail coverage for medium structured grids', () => {
    const variables: string[] = [];
    for (let row = 1; row <= 5; row++) {
      for (let col = 1; col <= 3; col++) {
        variables.push(`A8r${row}c${col}`);
      }
    }

    const table = makeTable({
      tableId: 'a8',
      questionId: 'A8',
      tableType: 'frequency',
      rows: makeRepeatingRows(variables, ['1', '2', '3', '4', '5']),
      lastModifiedBy: 'FilterApplicator',
    });

    const verbose: VerboseDataMapType[] = variables.map((variable) =>
      makeVerbose({
        column: variable,
        description: `${variable} description`,
      }),
    );

    const result = enhanceTables({ tables: [table], verboseDataMap: verbose });
    const detailTables = result.tables.filter((candidate) => candidate.tableId.startsWith('a8_detail_'));
    const comparison = result.tables.find((candidate) => candidate.tableId === 'a8_comp_t2b');

    expect(detailTables).toHaveLength(15);
    expect(comparison).toBeTruthy();
  });

  it('keeps single-row mean tables included and preserves derived bin inclusion state', () => {
    const table = makeTable({
      tableId: 's10',
      questionId: 'S10',
      questionText: 'How many adult patients do you manage monthly?',
      tableType: 'mean_rows',
      rows: [makeRow({ variable: 'S10', filterValue: '' })],
      lastModifiedBy: 'FilterApplicator',
    });

    const verbose: VerboseDataMapType[] = [
      makeVerbose({
        column: 'S10',
        normalizedType: 'numeric_range',
        valueType: 'Values: 56-999',
      }),
    ];

    const result = enhanceTables({
      tables: [table],
      verboseDataMap: verbose,
      tableMetaContext: {
        s10: {
          itemCount: 1,
          rowCount: 1,
          distribution: {
            n: 100,
            min: 56,
            max: 999,
            mean: 350,
            median: 320,
            q1: 200,
            q3: 500,
          },
        },
      },
    });

    const base = result.tables.find((t) => t.tableId === 's10');
    const binned = result.tables.find((t) => t.tableId === 's10_binned');
    expect(base?.exclude).toBe(false);
    expect(binned?.exclude).toBe(false);
  });
});
