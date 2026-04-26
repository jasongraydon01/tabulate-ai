import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getPipelineContext } from '@/lib/pipeline/PipelineContext';

const mocks = vi.hoisted(() => ({
  draftAnalysisBannerExtensionGroup: vi.fn(),
  processGroupV2: vi.fn(),
}));

vi.mock('@/agents/AnalysisBannerExtensionAgent', () => ({
  draftAnalysisBannerExtensionGroup: mocks.draftAnalysisBannerExtensionGroup,
}));

vi.mock('@/agents/CrosstabAgentV2', () => ({
  processGroupV2: mocks.processGroupV2,
}));

const frozenBannerGroup = {
  groupName: 'Region',
  columns: [{ name: 'North', original: 'REGION=1' }],
};

const frozenValidatedGroup = {
  groupName: 'Region',
  columns: [{
    name: 'North',
    adjusted: 'REGION == 1',
    confidence: 0.95,
    reasoning: 'Direct match',
    userSummary: 'Matched directly.',
    alternatives: [],
    uncertainties: [],
    expressionType: 'direct_variable',
  }],
};

const question = {
  questionId: 'REGION',
  questionText: 'Region',
  normalizedType: 'categorical_select',
  analyticalSubtype: null,
  disposition: 'reportable',
  isHidden: false,
  hiddenLink: null,
  loop: null,
  loopQuestionId: null,
  surveyMatch: null,
  baseSummary: null,
  items: [{
    column: 'REGION',
    label: 'Region',
    normalizedType: 'categorical_select',
    valueLabels: [{ value: 1, label: 'North' }],
  }],
};

describe('runAnalysisBannerExtensionPreflight', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.draftAnalysisBannerExtensionGroup.mockResolvedValue({
      group: frozenBannerGroup,
      confidence: 0.9,
      reasoning: 'Mapped directly.',
      needsClarification: false,
      clarifyingQuestion: '',
    });
    mocks.processGroupV2.mockResolvedValue(frozenValidatedGroup);
  });

  it('wraps CrosstabAgent validation in a pipeline context for API preflight execution', async () => {
    const { runAnalysisBannerExtensionPreflight } = await import('../preflight');
    let contextMeta: unknown = null;
    mocks.processGroupV2.mockImplementation(async () => {
      contextMeta = getPipelineContext()?.meta ?? null;
      return frozenValidatedGroup;
    });

    const result = await runAnalysisBannerExtensionPreflight({
      parentRunId: 'run-parent',
      requestText: 'Add region',
      groundingContext: {
        questions: [question],
        projectContext: { projectName: 'Study' },
      } as never,
      parentArtifacts: {
        outputs: {},
        parentPipelineId: 'parent-pipeline',
        parentDatasetName: 'dataset',
        bannerPlan: { bannerCuts: [] },
        crosstabPlan: { groups: [] },
        artifactKeys: {
          bannerPlan: 'planning/20-banner-plan.json',
          crosstabPlan: 'planning/21-crosstab-plan.json',
        },
      } as never,
      outputDir: '/tmp/tabulate-ai/analysis-preflight-run-parent/preflight-2026-04-26',
    });

    expect(result.frozenValidatedGroup).toEqual(frozenValidatedGroup);
    expect(contextMeta).toEqual({
      pipelineId: 'preflight-2026-04-26',
      runId: 'run-parent',
      source: 'analysisPreflight',
    });
  });
});
