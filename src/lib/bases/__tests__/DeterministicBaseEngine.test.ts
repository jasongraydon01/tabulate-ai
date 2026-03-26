import { describe, it, expect } from 'vitest';
import {
  buildTableSpecs,
  generateFilterExpression,
  generateSum100FilterExpression,
  buildDirectives,
} from '../DeterministicBaseEngine';
import { makeTable, makeRow } from '../../__tests__/fixtures';
import type { TableSpec, RAuditResult } from '../types';

describe('buildTableSpecs', () => {
  it('builds specs from tables with rows', () => {
    const tables = [
      makeTable({
        tableId: 'q5',
        questionId: 'Q5',
        rows: [
          makeRow({ variable: 'Q5' }),
          makeRow({ variable: 'Q5a' }),
        ],
      }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs).toHaveLength(1);
    expect(specs[0].tableId).toBe('q5');
    expect(specs[0].questionId).toBe('Q5');
    expect(specs[0].variables).toEqual(['Q5', 'Q5a']);
    expect(specs[0].rowGroups).toEqual([]);
    expect(specs[0].expectsSum100).toBe(false);
  });

  it('skips excluded tables', () => {
    const tables = [
      makeTable({ tableId: 'q1', questionId: 'Q1', exclude: true }),
      makeTable({ tableId: 'q2', questionId: 'Q2', exclude: false }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs).toHaveLength(1);
    expect(specs[0].tableId).toBe('q2');
  });

  it('skips tables without questionId', () => {
    const tables = [
      makeTable({ tableId: 'q1', questionId: '' }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs).toHaveLength(0);
  });

  it('skips NET rows', () => {
    const tables = [
      makeTable({
        tableId: 'q1',
        questionId: 'Q1',
        rows: [
          makeRow({ variable: 'Q1' }),
          makeRow({ variable: '_NET_top2box' }),
        ],
      }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs[0].variables).toEqual(['Q1']);
  });

  it('extracts row groups from rXcY pattern variables', () => {
    const tables = [
      makeTable({
        tableId: 'q5_grid',
        questionId: 'Q5',
        rows: [
          makeRow({ variable: 'Q5r1c1' }),
          makeRow({ variable: 'Q5r1c2' }),
          makeRow({ variable: 'Q5r1c3' }),
          makeRow({ variable: 'Q5r2c1' }),
          makeRow({ variable: 'Q5r2c2' }),
        ],
      }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs[0].rowGroups).toHaveLength(2);
    expect(specs[0].rowGroups[0].groupId).toBe('Q5r1');
    expect(specs[0].rowGroups[0].variables).toEqual(['Q5r1c1', 'Q5r1c2', 'Q5r1c3']);
    expect(specs[0].rowGroups[1].groupId).toBe('Q5r2');
    expect(specs[0].rowGroups[1].variables).toEqual(['Q5r2c1', 'Q5r2c2']);
  });

  it('ignores row groups with only 1 variable', () => {
    const tables = [
      makeTable({
        tableId: 'q5',
        questionId: 'Q5',
        rows: [
          makeRow({ variable: 'Q5r1c1' }), // Only 1 var in group → ignored
          makeRow({ variable: 'Q5_other' }),
        ],
      }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs[0].rowGroups).toHaveLength(0);
  });

  it('detects sum-to-100 cues in question text', () => {
    const tables = [
      makeTable({
        tableId: 'q10',
        questionId: 'Q10',
        questionText: 'Please allocate percentages that sum to 100%',
      }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs[0].expectsSum100).toBe(true);
  });

  it('detects sum-to-100 cues in userNote', () => {
    const tables = [
      makeTable({
        tableId: 'q10',
        questionId: 'Q10',
        questionText: 'How would you allocate?',
        userNote: '(Responses must sum to 100)',
      }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs[0].expectsSum100).toBe(true);
  });

  it('sorts specs by tableId', () => {
    const tables = [
      makeTable({ tableId: 'q5', questionId: 'Q5' }),
      makeTable({ tableId: 'q1', questionId: 'Q1' }),
      makeTable({ tableId: 'q3', questionId: 'Q3' }),
    ];

    const specs = buildTableSpecs(tables);
    expect(specs.map(s => s.tableId)).toEqual(['q1', 'q3', 'q5']);
  });
});

describe('generateFilterExpression', () => {
  it('generates single variable expression', () => {
    expect(generateFilterExpression(['Q1'])).toBe('!is.na(`Q1`)');
  });

  it('generates multi-variable OR expression', () => {
    const expr = generateFilterExpression(['Q5r1c1', 'Q5r1c2', 'Q5r1c3']);
    expect(expr).toBe('!is.na(`Q5r1c1`) | !is.na(`Q5r1c2`) | !is.na(`Q5r1c3`)');
  });

  it('returns empty string for empty array', () => {
    expect(generateFilterExpression([])).toBe('');
  });
});

describe('generateSum100FilterExpression', () => {
  it('generates complete-and-sum100 filter for row groups', () => {
    const expr = generateSum100FilterExpression(['Q5r1c1', 'Q5r1c2'], 5);
    expect(expr).toBe('(!is.na(`Q5r1c1`) & !is.na(`Q5r1c2`)) & (abs((as.numeric(`Q5r1c1`) + as.numeric(`Q5r1c2`)) - 100) <= 5)');
  });
});

describe('buildDirectives', () => {
  it('applies the 2% table gap threshold correctly', () => {
    const specs: TableSpec[] = [
      {
        tableId: 'q1',
        questionId: 'Q1',
        variables: ['Q1'],
        rowGroups: [],
        expectsSum100: false,
      },
    ];

    const metricsNoFilter: RAuditResult = {
      totalN: 100,
      tables: [
        {
          tableId: 'q1',
          questionId: 'Q1',
          varCount: 1,
          existingVarCount: 1,
          askedN: 99,
          completeN: 99,
          isNumericTable: false,
          tableSum100N: null,
          tableSum100RateAsked: null,
          tableSum100RateComplete: null,
          rowGroups: [],
        },
      ],
    };

    const metricsNeedsFilter: RAuditResult = {
      ...metricsNoFilter,
      tables: [{ ...metricsNoFilter.tables[0], askedN: 98, completeN: 98 }],
    };

    const thresholds = { baseGapPct: 2, rowGapPct: 2, sumCompleteMin: 0.9 };
    const noFilter = buildDirectives(specs, metricsNoFilter, thresholds);
    const needsFilter = buildDirectives(specs, metricsNeedsFilter, thresholds);

    expect(noFilter[0].tableGapPct).toBe(1);
    expect(noFilter[0].needsTableFilter).toBe(false);
    expect(noFilter[0].tableFilter).toBe('');

    expect(needsFilter[0].tableGapPct).toBe(2);
    expect(needsFilter[0].needsTableFilter).toBe(true);
    expect(needsFilter[0].tableFilter).toBe('!is.na(`Q1`)');
  });

  it('detects row-group split requirement when group asked% lags table asked% by threshold', () => {
    const specs: TableSpec[] = [
      {
        tableId: 'q5_grid',
        questionId: 'Q5',
        variables: ['Q5r1c1', 'Q5r1c2', 'Q5r2c1', 'Q5r2c2'],
        rowGroups: [
          { groupId: 'Q5r1', variables: ['Q5r1c1', 'Q5r1c2'] },
          { groupId: 'Q5r2', variables: ['Q5r2c1', 'Q5r2c2'] },
        ],
        expectsSum100: false,
      },
    ];

    const metrics: RAuditResult = {
      totalN: 100,
      tables: [
        {
          tableId: 'q5_grid',
          questionId: 'Q5',
          varCount: 4,
          existingVarCount: 4,
          askedN: 90, // table asked%
          completeN: 85,
          isNumericTable: false,
          tableSum100N: null,
          tableSum100RateAsked: null,
          tableSum100RateComplete: null,
          rowGroups: [
            {
              groupId: 'Q5r1',
              varCount: 2,
              existingVarCount: 2,
              askedN: 87, // 3pt lower than table asked%
              completeN: 84,
              isNumericGroup: false,
              sum100N: null,
              sum100RateAsked: null,
              sum100RateComplete: null,
            },
            {
              groupId: 'Q5r2',
              varCount: 2,
              existingVarCount: 2,
              askedN: 89, // 1pt lower than table asked%
              completeN: 86,
              isNumericGroup: false,
              sum100N: null,
              sum100RateAsked: null,
              sum100RateComplete: null,
            },
          ],
        },
      ],
    };

    const [directive] = buildDirectives(specs, metrics, { baseGapPct: 2, rowGapPct: 2, sumCompleteMin: 0.9 });
    expect(directive.needsRowSplit).toBe(true);

    const row1 = directive.rowGroups.find((rg) => rg.groupId === 'Q5r1');
    const row2 = directive.rowGroups.find((rg) => rg.groupId === 'Q5r2');
    expect(row1?.gapVsTable).toBe(3);
    expect(row1?.filter).toBe('!is.na(`Q5r1c1`) | !is.na(`Q5r1c2`)');
    expect(row2?.gapVsTable).toBe(1);
  });

  it('uses sum-to-100 row-group filters for numeric sum tables', () => {
    const specs: TableSpec[] = [
      {
        tableId: 'q10_grid',
        questionId: 'Q10',
        variables: ['Q10r1c1', 'Q10r1c2', 'Q10r2c1', 'Q10r2c2'],
        rowGroups: [
          { groupId: 'Q10r1', variables: ['Q10r1c1', 'Q10r1c2'] },
          { groupId: 'Q10r2', variables: ['Q10r2c1', 'Q10r2c2'] },
        ],
        expectsSum100: true,
      },
    ];

    const metrics: RAuditResult = {
      totalN: 100,
      tables: [
        {
          tableId: 'q10_grid',
          questionId: 'Q10',
          varCount: 4,
          existingVarCount: 4,
          askedN: 90,
          completeN: 90,
          isNumericTable: true,
          tableSum100N: 80,
          tableSum100RateAsked: 0.89,
          tableSum100RateComplete: 0.89,
          rowGroups: [
            {
              groupId: 'Q10r1',
              varCount: 2,
              existingVarCount: 2,
              askedN: 80,
              completeN: 80,
              isNumericGroup: true,
              sum100N: 76,
              sum100RateAsked: 0.95,
              sum100RateComplete: 0.95,
            },
            {
              groupId: 'Q10r2',
              varCount: 2,
              existingVarCount: 2,
              askedN: 88,
              completeN: 88,
              isNumericGroup: true,
              sum100N: 84,
              sum100RateAsked: 0.955,
              sum100RateComplete: 0.955,
            },
          ],
        },
      ],
    };

    const [directive] = buildDirectives(
      specs,
      metrics,
      { baseGapPct: 2, rowGapPct: 2, sumCompleteMin: 0.9, sumTolerance: 5 },
    );

    const row1 = directive.rowGroups.find((rg) => rg.groupId === 'Q10r1');
    expect(row1?.filter).toBe(
      '(!is.na(`Q10r1c1`) & !is.na(`Q10r1c2`)) & (abs((as.numeric(`Q10r1c1`) + as.numeric(`Q10r1c2`)) - 100) <= 5)'
    );
  });

  it('uses sum-to-100 filter for Qb follow-up row groups based on data signal alone', () => {
    const specs: TableSpec[] = [
      {
        tableId: 'a3b',
        questionId: 'A3b',
        variables: ['A3br1c1', 'A3br1c2'],
        rowGroups: [{ groupId: 'A3br1', variables: ['A3br1c1', 'A3br1c2'] }],
        expectsSum100: false,
      },
    ];

    const metrics: RAuditResult = {
      totalN: 100,
      tables: [
        {
          tableId: 'a3b',
          questionId: 'A3b',
          varCount: 2,
          existingVarCount: 2,
          askedN: 80,
          completeN: 80,
          isNumericTable: true,
          tableSum100N: null,
          tableSum100RateAsked: null,
          tableSum100RateComplete: null,
          rowGroups: [
            {
              groupId: 'A3br1',
              varCount: 2,
              existingVarCount: 2,
              askedN: 80,
              completeN: 80,
              isNumericGroup: true,
              sum100N: 78,
              sum100RateAsked: 0.975,
              sum100RateComplete: 0.975,
            },
          ],
        },
      ],
    };

    const [directive] = buildDirectives(
      specs,
      metrics,
      { baseGapPct: 2, rowGapPct: 2, sumCompleteMin: 0.9, sumTolerance: 5 },
    );

    // No naming-convention heuristic — purely data-driven sum-to-100 filter
    expect(directive.rowGroups[0].filter).toBe(
      '(!is.na(`A3br1c1`) & !is.na(`A3br1c2`)) & (abs((as.numeric(`A3br1c1`) + as.numeric(`A3br1c2`)) - 100) <= 5)'
    );
  });
});
