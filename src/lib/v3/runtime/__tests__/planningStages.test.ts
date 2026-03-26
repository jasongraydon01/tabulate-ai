import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import { buildEntryBaseContract } from '../baseContract';
import type { QuestionIdEntry, SurveyMetadata } from '../planning/types';

const {
  processDocumentMock,
  findDatasetFilesMock,
  generateBannerCutsWithValidationMock,
  generateBannerCutsWithValidationV2Mock,
  getDataFileStatsMock,
  convertToRawVariablesMock,
  enrichVariablesMock,
  processAllGroupsV2Mock,
} = vi.hoisted(() => ({
  processDocumentMock: vi.fn(),
  findDatasetFilesMock: vi.fn(),
  generateBannerCutsWithValidationMock: vi.fn(),
  generateBannerCutsWithValidationV2Mock: vi.fn(),
  getDataFileStatsMock: vi.fn(),
  convertToRawVariablesMock: vi.fn(),
  enrichVariablesMock: vi.fn(),
  processAllGroupsV2Mock: vi.fn(),
}));

vi.mock('@/lib/pipeline/FileDiscovery', () => ({
  findDatasetFiles: findDatasetFilesMock,
}));

vi.mock('@/agents/BannerAgent', () => ({
  BannerAgent: class BannerAgentMock {
    processDocument = processDocumentMock;
  },
}));

vi.mock('@/agents/BannerGenerateAgent', () => ({
  generateBannerCutsWithValidation: generateBannerCutsWithValidationMock,
  generateBannerCutsWithValidationV2: generateBannerCutsWithValidationV2Mock,
}));

vi.mock('@/lib/validation/RDataReader', () => ({
  getDataFileStats: getDataFileStatsMock,
  convertToRawVariables: convertToRawVariablesMock,
}));

vi.mock('@/lib/processors/DataMapProcessor', () => ({
  DataMapProcessor: class DataMapProcessorMock {
    enrichVariables = enrichVariablesMock;
  },
}));

vi.mock('@/agents/CrosstabAgentV2', () => ({
  processAllGroupsV2: processAllGroupsV2Mock,
}));

import { runBannerPlan } from '../planning/bannerPlan';
import { runCrosstabPlan } from '../planning/crosstabPlan';

function makeMetadata(): SurveyMetadata {
  return {
    dataset: 'test-dataset',
    generatedAt: '2026-03-16T00:00:00.000Z',
    scriptVersion: 'test',
    isMessageTestingSurvey: false,
    isConceptTestingSurvey: false,
    hasMaxDiff: null,
    hasAnchoredScores: null,
    messageTemplatePath: null,
    isDemandSurvey: false,
    hasChoiceModelExercise: null,
  };
}

function makeEntry(overrides: Partial<QuestionIdEntry> = {}): QuestionIdEntry {
  const base = {
    questionId: 'Q1',
    questionText: 'Question 1',
    variables: ['Q1_1'],
    variableCount: 1,
    disposition: 'reportable',
    exclusionReason: null,
    isHidden: false,
    hiddenLink: null,
    analyticalSubtype: 'standard',
    subtypeSource: 'test',
    subtypeConfidence: 1,
    rankingDetail: null,
    sumConstraint: null,
    pipeColumns: [],
    surveyMatch: 'exact',
    surveyText: null,
    priority: 'primary',
    loop: null,
    loopQuestionId: null,
    normalizedType: 'categorical_select',
    items: [
      {
        column: 'Q1_1',
        label: 'Option 1',
        normalizedType: 'categorical_select',
        scaleLabels: [{ value: 1, label: 'Yes' }],
        itemBase: 100,
        messageCode: null,
        messageText: null,
        altCode: null,
        altText: null,
        matchMethod: null,
        matchConfidence: 0,
      },
    ],
    totalN: 100,
    questionBase: 100,
    isFiltered: false,
    gapFromTotal: 0,
    gapPct: 0,
    hasVariableItemBases: false,
    variableBaseReason: null,
    itemBaseRange: null,
    baseContract: buildEntryBaseContract({
      totalN: 100,
      questionBase: 100,
      itemBase: null,
      itemBaseRange: null,
      hasVariableItemBases: false,
      variableBaseReason: null,
      rankingDetail: null,
      exclusionReason: null,
    }),
    proposedBase: 100,
    proposedBaseLabel: 'All respondents',
    hasMessageMatches: false,
    stimuliSets: null,
    sectionHeader: null,
    itemActivity: null,
    _aiGateReview: null,
    _reconciliation: null,
  };

  const entry = {
    ...base,
    ...overrides,
  } as unknown as QuestionIdEntry;
  entry.baseContract = overrides.baseContract ?? buildEntryBaseContract({
    totalN: entry.totalN,
    questionBase: entry.questionBase,
    itemBase: null,
    itemBaseRange: entry.itemBaseRange,
    hasVariableItemBases: entry.hasVariableItemBases,
    variableBaseReason: entry.variableBaseReason,
    rankingDetail: entry.rankingDetail,
    exclusionReason: entry.exclusionReason,
  });
  return entry;
}

