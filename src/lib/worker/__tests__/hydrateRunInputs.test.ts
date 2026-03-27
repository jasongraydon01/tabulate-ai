import { describe, expect, it } from 'vitest';

import { buildHydratedSavedPaths } from '@/lib/worker/hydrateRunInputs';

describe('buildHydratedSavedPaths', () => {
  it('reuses the SPSS file as the datamap when the run has no separate datamap artifact', () => {
    const savedPaths = buildHydratedSavedPaths({
      sessionDir: '/tmp/tabulate-ai/session-1',
      payload: {
        sessionId: 'session-1',
        pipelineContext: {
          pipelineId: 'pipeline-1',
          datasetName: 'dataset',
          outputDir: '/tmp/tabulate-ai/outputs/dataset/pipeline-1',
        },
        fileNames: {
          dataMap: 'dataset.sav',
          bannerPlan: '',
          dataFile: 'dataset.sav',
          survey: 'survey.pdf',
          messageList: null,
        },
        inputRefs: {
          dataMap: null,
          bannerPlan: null,
          spss: 'org/project/runs/run-1/inputs/dataset.sav',
          survey: 'org/project/runs/run-1/inputs/survey.pdf',
          messageList: null,
        },
      },
    });

    expect(savedPaths.dataMapPath).toBe('/tmp/tabulate-ai/session-1/dataFile.sav');
    expect(savedPaths.spssPath).toBe('/tmp/tabulate-ai/session-1/dataFile.sav');
    expect(savedPaths.bannerPlanPath).toBe('');
    expect(savedPaths.surveyPath).toBe('/tmp/tabulate-ai/session-1/survey.pdf');
    expect(savedPaths.r2Keys).toEqual({
      dataMap: 'org/project/runs/run-1/inputs/dataset.sav',
      bannerPlan: '',
      spss: 'org/project/runs/run-1/inputs/dataset.sav',
      survey: 'org/project/runs/run-1/inputs/survey.pdf',
    });
  });

  it('hydrates separate optional artifacts when they exist', () => {
    const savedPaths = buildHydratedSavedPaths({
      sessionDir: '/tmp/tabulate-ai/session-2',
      payload: {
        sessionId: 'session-2',
        pipelineContext: {
          pipelineId: 'pipeline-2',
          datasetName: 'dataset',
          outputDir: '/tmp/tabulate-ai/outputs/dataset/pipeline-2',
        },
        fileNames: {
          dataMap: 'datamap.xlsx',
          bannerPlan: 'banner.docx',
          dataFile: 'dataset.sav',
          survey: 'survey.docx',
          messageList: 'messages.csv',
        },
        inputRefs: {
          dataMap: 'org/project/runs/run-2/inputs/datamap.xlsx',
          bannerPlan: 'org/project/runs/run-2/inputs/banner.docx',
          spss: 'org/project/runs/run-2/inputs/dataset.sav',
          survey: 'org/project/runs/run-2/inputs/survey.docx',
          messageList: 'org/project/runs/run-2/inputs/messages.csv',
        },
      },
    });

    expect(savedPaths.dataMapPath).toBe('/tmp/tabulate-ai/session-2/dataMap.xlsx');
    expect(savedPaths.bannerPlanPath).toBe('/tmp/tabulate-ai/session-2/bannerPlan.docx');
    expect(savedPaths.spssPath).toBe('/tmp/tabulate-ai/session-2/dataFile.sav');
    expect(savedPaths.surveyPath).toBe('/tmp/tabulate-ai/session-2/survey.docx');
    expect(savedPaths.messageListPath).toBe('/tmp/tabulate-ai/session-2/messageList.csv');
  });
});
