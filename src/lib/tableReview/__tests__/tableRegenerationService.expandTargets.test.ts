import { describe, expect, it } from 'vitest';
import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';
import { expandRegenerationTargets } from '../tableRegenerationService';

function makeTable(tableId: string, sourceTableId = ''): ExtendedTableDefinition {
  return {
    tableId,
    questionId: tableId.toUpperCase(),
    questionText: `Question ${tableId}`,
    tableType: 'frequency',
    rows: [
      {
        variable: `${tableId}_v1`,
        label: 'Option 1',
        filterValue: '1',
        isNet: false,
        netComponents: [],
        indent: 0,
      },
    ],
    sourceTableId,
    isDerived: sourceTableId.length > 0,
    exclude: false,
    excludeReason: '',
    surveySection: '',
    baseText: '',
    userNote: '',
    tableSubtitle: '',
    additionalFilter: '',
    filterReviewRequired: false,
    splitFromTableId: '',
    lastModifiedBy: 'VerificationAgent',
  };
}

describe('expandRegenerationTargets', () => {
  it('keeps explicitly requested table IDs even when missing from verified tables', () => {
    const targets = expandRegenerationTargets(
      [{ tableId: 'missing_table', feedback: 'Fix wording' }],
      [makeTable('t1')],
    );

    expect(targets).toEqual([
      { tableId: 'missing_table', feedback: 'Fix wording' },
    ]);
  });

  it('expands related tables when includeRelated=true', () => {
    const verified = [
      makeTable('q1'),
      makeTable('q1_t2b', 'q1'),
      makeTable('q1_b2b', 'q1'),
      makeTable('q2'),
    ];

    const targets = expandRegenerationTargets(
      [{ tableId: 'q1', feedback: 'Add NET labels', includeRelated: true }],
      verified,
    );

    expect(targets.map((t) => t.tableId)).toEqual(['q1', 'q1_t2b', 'q1_b2b']);
    expect(new Set(targets.map((t) => t.feedback))).toEqual(
      new Set(['Add NET labels']),
    );
  });

  it('deduplicates overlapping requests and keeps first-seen feedback for a table', () => {
    const verified = [
      makeTable('q1'),
      makeTable('q1_t2b', 'q1'),
    ];

    const targets = expandRegenerationTargets(
      [
        { tableId: 'q1', feedback: 'First note', includeRelated: true },
        { tableId: 'q1_t2b', feedback: 'Second note', includeRelated: false },
      ],
      verified,
    );

    expect(targets).toEqual([
      { tableId: 'q1', feedback: 'First note' },
      { tableId: 'q1_t2b', feedback: 'First note' },
    ]);
  });
});
