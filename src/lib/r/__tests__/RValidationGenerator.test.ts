import { describe, it, expect } from 'vitest';
import { generateSingleTableValidationScript } from '../RValidationGenerator';
import { makeTable, makeRow } from '../../__tests__/fixtures';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';
import type { CutDefinition } from '../../tables/CutsSpec';
import type { LoopGroupMapping } from '../../validation/LoopCollapser';

function withLoopFrame(table: ReturnType<typeof makeTable>): TableWithLoopFrame {
  return { ...table, loopDataFrame: '' };
}

describe('RValidationGenerator', () => {
  it('emits guard helpers before stacked-loop cuts and does not hard-reset cut errors', () => {
    const table = withLoopFrame(makeTable({
      tableId: 'loop_validation',
      rows: [makeRow({ variable: 'Q1r1', filterValue: '1' })],
    }));
    table.loopDataFrame = 'stacked_loop_1';

    const cuts: CutDefinition[] = [{
      id: 'cut_a',
      name: 'Low',
      rExpression: 'S12 < quantile(S12, probs = 0.33, na.rm = TRUE)',
      statLetter: 'A',
      groupName: 'Demo',
      groupIndex: 0,
      reviewAction: 'ai_original',
      reviewHint: '',
      preReviewExpression: '',
    }];

    const loopMappings: LoopGroupMapping[] = [{
      skeleton: 'Q-N-r-N',
      stackedFrameName: 'stacked_loop_1',
      iterations: ['1', '2'],
      variables: [{
        baseName: 'Q1r1',
        label: 'Q1 Row 1',
        iterationColumns: { '1': 'Q1_1r1', '2': 'Q1_2r1' },
      }],
    }];

    const result = generateSingleTableValidationScript(
      table,
      cuts,
      'dataFile.sav',
      'validation/result-loop_validation.json',
      loopMappings
    );

    const stackedCutsIdx = result.script.indexOf('cuts_stacked_loop_1 <- list(');
    const errorGuardIdx = result.script.indexOf('if (!exists(".hawktab_cut_errors", inherits = FALSE)) .hawktab_cut_errors <- c()');
    const quantileGuardIdx = result.script.indexOf('if (!exists("safe_quantile", mode = "function")) safe_quantile <- function(x, ...) quantile(as.numeric(x), ...)');
    expect(stackedCutsIdx).toBeGreaterThan(-1);
    expect(errorGuardIdx).toBeGreaterThan(-1);
    expect(quantileGuardIdx).toBeGreaterThan(-1);
    expect(errorGuardIdx).toBeLessThan(stackedCutsIdx);
    expect(quantileGuardIdx).toBeLessThan(stackedCutsIdx);

    // Guarded init is allowed; unconditional reset would drop earlier stacked-cut errors.
    expect(result.script).not.toMatch(/^\s*\.hawktab_cut_errors <- c\(\)\s*$/m);
  });
});
