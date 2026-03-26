import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { BannerPlanInputType } from '@/schemas/bannerPlanSchema';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import { buildEntryBaseContract } from '../baseContract';
import type {
  BannerPlanResult,
  CrosstabPlanResult,
  QuestionIdEntry,
  SurveyMetadata,
} from '../planning/types';

const { runBannerPlanMock, runCrosstabPlanMock } = vi.hoisted(() => ({
  runBannerPlanMock: vi.fn(),
  runCrosstabPlanMock: vi.fn(),
}));

vi.mock('../planning/bannerPlan', () => ({
  runBannerPlan: runBannerPlanMock,
}));

vi.mock('../planning/crosstabPlan', () => ({
  runCrosstabPlan: runCrosstabPlanMock,
}));

import {
  V3_CHECKPOINT_FILENAME,
  createPipelineCheckpoint,
  recordStageCompletion,
} from '../contracts';
import { runPlanningPipeline } from '../planning/runPlanningPipeline';

const tempDirs: string[] = [];

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

function makeEntries(): QuestionIdEntry[] {
  return [
    {
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
          itemBase: 100,
          scaleLabels: [{ value: 1, label: 'Yes' }],
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
      displayQuestionId: null,
      displayQuestionText: null,
      sectionHeader: null,
      itemActivity: null,
      _aiGateReview: null,
      _reconciliation: null,
    },
  ] as QuestionIdEntry[];
}

function makeBannerPlan(): BannerPlanInputType {
  return {
    bannerCuts: [
      {
        groupName: 'Gender',
        columns: [{ name: 'Male', original: 'Q1_1 == 1' }],
      },
    ],
  };
}

