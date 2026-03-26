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
  getPromptVersions: vi.fn(() => ({ crosstabPromptVersion: 'production_v3' })),
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

vi.mock('../tools/scratchpad', () => ({
  createContextScratchpadTool: vi.fn(() => ({})),
  getAllContextScratchpadEntries: vi.fn(() => []),
  clearContextScratchpadsForAgent: vi.fn(),
  clearAllContextScratchpads: vi.fn(),
  formatScratchpadAsMarkdown: vi.fn(() => ''),
}));

import { retryWithPolicyHandling } from '../../lib/retryWithPolicyHandling';
import { processGroupV2 } from '../CrosstabAgentV2';

const QUESTIONS = [
  {
    questionId: 'Q1',
    questionText: 'Question 1',
    normalizedType: 'categorical_select',
    analyticalSubtype: null,
    disposition: 'reportable' as const,
    isHidden: false,
    hiddenLink: null,
    loop: null,
    loopQuestionId: null,
    surveyMatch: null,
    baseSummary: null,
    items: [
      {
        column: 'Q1',
        label: 'Question 1',
        normalizedType: 'categorical_select',
        valueLabels: [
          { value: 1, label: 'Yes' },
          { value: 2, label: 'No' },
        ],
      },
    ],
  },
];

describe('CrosstabAgentV2 policy fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses deterministic fallback when retries end in policy failure', async () => {
    const result = await processGroupV2(
      QUESTIONS,
      new Set(['Q1']),
      { groupName: 'Group A', columns: [{ name: 'Column A', original: 'Q1=1' }] },
    );

    expect(result.groupName).toBe('Group A');
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].adjusted).toBe('Q1==1');
    expect(result.columns[0].expressionType).toBe('direct_variable');
    expect(result.columns[0].uncertainties[0]).toContain('Policy block');
    expect(vi.mocked(retryWithPolicyHandling).mock.calls[0][1]?.policyRetryMode).toBe('ai');
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

    const result = await processGroupV2(
      QUESTIONS,
      new Set(['Q1']),
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

  it('retains the original expression as an alternative during per-column salvage success', async () => {
    vi.mocked(retryWithPolicyHandling)
      .mockResolvedValueOnce({
        success: false,
        error: 'group validation failed',
        attempts: 2,
        wasPolicyError: false,
        finalClassification: 'non_retryable',
      })
      .mockResolvedValueOnce({
        success: true,
        result: {
          groupName: 'Group A',
          columns: [
            {
              name: 'Column A',
              adjusted: 'Q1 == 2',
              confidence: 0.82,
              reasoning: 'Mapped to a different value',
              userSummary: 'Mapped to a different value',
              alternatives: [],
              uncertainties: [],
              expressionType: 'conceptual_filter',
            },
          ],
        },
        attempts: 1,
        wasPolicyError: false,
        finalClassification: undefined,
      });

    const result = await processGroupV2(
      QUESTIONS,
      new Set(['Q1']),
      { groupName: 'Group A', columns: [{ name: 'Column A', original: 'Q1=1' }] },
    );

    expect(result.columns[0].adjusted).toBe('Q1 == 2');
    expect(result.columns[0].alternatives).toHaveLength(1);
    expect(result.columns[0].alternatives[0].expression).toBe('Q1==1');
  });
});
