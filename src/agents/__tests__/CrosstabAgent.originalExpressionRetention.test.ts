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
  getPromptVersions: vi.fn(() => ({ crosstabPromptVersion: 'alternative' })),
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

function compactExpression(expression: string): string {
  return expression.replace(/\s+/g, '');
}

describe('CrosstabAgent original-expression retention', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds original banner expression as low-rank alternative when mapped expression changes', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      output: {
        groupName: 'Audience',
        columns: [
          {
            name: 'Teachers',
            adjusted: 'Q2 == 1',
            confidence: 0.81,
            reasoning: 'Mapped to role variable',
            userSummary: 'Mapped to role variable',
            alternatives: [],
            uncertainties: [],
            expressionType: 'conceptual_filter',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 10 },
    } as never);

    const result = await processGroup(
      [
        { Column: 'Q1', Description: 'Legacy teacher flag', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' },
        { Column: 'Q2', Description: 'Role variable', Answer_Options: '1=Teacher,2=Other', Type: 'categorical_select' },
      ],
      {
        groupName: 'Audience',
        columns: [{ name: 'Teachers', original: 'Q1=1' }],
      },
    );

    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].alternatives).toHaveLength(1);
    expect(compactExpression(result.columns[0].alternatives[0].expression)).toBe('Q1==1');
    expect(result.columns[0].alternatives[0].rank).toBe(2);
  });

  it('restores omitted columns from original expressions when group output drops them', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      output: {
        groupName: 'Audience',
        columns: [
          {
            name: 'Teachers',
            adjusted: 'Q1 == 1',
            confidence: 0.95,
            reasoning: 'Direct mapping',
            userSummary: 'Direct mapping',
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 10 },
    } as never);

    const result = await processGroup(
      [
        { Column: 'Q1', Description: 'Teacher flag', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' },
        { Column: 'Q2', Description: 'Manager flag', Answer_Options: '1=Yes,2=No', Type: 'categorical_select' },
      ],
      {
        groupName: 'Audience',
        columns: [
          { name: 'Teachers', original: 'Q1=1' },
          { name: 'Managers', original: 'Q2=1' },
        ],
      },
    );

    expect(result.columns).toHaveLength(2);
    expect(result.columns[0].name).toBe('Teachers');
    expect(result.columns[1].name).toBe('Managers');
    expect(compactExpression(result.columns[1].adjusted)).toBe('Q2==1');
    expect(result.columns[1].confidence).toBe(0.35);
    expect(result.columns[1].uncertainties[0]).toContain('Recovered automatically');
  });

  it('matches columns when model returns straight apostrophes but source uses curly apostrophes', async () => {
    vi.mocked(generateText).mockResolvedValueOnce({
      output: {
        groupName: 'Locations',
        columns: [
          {
            // Model returns straight apostrophe (U+0027)
            name: "Other's Home",
            adjusted: 'hLOCATION1 == 2 | hLOCATION2 == 2',
            confidence: 0.92,
            reasoning: 'Mapped location code 2',
            userSummary: 'Mapped location code 2',
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable',
          },
        ],
      },
      usage: { inputTokens: 10, outputTokens: 10 },
    } as never);

    const result = await processGroup(
      [
        { Column: 'hLOCATION1', Description: 'Location 1', Answer_Options: '1=Own Home,2=Other Home', Type: 'categorical_select' },
        { Column: 'hLOCATION2', Description: 'Location 2', Answer_Options: '1=Own Home,2=Other Home', Type: 'categorical_select' },
      ],
      {
        groupName: 'Locations',
        // Source uses curly apostrophe (U+2019)
        columns: [{ name: 'Other\u2019s Home', original: 'Assigned S9_2' }],
      },
    );

    expect(result.columns).toHaveLength(1);
    // Name should be preserved as the source name (curly apostrophe)
    expect(result.columns[0].name).toBe('Other\u2019s Home');
    // Expression should come from the model, not fallback
    expect(result.columns[0].adjusted).toBe('hLOCATION1 == 2 | hLOCATION2 == 2');
    expect(result.columns[0].confidence).toBe(0.92);
  });
});
