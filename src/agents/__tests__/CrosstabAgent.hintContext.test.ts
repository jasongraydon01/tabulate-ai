import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  tool: vi.fn((def) => def),
  Output: {
    object: vi.fn(() => ({})),
  },
  stepCountIs: vi.fn(() => undefined),
}));

vi.mock('../../lib/env', () => ({
  getCrosstabModel: vi.fn(() => 'mock-model'),
  getCrosstabModelName: vi.fn(() => 'mock-model'),
  getCrosstabModelTokenLimit: vi.fn(() => 4096),
  getCrosstabReasoningEffort: vi.fn(() => 'high'),
  getPromptVersions: vi.fn(() => ({ crosstabPromptVersion: 'production' })),
  getGenerationConfig: vi.fn(() => ({ parallelToolCalls: true })),
  getGenerationSamplingParams: vi.fn(() => ({})),
}));

vi.mock('../../lib/retryWithPolicyHandling', () => ({
  retryWithPolicyHandling: vi.fn(async (fn: (ctx: unknown) => Promise<unknown>) => ({
    success: true,
    result: await fn({
      attempt: 1,
      maxAttempts: 10,
      lastClassification: 'non_retryable',
      lastErrorSummary: '',
      shouldUsePolicySafeVariant: false,
      isFinalAttempt: false,
      consecutiveOutputValidationErrors: 0,
      possibleTruncation: false,
    }),
    attempts: 1,
    wasPolicyError: false,
    finalClassification: undefined,
  })),
}));

vi.mock('../../lib/observability', () => ({
  recordAgentMetrics: vi.fn(),
}));

vi.mock('../../lib/errors/ErrorPersistence', () => ({
  persistAgentErrorAuto: vi.fn(async () => {}),
}));

import { generateText } from 'ai';
import { processGroup } from '../CrosstabAgent';

describe('CrosstabAgent hint context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('injects previous attempt and scratchpad context into retry prompt', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      output: {
        groupName: 'Group A',
        columns: [
          {
            name: 'Column A',
            adjusted: 'Q1 == 1',
            confidence: 0.91,
            reasoning: 'Used prior expression with minimal update',
            userSummary: 'Mapped to the same column as before with a minor tweak.',
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 10 },
    } as never);

    await processGroup(
      [
        {
          Column: 'Q1',
          Description: 'Question 1',
          Answer_Options: '1=Yes,2=No',
          Type: 'categorical_select',
        },
      ],
      {
        groupName: 'Group A',
        columns: [{ name: 'Column A', original: 'Q1==1' }],
      },
      {
        hint: 'keep the same logic but ensure exact code',
        previousResult: {
          groupName: 'Group A',
          columns: [
            {
              name: 'Column A',
              adjusted: 'Q1 == 1',
              confidence: 0.84,
              reasoning: 'Initial mapping',
              userSummary: 'Initial mapping',
              alternatives: [],
              uncertainties: [],
              expressionType: 'direct_variable',
            },
          ],
        },
        previousAttemptContext: {
          mode: 'hint_retry',
          priorColumns: [
            {
              name: 'Column A',
              original: 'Q1==1',
              adjusted: 'Q1 == 1',
              reasoning: 'Initial mapping',
              alternatives: [],
              uncertainties: [],
            },
          ],
          priorScratchpadEntries: [
            {
              timestamp: '2026-02-18T10:00:00.000Z',
              action: 'add',
              content: 'Checked Q1 labels and selected code 1.',
            },
          ],
        },
      },
    );

    const call = vi.mocked(generateText).mock.calls[0]?.[0] as { prompt?: string; system?: string };
    expect(call.prompt).toContain('<previous_attempt_context');
    expect(call.prompt).toContain('<previous_scratchpad_context>');
    expect(call.prompt).toContain('Do not default to your prior expression');
    expect(call.prompt).toContain('Checked Q1 labels');
    // Verify reviewer-hint tag is used (not user-hint)
    expect(call.system).toContain('<reviewer-hint>');
    expect(call.system).not.toContain('<user-hint>');
  });
});
