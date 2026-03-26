import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  retryWithPolicyHandling: vi.fn(async () => ({
    success: false,
    error: 'policy blocked',
    attempts: 10,
    wasPolicyError: true,
    finalClassification: 'policy',
  })),
}));

vi.mock('../../lib/observability', () => ({
  recordAgentMetrics: vi.fn(),
}));

vi.mock('../../lib/errors/ErrorPersistence', () => ({
  persistAgentErrorAuto: vi.fn(async () => {}),
}));

import { retryWithPolicyHandling } from '../../lib/retryWithPolicyHandling';
import { processGroup } from '../CrosstabAgent';

describe('CrosstabAgent policy fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reuses previous result when retries end in policy failure', async () => {
    const previousResult = {
      groupName: 'Group A',
      columns: [
        {
          name: 'Column A',
          adjusted: 'Q1 == 1',
          confidence: 0.9,
          reasoning: 'Prior validated output',
          userSummary: 'Prior validated output',
          alternatives: [],
          uncertainties: [],
          expressionType: 'direct_variable' as const,
        },
      ],
    };

    const result = await processGroup(
      [{ Column: 'Q1', Description: 'Question 1', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' }],
      { groupName: 'Group A', columns: [{ name: 'Column A', original: 'Q1==1' }] },
      { previousResult },
    );

    expect(result).toEqual(previousResult);
    expect(vi.mocked(retryWithPolicyHandling)).toHaveBeenCalledTimes(1);
  });

  it('uses deterministic fallback when retries end in policy failure and no previous result exists', async () => {
    const result = await processGroup(
      [{ Column: 'Q1', Description: 'Question 1', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' }],
      { groupName: 'Group A', columns: [{ name: 'Column A', original: 'Q1=1' }] },
    );

    expect(result.groupName).toBe('Group A');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].name).toBe('Column A');
    expect(result.columns[0].adjusted).toBe('Q1==1');
    expect(result.columns[0].expressionType).toBe('direct_variable');
    expect(result.columns[0].uncertainties[0]).toContain('Policy block');
    expect(result.columns[0].confidence).toBe(0.3);
  });

  it('marks deterministic fallback as placeholder when original expression cannot be validated', async () => {
    const result = await processGroup(
      [{ Column: 'Q1', Description: 'Question 1', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' }],
      { groupName: 'Group A', columns: [{ name: 'Column A', original: 'MISSING_VAR=1' }] },
    );

    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].adjusted).toBe('NA');
    expect(result.columns[0].expressionType).toBe('placeholder');
    expect(result.columns[0].confidence).toBe(0.05);
  });

  it('uses deterministic fallback for per-column policy failures during salvage', async () => {
    vi.mocked(retryWithPolicyHandling)
      .mockResolvedValueOnce({
        success: false,
        error: 'transient parse failure',
        attempts: 10,
        wasPolicyError: false,
        finalClassification: 'non_retryable',
      })
      .mockResolvedValueOnce({
        success: false,
        error: 'policy blocked',
        attempts: 1,
        wasPolicyError: true,
        finalClassification: 'policy',
      });

    const result = await processGroup(
      [{ Column: 'Q1', Description: 'Question 1', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' }],
      { groupName: 'Group A', columns: [{ name: 'Column A', original: 'Q1=2' }] },
    );

    expect(result.groupName).toBe('Group A');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].adjusted).toBe('Q1==2');
    expect(result.columns[0].expressionType).toBe('direct_variable');
    expect(result.columns[0].uncertainties[0]).toContain('Policy block');
    expect(vi.mocked(retryWithPolicyHandling)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(retryWithPolicyHandling).mock.calls[0][1]?.policyRetryMode).toBe('ai');
    expect(vi.mocked(retryWithPolicyHandling).mock.calls[1][1]?.policyRetryMode).toBe('ai');
  });
});
