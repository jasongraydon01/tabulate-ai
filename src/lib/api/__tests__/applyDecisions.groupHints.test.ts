import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { FlaggedCrosstabColumn } from '@/lib/api/types';
import { applyDecisions } from '@/lib/api/reviewCompletion';
import type { CrosstabDecision } from '@/schemas/crosstabDecisionSchema';

vi.mock('@/lib/convex', () => ({
  getConvexClient: vi.fn(() => ({ query: vi.fn() })),
  mutateInternal: vi.fn(async () => {}),
}));

// Track processGroup calls to verify group hint behavior
const processGroupMock = vi.fn(async (_dataMap: unknown, group: { groupName: string; columns: Array<{ name: string }> }) => ({
  groupName: group.groupName,
  columns: group.columns.map(col => ({
    name: col.name,
    adjusted: `group_hinted_${col.name}`,
    confidence: 0.95,
    reasoning: 'group hint applied',
    userSummary: 'updated via group hint',
    alternatives: [],
    uncertainties: [],
    expressionType: 'direct_variable' as const,
  })),
}));

vi.mock('@/agents/CrosstabAgent', () => ({
  processGroup: (...args: unknown[]) => processGroupMock(...args as Parameters<typeof processGroupMock>),
}));

function makeColumn(name: string, adjusted: string, confidence: number) {
  return {
    name,
    adjusted,
    confidence,
    reasoning: `reasoning for ${name}`,
    userSummary: `summary for ${name}`,
    alternatives: [] as Array<{ expression: string; reasoning: string; userSummary: string; rank: number }>,
    uncertainties: [] as string[],
    expressionType: 'direct_variable' as const,
  };
}

function makeFlagged(groupName: string, name: string, proposed: string): FlaggedCrosstabColumn {
  return {
    groupName,
    columnName: name,
    original: name,
    proposed,
    confidence: 0.7,
    reasoning: 'flagged reasoning',
    userSummary: 'flagged summary',
    alternatives: [],
    uncertainties: [],
    expressionType: 'direct_variable',
  };
}

