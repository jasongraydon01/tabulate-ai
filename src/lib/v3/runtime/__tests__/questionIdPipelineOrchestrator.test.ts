import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  runEnricherMock,
  runBaseEnricherMock,
  runSurveyParserMock,
  runSurveyCleanupMock,
  runMessageLabelMatcherMock,
  runLoopGateMock,
  runValidateMock,
  runReconcileMock,
  detectStimuliSetsMock,
  runTriageMock,
} = vi.hoisted(() => ({
  runEnricherMock: vi.fn(),
  runBaseEnricherMock: vi.fn(),
  runSurveyParserMock: vi.fn(),
  runSurveyCleanupMock: vi.fn(),
  runMessageLabelMatcherMock: vi.fn(),
  runLoopGateMock: vi.fn(),
  runValidateMock: vi.fn(),
  runReconcileMock: vi.fn(),
  detectStimuliSetsMock: vi.fn(),
  runTriageMock: vi.fn(),
}));

vi.mock('../questionId/enricher', () => ({
  runEnricher: runEnricherMock,
}));

vi.mock('../questionId/enrich/baseEnricher', () => ({
  runBaseEnricher: runBaseEnricherMock,
}));

vi.mock('../questionId/enrich/surveyParser', () => ({
  runSurveyParser: runSurveyParserMock,
}));

vi.mock('../questionId/enrich/surveyCleanupOrchestrator', () => ({
  runSurveyCleanup: runSurveyCleanupMock,
}));

vi.mock('../questionId/enrich/messageLabelMatcher', () => ({
  runMessageLabelMatcher: runMessageLabelMatcherMock,
}));

vi.mock('../questionId/gates/loopGate', () => ({
  runLoopGate: runLoopGateMock,
}));

vi.mock('../questionId/gates/validate', () => ({
  runValidate: runValidateMock,
}));

vi.mock('../questionId/reconcile', () => ({
  runReconcile: runReconcileMock,
}));

vi.mock('../questionId/enrich/stimuliSetDetector', () => ({
  detectStimuliSets: detectStimuliSetsMock,
}));

vi.mock('../questionId/gates/triage', () => ({
  runTriage: runTriageMock,
}));

import { runQuestionIdPipeline } from '../questionId/runQuestionIdPipeline';

const tempDirs: string[] = [];

async function makeTempOutputDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qid-pipeline-'));
  tempDirs.push(dir);
  return dir;
}

const metadata = {
  dataset: 'demo-dataset',
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

beforeEach(() => {
  vi.clearAllMocks();

  runEnricherMock.mockResolvedValue({ entries: [], metadata });
  runBaseEnricherMock.mockImplementation(async ({ entries, metadata: m }) => ({ entries, metadata: m }));
  runSurveyParserMock.mockImplementation(async ({ entries, metadata: m }) => ({
    entries,
    metadata: m,
    surveyParsed: [],
    surveyMarkdown: null,
  }));
  runSurveyCleanupMock.mockImplementation(async ({ surveyParsed }) => ({
    surveyParsed,
    stats: {},
  }));
  runMessageLabelMatcherMock.mockImplementation(async ({ entries, metadata: m }) => ({ entries, metadata: m }));
  runLoopGateMock.mockImplementation(async ({ entries, metadata: m }) => ({
    entries,
    metadata: m,
    clearedFamilies: [],
  }));
  detectStimuliSetsMock.mockImplementation(({ entries }) => entries);
  runTriageMock.mockReturnValue({ flagged: [] });
  runValidateMock.mockImplementation(async ({ allEntries, metadata: m }) => ({ entries: allEntries, metadata: m }));
  runReconcileMock.mockImplementation(({ entries, metadata: m }) => ({ entries, metadata: m }));
});

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('runQuestionIdPipeline orchestrator', () => {
  it('forwards maxRespondents into stage 00 enrichment', async () => {
    const outputDir = await makeTempOutputDir();

    await runQuestionIdPipeline({
      savPath: '/tmp/demo.sav',
      datasetPath: '/tmp/dataset',
      outputDir,
      pipelineId: 'pipeline-demo',
      dataset: 'demo-dataset',
      maxRespondents: 100,
    });

    expect(runEnricherMock).toHaveBeenCalledWith(
      expect.objectContaining({
        maxRespondents: 100,
      }),
    );
  });
});