function makeValidationResult(): ValidationResultType {
  return {
    bannerCuts: [
      {
        groupName: 'Demographics',
        columns: [
          {
            name: 'Male',
            adjusted: 'Q1_1 == 1',
            confidence: 0.9,
            reasoning: 'Mapped directly',
            userSummary: 'Male respondents',
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable',
          },
        ],
      },
    ],
  };
}

describe('runBannerPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findDatasetFilesMock.mockResolvedValue({
      banner: '/tmp/banner.pdf',
      spss: '/tmp/input.sav',
    });
  });

  it('uses BannerAgent output when extraction is complete', async () => {
    processDocumentMock.mockResolvedValue({
      success: true,
      confidence: 0.88,
      verbose: {
        data: {
          extractedStructure: {
            bannerCuts: [
              {
                groupName: 'Gender',
                columns: [{ name: 'Male', original: 'Q1_1 == 1' }],
              },
            ],
          },
        },
      },
    });

    const result = await runBannerPlan({
      entries: [makeEntry()],
      metadata: makeMetadata(),
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir: '/tmp/out',
    });

    expect(result.routeMetadata.routeUsed).toBe('banner_agent');
    expect(result.routeMetadata.usedFallbackFromBannerAgent).toBe(false);
    expect(result.bannerPlan.bannerCuts).toHaveLength(1);
    expect(generateBannerCutsWithValidationV2Mock).not.toHaveBeenCalled();
    expect(generateBannerCutsWithValidationMock).not.toHaveBeenCalled();
  });

  it('falls back to BannerGenerate V2 with group-name hint and forwards abort signal', async () => {
    processDocumentMock.mockResolvedValue({
      success: false,
      confidence: 0.2,
      verbose: {
        data: {
          extractedStructure: {
            bannerCuts: [{ groupName: 'Region', columns: [] }],
          },
        },
      },
    });

    generateBannerCutsWithValidationV2Mock.mockResolvedValue({
      agent: [
        {
          groupName: 'Region',
          columns: [{ name: 'Northeast', original: 'Q2_1 == 1' }],
        },
      ],
      confidence: 0.71,
    });

    const controller = new AbortController();

    const result = await runBannerPlan({
      entries: [makeEntry()],
      metadata: makeMetadata(),
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir: '/tmp/out',
      abortSignal: controller.signal,
      cutSuggestions: 'Preserve age and region structure',
    });

    const calledWith = generateBannerCutsWithValidationV2Mock.mock.calls[0][0] as {
      cutSuggestions?: string;
      abortSignal?: AbortSignal;
    };

    expect(calledWith.cutSuggestions).toContain('Preserve age and region structure');
    expect(calledWith.cutSuggestions).toContain('Create banner cuts for these groups: Region');
    expect(calledWith.abortSignal).toBe(controller.signal);
    expect(result.routeMetadata.routeUsed).toBe('banner_generate');
    expect(result.routeMetadata.usedFallbackFromBannerAgent).toBe(true);
    expect(result.routeMetadata.bannerGenerateInputSource).toBe('questionid_reportable');
  });

  it('uses V1 sav datamap fallback when reportable question context is empty', async () => {
    findDatasetFilesMock.mockResolvedValue({
      banner: null,
      spss: '/tmp/input.sav',
    });

    getDataFileStatsMock.mockResolvedValue({});
    convertToRawVariablesMock.mockReturnValue([]);
    enrichVariablesMock.mockReturnValue({
      verbose: [
        {
          level: 'parent',
          column: 'Q10',
          description: 'Age',
          valueType: 'categorical_select',
          answerOptions: '1=18-34,2=35+',
          parentQuestion: 'Q10',
          normalizedType: 'categorical_select',
        },
      ],
    });
    generateBannerCutsWithValidationMock.mockResolvedValue({
      agent: [
        {
          groupName: 'Age',
          columns: [{ name: '18-34', original: 'Q10 == 1' }],
        },
      ],
      confidence: 0.6,
    });

    const controller = new AbortController();

    const excludedEntry = makeEntry({
      questionId: 'EX1',
      disposition: 'excluded',
    });

    const result = await runBannerPlan({
      entries: [excludedEntry],
      metadata: makeMetadata(),
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir: '/tmp/out',
      abortSignal: controller.signal,
    });

    const calledWith = generateBannerCutsWithValidationMock.mock.calls[0][0] as {
      abortSignal?: AbortSignal;
    };

    expect(generateBannerCutsWithValidationV2Mock).not.toHaveBeenCalled();
    expect(calledWith.abortSignal).toBe(controller.signal);
    expect(result.routeMetadata.bannerGenerateInputSource).toBe('sav_verbose_datamap');
  });
});