function makeValidationResult(): ValidationResultType {
  return {
    bannerCuts: [
      {
        groupName: 'Gender',
        columns: [
          {
            name: 'Male',
            adjusted: 'Q1_1 == 1',
            confidence: 0.9,
            reasoning: 'Direct mapping',
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

function makeBannerResult(): BannerPlanResult {
  const bannerPlan = makeBannerPlan();
  return {
    bannerPlan,
    routeMetadata: {
      routeUsed: 'banner_agent',
      bannerFile: '/tmp/banner.pdf',
      generatedAt: '2026-03-16T00:00:00.000Z',
      groupCount: 1,
      columnCount: 1,
      sourceConfidence: 0.9,
      usedFallbackFromBannerAgent: false,
      bannerGenerateInputSource: null,
    },
  };
}

function makeCrosstabResult(): CrosstabPlanResult {
  const bannerPlan = makeBannerPlan();
  return {
    crosstabPlan: makeValidationResult(),
    resolvedBannerPlan: bannerPlan,
    resolvedBannerPlanInfo: {
      source: 'step20',
      fallbackUsed: false,
      fallbackReason: null,
      originalGroupCount: 1,
      originalColumnCount: 1,
      finalGroupCount: 1,
      finalColumnCount: 1,
    },
    questions: [],
    loopIterationCount: 0,
    questionCount: 1,
    variableCount: 1,
    averageConfidence: 0.9,
  };
}

async function makeTempOutputDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'planning-pipeline-'));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(
    tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

describe('runPlanningPipeline orchestrator', () => {
  it('runs stages 20 -> 21, writes artifacts, and records checkpoint progression', async () => {
    const outputDir = await makeTempOutputDir();
    const bannerResult = makeBannerResult();
    const crosstabResult = makeCrosstabResult();

    runBannerPlanMock.mockResolvedValue(bannerResult);
    runCrosstabPlanMock.mockResolvedValue(crosstabResult);

    const result = await runPlanningPipeline({
      entries: makeEntries(),
      metadata: makeMetadata(),
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir,
      pipelineId: 'planning-pipeline-test',
      dataset: 'test-dataset',
    });

    expect(runBannerPlanMock).toHaveBeenCalledTimes(1);
    expect(runCrosstabPlanMock).toHaveBeenCalledTimes(1);

    const planningDir = path.join(outputDir, 'planning');
    const bannerArtifact = JSON.parse(
      await fs.readFile(path.join(planningDir, '20-banner-plan.json'), 'utf-8'),
    ) as BannerPlanInputType;
    const crosstabArtifact = JSON.parse(
      await fs.readFile(path.join(planningDir, '21-crosstab-plan.json'), 'utf-8'),
    ) as ValidationResultType;

    expect(bannerArtifact).toEqual(bannerResult.bannerPlan);
    expect(crosstabArtifact).toEqual(crosstabResult.crosstabPlan);

    const checkpoint = JSON.parse(
      await fs.readFile(path.join(outputDir, V3_CHECKPOINT_FILENAME), 'utf-8'),
    ) as {
      lastCompletedStage: string | null;
      nextStage: string | null;
      completedStages: Array<{ completedStage: string }>;
    };

    expect(checkpoint.lastCompletedStage).toBe('21');
    expect(checkpoint.nextStage).toBe('22');
    expect(checkpoint.completedStages.map((s) => s.completedStage)).toEqual(['20', '21']);

    expect(result.bannerPlan.bannerPlan).toEqual(bannerResult.bannerPlan);
    expect(result.crosstabPlan.crosstabPlan).toEqual(crosstabResult.crosstabPlan);
  });

  it('forwards maxRespondents to both planning stages', async () => {
    const outputDir = await makeTempOutputDir();
    const bannerResult = makeBannerResult();
    const crosstabResult = makeCrosstabResult();

    runBannerPlanMock.mockResolvedValue(bannerResult);
    runCrosstabPlanMock.mockResolvedValue(crosstabResult);

    await runPlanningPipeline({
      entries: makeEntries(),
      metadata: makeMetadata(),
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir,
      pipelineId: 'planning-pipeline-test',
      dataset: 'test-dataset',
      maxRespondents: 100,
    });

    expect(runBannerPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRespondents: 100,
      }),
    );
    expect(runCrosstabPlanMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRespondents: 100,
      }),
    );
  });

  it('resumes from stage 20 artifact and skips rerunning stage 20', async () => {
    const outputDir = await makeTempOutputDir();
    const planningDir = path.join(outputDir, 'planning');
    await fs.mkdir(planningDir, { recursive: true });

    const bannerResult = makeBannerResult();
    const crosstabResult = makeCrosstabResult();

    await fs.writeFile(
      path.join(planningDir, '20-banner-plan.json'),
      JSON.stringify(bannerResult.bannerPlan, null, 2),
      'utf-8',
    );
    await fs.writeFile(
      path.join(planningDir, 'banner-route-metadata.json'),
      JSON.stringify(bannerResult.routeMetadata, null, 2),
      'utf-8',
    );

    let checkpoint = createPipelineCheckpoint('planning-pipeline-test', 'test-dataset');
    checkpoint = recordStageCompletion(
      checkpoint,
      '20',
      123,
      path.join(planningDir, '20-banner-plan.json'),
    );

    await fs.writeFile(
      path.join(outputDir, V3_CHECKPOINT_FILENAME),
      JSON.stringify(checkpoint, null, 2),
      'utf-8',
    );

    runCrosstabPlanMock.mockResolvedValue(crosstabResult);

    await runPlanningPipeline({
      entries: makeEntries(),
      metadata: makeMetadata(),
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir,
      pipelineId: 'planning-pipeline-test',
      dataset: 'test-dataset',
    });

    expect(runBannerPlanMock).not.toHaveBeenCalled();
    expect(runCrosstabPlanMock).toHaveBeenCalledTimes(1);

    const stage21Input = runCrosstabPlanMock.mock.calls[0][0] as {
      bannerPlan: BannerPlanInputType;
    };

    expect(stage21Input.bannerPlan).toEqual(bannerResult.bannerPlan);
  });

  it('restarts from stage 20 when checkpoint says 21 complete but crosstab artifact is missing', async () => {
    const outputDir = await makeTempOutputDir();
    const planningDir = path.join(outputDir, 'planning');
    await fs.mkdir(planningDir, { recursive: true });

    const bannerResult = makeBannerResult();
    const crosstabResult = makeCrosstabResult();

    await fs.writeFile(
      path.join(planningDir, '20-banner-plan.json'),
      JSON.stringify(bannerResult.bannerPlan, null, 2),
      'utf-8',
    );

    let checkpoint = createPipelineCheckpoint('planning-pipeline-test', 'test-dataset');
    checkpoint = recordStageCompletion(
      checkpoint,
      '20',
      100,
      path.join(planningDir, '20-banner-plan.json'),
    );
    checkpoint = recordStageCompletion(
      checkpoint,
      '21',
      200,
      path.join(planningDir, '21-crosstab-plan.json'),
    );

    await fs.writeFile(
      path.join(outputDir, V3_CHECKPOINT_FILENAME),
      JSON.stringify(checkpoint, null, 2),
      'utf-8',
    );

    runBannerPlanMock.mockResolvedValue(bannerResult);
    runCrosstabPlanMock.mockResolvedValue(crosstabResult);

    await runPlanningPipeline({
      entries: makeEntries(),
      metadata: makeMetadata(),
      savPath: '/tmp/input.sav',
      datasetPath: '/tmp/dataset',
      outputDir,
      pipelineId: 'planning-pipeline-test',
      dataset: 'test-dataset',
    });

    expect(runBannerPlanMock).toHaveBeenCalledTimes(1);
    expect(runCrosstabPlanMock).toHaveBeenCalledTimes(1);

    const finalCheckpoint = JSON.parse(
      await fs.readFile(path.join(outputDir, V3_CHECKPOINT_FILENAME), 'utf-8'),
    ) as {
      completedStages: Array<{ completedStage: string }>;
    };

    expect(finalCheckpoint.completedStages.map((s) => s.completedStage)).toEqual(['20', '21']);
  });
});
