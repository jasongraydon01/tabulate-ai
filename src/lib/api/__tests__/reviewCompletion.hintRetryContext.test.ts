import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { FlaggedCrosstabColumn } from '@/lib/api/types';
import { applyDecisions } from '@/lib/api/reviewCompletion';
import type { CrosstabDecision } from '@/schemas/crosstabDecisionSchema';

vi.mock('@/lib/convex', () => ({
  getConvexClient: vi.fn(() => ({ query: vi.fn() })),
  mutateInternal: vi.fn(async () => {}),
}));

vi.mock('@/agents/CrosstabAgent', () => ({
  processGroup: vi.fn(async () => ({
    groupName: 'Group A',
    columns: [
      {
        name: 'Column A',
        adjusted: 'Q1 == 1',
        confidence: 0.95,
        reasoning: 'updated',
        userSummary: 'updated',
        alternatives: [],
        uncertainties: [],
        expressionType: 'direct_variable',
      },
    ],
  })),
}));

import { processGroup } from '@/agents/CrosstabAgent';

describe('reviewCompletion hint retry context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes previousResult and scratchpad context into processGroup for provide_hint', async () => {
    const crosstabResult: ValidationResultType = {
      bannerCuts: [
        {
          groupName: 'Group A',
          columns: [
            {
              name: 'Column A',
              adjusted: 'Q1 == 1',
              confidence: 0.7,
              reasoning: 'orig reasoning',
              userSummary: 'orig summary',
              alternatives: [],
              uncertainties: [],
              expressionType: 'direct_variable',
            },
          ],
        },
      ],
    };

    const flaggedColumns: FlaggedCrosstabColumn[] = [
      {
        groupName: 'Group A',
        columnName: 'Column A',
        original: 'Q1==1',
        proposed: 'Q1 == 1',
        confidence: 0.7,
        reasoning: 'orig reasoning',
        userSummary: 'orig summary',
        alternatives: [],
        uncertainties: ['check code'],
        expressionType: 'direct_variable',
      },
    ];

    const decisions: CrosstabDecision[] = [
      {
        groupName: 'Group A',
        columnName: 'Column A',
        action: 'provide_hint',
        hint: 'Use exact value label mapping',
      },
    ];

    const result = await applyDecisions(
      crosstabResult,
      flaggedColumns,
      decisions,
      [{ Column: 'Q1', Description: 'Question 1', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' }],
      '/tmp/out',
      {
        'Group A': [
          {
            timestamp: '2026-02-18T00:00:00.000Z',
            action: 'add',
            content: 'Reviewed Q1 before mapping.',
          },
        ],
      },
    );

    // Result now returns ApplyDecisionsResult with modifiedResult + hintErrors
    expect(result.modifiedResult).toBeDefined();
    expect(result.hintErrors).toBeDefined();
    expect(vi.mocked(processGroup)).toHaveBeenCalledTimes(1);
    const options = vi.mocked(processGroup).mock.calls[0]?.[2] as {
      previousResult?: unknown;
      previousAttemptContext?: { priorScratchpadEntries?: Array<{ content: string }> };
    };
    expect(options.previousResult).toBeDefined();
    expect(options.previousAttemptContext).toBeDefined();
    expect(options.previousAttemptContext?.priorScratchpadEntries?.[0]?.content).toContain('Reviewed Q1');
  });
});
