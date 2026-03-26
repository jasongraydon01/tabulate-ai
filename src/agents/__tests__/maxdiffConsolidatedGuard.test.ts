import { describe, expect, it } from 'vitest';
import type { TableDefinition } from '../../schemas/tableAgentSchema';
import {
  toExtendedTable,
  type VerificationAgentOutput,
} from '../../schemas/verificationAgentSchema';
import { enforceConsolidatedMaxDiffGuard } from '../verification/maxdiffConsolidatedGuard';

function makeOriginalTable(): TableDefinition {
  return {
    tableId: 'maxdiff_anchprobind',
    questionText: 'API Scores (0-200)',
    tableType: 'mean_rows',
    rows: [
      { variable: 'AnchProbInd_1', label: 'API: Message 1', filterValue: '' },
      { variable: 'AnchProbInd_2', label: 'API: Message 2', filterValue: '' },
    ],
    hints: [],
  };
}

function makeOutput(tables: VerificationAgentOutput['tables']): VerificationAgentOutput {
  return {
    tables,
    changes: ['test'],
    confidence: 0.82,
    userSummary: 'Updated metadata.',
  };
}

describe('enforceConsolidatedMaxDiffGuard', () => {
  it('passes through valid single-table output unchanged', () => {
    const original = makeOriginalTable();
    const table = toExtendedTable(original, 'AnchProbInd');
    table.rows[0].label = 'API: Improved label 1';
    table.rows[1].label = 'API: Improved label 2';
    table.baseText = 'All respondents who completed the MaxDiff exercise';
    table.tableSubtitle = 'Anchored Probability Index';

    const output = makeOutput([table]);
    const result = enforceConsolidatedMaxDiffGuard(original, output);

    expect(result.adjusted).toBe(false);
    expect(result.output).toBe(output);
  });

  it('collapses split output back to one canonical table', () => {
    const original = makeOriginalTable();
    const t1 = toExtendedTable(original, 'AnchProbInd');
    t1.rows = [t1.rows[0]];
    t1.rows[0].label = 'Label from split table A';
    t1.baseText = 'Custom base';
    t1.tableSubtitle = 'Custom subtitle';

    const t2 = toExtendedTable(original, 'AnchProbInd');
    t2.rows = [t2.rows[1]];
    t2.rows[0].label = 'Label from split table B';

    const result = enforceConsolidatedMaxDiffGuard(original, makeOutput([t1, t2]));

    expect(result.adjusted).toBe(true);
    expect(result.reason).toContain('split_output:2');
    expect(result.output.tables).toHaveLength(1);
    expect(result.output.tables[0].tableId).toBe('maxdiff_anchprobind');
    expect(result.output.tables[0].rows.map(r => r.variable)).toEqual(['AnchProbInd_1', 'AnchProbInd_2']);
    expect(result.output.tables[0].rows.map(r => r.label)).toEqual([
      'Label from split table A',
      'Label from split table B',
    ]);
    expect(result.output.tables[0].baseText).toBe('Custom base');
    expect(result.output.tables[0].tableSubtitle).toBe('Custom subtitle');
  });

  it('removes invalid row shape changes (NET/filter edits/extra rows)', () => {
    const original = makeOriginalTable();
    const table = toExtendedTable(original, 'AnchProbInd');
    table.rows[0].isNet = true;
    table.rows[0].netComponents = ['AnchProbInd_1', 'AnchProbInd_2'];
    table.rows[0].indent = 1;
    table.rows[0].filterValue = '1';
    table.rows.push({
      variable: 'AnchProbInd_999',
      label: 'Unexpected row',
      filterValue: '',
      isNet: false,
      netComponents: [],
      indent: 0,
    });

    const result = enforceConsolidatedMaxDiffGuard(original, makeOutput([table]));

    expect(result.adjusted).toBe(true);
    expect(result.output.tables[0].rows).toHaveLength(2);
    expect(result.output.tables[0].rows.every(r => r.isNet === false)).toBe(true);
    expect(result.output.tables[0].rows.every(r => r.netComponents.length === 0)).toBe(true);
    expect(result.output.tables[0].rows.every(r => r.indent === 0)).toBe(true);
    expect(result.output.tables[0].rows.every(r => r.filterValue === '')).toBe(true);
  });
});
