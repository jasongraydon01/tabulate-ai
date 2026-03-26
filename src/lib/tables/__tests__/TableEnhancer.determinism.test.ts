import { describe, expect, it } from 'vitest';
import { enhanceTables } from '../TableEnhancer';
import { deterministicHash } from '../enhancerDeterminism';
import { makeTable, makeRow } from '../../__tests__/fixtures';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';

const verbose: VerboseDataMapType[] = [
  {
    level: 'sub',
    column: 'Q3',
    description: 'Ranking item',
    valueType: 'Values: 1-3',
    answerOptions: '',
    parentQuestion: 'Q3',
    normalizedType: 'categorical_select',
    allowedValues: [1, 2, 3],
  } as VerboseDataMapType,
];

describe('TableEnhancer determinism', () => {
  it('produces identical output hashes across repeated runs', () => {
    const table = makeTable({
      tableId: 'q3',
      questionId: 'Q3',
      questionText: 'Please rank these options',
      rows: [
        makeRow({ variable: 'Q3_a', label: 'A', filterValue: '1' }),
        makeRow({ variable: 'Q3_a', label: 'A', filterValue: '2' }),
        makeRow({ variable: 'Q3_b', label: 'B', filterValue: '1' }),
        makeRow({ variable: 'Q3_b', label: 'B', filterValue: '2' }),
      ],
      lastModifiedBy: 'FilterApplicator',
    });

    const runs = Array.from({ length: 5 }, () =>
      enhanceTables({ tables: [table], verboseDataMap: verbose }),
    );

    const hashes = runs.map((run) => deterministicHash({ tables: run.tables, report: run.report }));
    expect(hashes.every((hash) => hash === hashes[0])).toBe(true);
  });

  it('is idempotent on structure for enhanced output', () => {
    const table = makeTable({
      tableId: 'q4',
      questionId: 'Q4',
      rows: [
        makeRow({ variable: 'Q4', label: '1', filterValue: '1' }),
        makeRow({ variable: 'Q4', label: '2', filterValue: '2' }),
        makeRow({ variable: 'Q4', label: '3', filterValue: '3' }),
        makeRow({ variable: 'Q4', label: '4', filterValue: '4' }),
        makeRow({ variable: 'Q4', label: '5', filterValue: '5' }),
      ],
      lastModifiedBy: 'FilterApplicator',
    });

    const first = enhanceTables({ tables: [table], verboseDataMap: verbose });
    const second = enhanceTables({ tables: first.tables, verboseDataMap: verbose });

    expect(deterministicHash(first.tables)).toBe(deterministicHash(second.tables));
  });
});