describe('runCrosstabPlan', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses step-20 banner plan directly and forwards abort + loop count to CrosstabAgentV2', async () => {
    processAllGroupsV2Mock.mockResolvedValue({
      result: makeValidationResult(),
      processingLog: [],
    });

    const controller = new AbortController();

    const result = await runCrosstabPlan({
      entries: [
        makeEntry({
          loop: {
            detected: true,
            familyBase: 'Q1',
            iterationIndex: 0,
            iterationCount: 4,
            siblingFamilyBases: ['Q1'],
          },
        }),
      ],
      metadata: makeMetadata(),
      bannerPlan: {
        bannerCuts: [
          {
            groupName: 'Gender',
            columns: [{ name: 'Male', original: 'Q1_1 == 1' }],
          },
        ],
      },
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir: '/tmp/out',
      abortSignal: controller.signal,
    });

    const call = processAllGroupsV2Mock.mock.calls[0] as unknown[];

    expect(call[4]).toBe(controller.signal);
    expect(call[5]).toBe(4);
    expect(result.resolvedBannerPlanInfo.fallbackUsed).toBe(false);
    expect(result.resolvedBannerPlanInfo.source).toBe('step20');
    expect(result.questionCount).toBe(1);
    expect(result.variableCount).toBe(1);
  });

  it('regenerates banner when groups have zero columns and forwards abort to BannerGenerate V2', async () => {
    generateBannerCutsWithValidationV2Mock.mockResolvedValue({
      agent: [
        {
          groupName: 'Region',
          columns: [{ name: 'West', original: 'Q2_1 == 4' }],
        },
      ],
      confidence: 0.73,
    });

    processAllGroupsV2Mock.mockResolvedValue({
      result: makeValidationResult(),
      processingLog: [],
    });

    const controller = new AbortController();

    const result = await runCrosstabPlan({
      entries: [makeEntry()],
      metadata: makeMetadata(),
      bannerPlan: {
        bannerCuts: [{ groupName: 'Region', columns: [] }],
      },
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir: '/tmp/out',
      abortSignal: controller.signal,
      cutSuggestions: 'Keep existing market cuts',
    });

    const calledWith = generateBannerCutsWithValidationV2Mock.mock.calls[0][0] as {
      cutSuggestions?: string;
      abortSignal?: AbortSignal;
    };

    expect(calledWith.cutSuggestions).toContain('Keep existing market cuts');
    expect(calledWith.cutSuggestions).toContain('Create banner cuts for these groups: Region');
    expect(calledWith.abortSignal).toBe(controller.signal);
    expect(result.resolvedBannerPlanInfo.fallbackUsed).toBe(true);
    expect(result.resolvedBannerPlanInfo.fallbackReason).toBe('groups_without_columns');
    expect(result.resolvedBannerPlanInfo.source).toBe('fallback_generate');
  });
});
