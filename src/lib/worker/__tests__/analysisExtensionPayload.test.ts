import { describe, expect, it } from 'vitest';

import { buildWorkerExecutionPayload } from '../buildExecutionPayload';

describe('buildWorkerExecutionPayload analysis extension', () => {
  it('preserves analysis extension payloads for worker dispatch', () => {
    const payload = buildWorkerExecutionPayload({
      sessionId: 'session-1',
      pipelineContext: {
        pipelineId: 'pipeline-child',
        datasetName: 'study-analysis-extension',
        outputDir: '/tmp/study-analysis-extension/pipeline-child',
      },
      fileNames: {
        dataMap: 'data.sav',
        bannerPlan: '',
        dataFile: 'data.sav',
        survey: null,
        messageList: null,
      },
      inputRefs: {
        dataMap: null,
        bannerPlan: null,
        spss: 'org/project/runs/parent/dataFile.sav',
        survey: null,
        messageList: null,
      },
      analysisExtension: {
        kind: 'banner_extension',
        jobId: 'job-1',
        parentRunId: 'parent-run',
        parentPipelineId: 'parent-pipeline',
        parentDatasetName: 'study',
        parentR2Outputs: {
          'dataFile.sav': 'org/project/runs/parent/dataFile.sav',
        },
        frozenBannerGroup: {
          groupName: 'Region',
          columns: [{ name: 'North', original: 'REGION=1' }],
        },
        frozenValidatedGroup: {
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
        },
        fingerprint: 'abc123',
      },
    });

    expect(payload.analysisExtension?.kind).toBe('banner_extension');
    expect(payload.analysisExtension?.frozenBannerGroup.groupName).toBe('Region');
  });
});

