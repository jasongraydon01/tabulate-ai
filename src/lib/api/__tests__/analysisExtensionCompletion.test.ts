import { describe, expect, it, vi } from 'vitest';

import { getPipelineContext } from '@/lib/pipeline/PipelineContext';

const mocks = vi.hoisted(() => ({
  mutateInternal: vi.fn(),
  stopHeartbeat: vi.fn(),
  assertAnalysisRunNotCancelled: vi.fn(),
  isAnalysisComputeAbortError: vi.fn(),
}));

vi.mock('@/lib/convex', () => ({
  mutateInternal: mocks.mutateInternal,
}));

vi.mock('@/lib/api/heartbeat', () => ({
  startHeartbeatInterval: vi.fn(() => mocks.stopHeartbeat),
}));

vi.mock('@/lib/analysis/computeLane/cancellation', () => ({
  assertAnalysisRunNotCancelled: mocks.assertAnalysisRunNotCancelled,
  isAnalysisComputeAbortError: mocks.isAnalysisComputeAbortError,
}));

describe('runAnalysisBannerExtensionRun', () => {
  it('wraps analysis extension worker execution in a pipeline context', async () => {
    const contextMetaSeen: unknown[] = [];
    mocks.assertAnalysisRunNotCancelled.mockImplementation(async () => {
      contextMetaSeen.push(getPipelineContext()?.meta ?? null);
      throw new DOMException('cancelled', 'AbortError');
    });
    mocks.isAnalysisComputeAbortError.mockReturnValue(true);
    mocks.mutateInternal.mockResolvedValue(undefined);

    const { runAnalysisBannerExtensionRun } = await import('../analysisExtensionCompletion');

    await expect(runAnalysisBannerExtensionRun({
      runId: 'child-run',
      orgId: 'org-1',
      projectId: 'project-1',
      launchedBy: 'user-1',
      sessionId: 'session-1',
      workerId: 'worker-1',
      pipelineContext: {
        pipelineId: 'pipeline-child',
        datasetName: 'study-analysis-extension',
        outputDir: '/tmp/study-analysis-extension/pipeline-child',
      },
      config: {} as never,
      extension: {
        kind: 'banner_extension',
        jobId: 'job-1',
        parentRunId: 'parent-run',
        parentPipelineId: 'parent-pipeline',
        parentDatasetName: 'study',
        parentR2Outputs: {},
        frozenBannerGroup: {
          groupName: 'Race / Ethnicity',
          columns: [{ name: 'A', original: 'RACE=1' }],
        },
        frozenValidatedGroup: {
          groupName: 'Race / Ethnicity',
          columns: [{
            name: 'A',
            adjusted: 'RACE == 1',
            confidence: 0.95,
            reasoning: 'Direct match',
            userSummary: 'Direct match.',
            alternatives: [],
            uncertainties: [],
            expressionType: 'direct_variable',
          }],
        },
        fingerprint: 'abc123',
      },
    })).rejects.toThrow('cancelled');

    expect(contextMetaSeen[0]).toEqual({
      pipelineId: 'pipeline-child',
      runId: 'child-run',
      sessionId: 'session-1',
      source: 'analysisExtension',
    });
    expect(mocks.stopHeartbeat).toHaveBeenCalledOnce();
  });
});