const dataMap = [{ Column: 'Q1', Description: 'Question 1', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' }];

describe('applyDecisions with group hints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('applies group hint to columns without explicit per-column decisions', async () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [{
        groupName: 'Demographics',
        columns: [
          makeColumn('Q1', 'Q1 == 1', 0.7),
          makeColumn('Q2', 'Q2 == 2', 0.6),
          makeColumn('Q3', 'Q3 == 3', 0.8),
        ],
      }],
    };

    const flaggedColumns: FlaggedCrosstabColumn[] = [
      makeFlagged('Demographics', 'Q1', 'Q1 == 1'),
      makeFlagged('Demographics', 'Q2', 'Q2 == 2'),
      makeFlagged('Demographics', 'Q3', 'Q3 == 3'),
    ];

    // Only approve Q1 — no per-column decisions for Q2 and Q3
    const decisions: CrosstabDecision[] = [
      { groupName: 'Demographics', columnName: 'Q1', action: 'approve' },
    ];

    const groupHints = [{ groupName: 'Demographics', hint: 'Use full value ranges' }];

    const result = await applyDecisions(
      crosstabResult, flaggedColumns, decisions, dataMap, '/tmp/out',
      undefined, undefined, undefined, groupHints,
    );

    // processGroup should be called once with all 3 columns (Q1 is approve, which is eligible for group hint)
    expect(processGroupMock).toHaveBeenCalledTimes(1);
    const callArgs = processGroupMock.mock.calls[0];
    const groupArg = callArgs[1] as { columns: Array<{ name: string }> };
    expect(groupArg.columns).toHaveLength(3);
    expect(groupArg.columns.map((c: { name: string }) => c.name)).toEqual(['Q1', 'Q2', 'Q3']);

    // All 3 columns should be in the result (group-hinted)
    expect(result.modifiedResult.bannerCuts).toHaveLength(1);
    expect(result.modifiedResult.bannerCuts[0].columns).toHaveLength(3);
  });

  it('excludes columns with explicit non-approve actions from group hint batch', async () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [{
        groupName: 'Location',
        columns: [
          makeColumn('Q1', 'Q1 == 1', 0.7),
          makeColumn('Q2', 'Q2 == 2', 0.6),
          makeColumn('Q3', 'Q3 == 3', 0.5),
        ],
      }],
    };

    const flaggedColumns: FlaggedCrosstabColumn[] = [
      makeFlagged('Location', 'Q1', 'Q1 == 1'),
      makeFlagged('Location', 'Q2', 'Q2 == 2'),
      makeFlagged('Location', 'Q3', 'Q3 == 3'),
    ];

    // Q2 has an explicit edit action — should NOT be in the group hint batch
    const decisions: CrosstabDecision[] = [
      { groupName: 'Location', columnName: 'Q2', action: 'edit', editedExpression: 'Q2 >= 5' },
    ];

    const groupHints = [{ groupName: 'Location', hint: 'Use location variables' }];

    const result = await applyDecisions(
      crosstabResult, flaggedColumns, decisions, dataMap, '/tmp/out',
      undefined, undefined, undefined, groupHints,
    );

    // processGroup should be called once with Q1 and Q3 (Q2 excluded due to explicit edit)
    expect(processGroupMock).toHaveBeenCalledTimes(1);
    const callArgs = processGroupMock.mock.calls[0];
    const groupArg = callArgs[1] as { columns: Array<{ name: string }> };
    expect(groupArg.columns).toHaveLength(2);
    expect(groupArg.columns.map((c: { name: string }) => c.name)).toEqual(['Q1', 'Q3']);

    // All 3 columns should still end up in the result
    const resultCols = result.modifiedResult.bannerCuts[0].columns;
    expect(resultCols).toHaveLength(3);

    // Q2 should have the edited expression (not group-hinted)
    const q2 = resultCols.find(c => c.name === 'Q2');
    expect(q2?.adjusted).toBe('Q2 >= 5');
  });

  it('does not call processGroup when no group hint is provided', async () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [{
        groupName: 'G1',
        columns: [makeColumn('Q1', 'Q1 == 1', 0.9)],
      }],
    };

    const decisions: CrosstabDecision[] = [
      { groupName: 'G1', columnName: 'Q1', action: 'approve' },
    ];

    await applyDecisions(
      crosstabResult, [], decisions, dataMap, '/tmp/out',
    );

    // No group hints → no AI re-run
    expect(processGroupMock).not.toHaveBeenCalled();
  });

  it('tags group-hinted columns with hint_applied provenance', async () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [{
        groupName: 'G1',
        columns: [makeColumn('Q1', 'Q1 == 1', 0.7)],
      }],
    };

    const groupHints = [{ groupName: 'G1', hint: 'Capture both loops' }];

    const result = await applyDecisions(
      crosstabResult, [], [], dataMap, '/tmp/out',
      undefined, undefined, undefined, groupHints,
    );

    const col = result.modifiedResult.bannerCuts[0].columns[0] as Record<string, unknown>;
    expect(col.reviewAction).toBe('hint_applied');
    expect(col.reviewHint).toBe('Capture both loops');
  });

  it('returns hintErrors when group hint processGroup fails', async () => {
    processGroupMock.mockRejectedValueOnce(new Error('AI call failed'));

    const crosstabResult: ValidationResultType = {
      bannerCuts: [{
        groupName: 'G1',
        columns: [
          makeColumn('Q1', 'Q1 == 1', 0.7),
          makeColumn('Q2', 'Q2 == 2', 0.6),
        ],
      }],
    };

    const groupHints = [{ groupName: 'G1', hint: 'Bad hint' }];

    const result = await applyDecisions(
      crosstabResult, [], [], dataMap, '/tmp/out',
      undefined, undefined, undefined, groupHints,
    );

    // Both columns should have hint errors
    expect(result.hintErrors).toHaveLength(2);
    expect(result.hintErrors[0].error).toBe('AI call failed');
    expect(result.hintErrors[1].error).toBe('AI call failed');

    // Columns should fall through to regular processing (approved as-is)
    expect(result.modifiedResult.bannerCuts[0].columns).toHaveLength(2);
  });

  it('rejects non-selectable alternatives before applying decisions', async () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [{
        groupName: 'G1',
        columns: [makeColumn('Q1', 'Q1 == 1', 0.7)],
      }],
    };

    const flaggedColumns: FlaggedCrosstabColumn[] = [{
      ...makeFlagged('G1', 'Q1', 'Q1 == 1'),
      alternatives: [{
        expression: 'Teacher audience',
        rank: 5,
        userSummary: 'Original banner expression shown for reviewer reference.',
        selectable: false,
        nonSelectableReason: 'Original banner expression could not be confirmed as a valid executable fallback.',
        source: 'literal_original',
      }],
    }];

    await expect(applyDecisions(
      crosstabResult,
      flaggedColumns,
      [{ groupName: 'G1', columnName: 'Q1', action: 'select_alternative', selectedAlternative: 0 }],
      dataMap,
      '/tmp/out',
    )).rejects.toThrow('cannot be selected');
  });
});
