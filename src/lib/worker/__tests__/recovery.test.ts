import { describe, expect, it } from 'vitest';

import {
  buildWorkerRecoveryManifest,
  getRecoveryFailureReason,
  getStaleWorkerRecoveryAction,
} from '@/lib/worker/recovery';

describe('worker recovery helpers', () => {
  it('marks a review checkpoint manifest incomplete when required artifacts are missing', () => {
    const manifest = buildWorkerRecoveryManifest({
      boundary: 'review_checkpoint',
      pipelineContext: {
        pipelineId: 'pipeline-1',
        datasetName: 'study',
        outputDir: '/tmp/outputs/study/pipeline-1',
      },
      artifactRefs: {
        checkpoint: 'runs/run-1/checkpoint.json',
        questionIdFinal: 'runs/run-1/enrichment/12-questionid-final.json',
        crosstabPlan: 'runs/run-1/planning/21-crosstab-plan.json',
      },
      createdAt: 123,
    });

    expect(manifest.isComplete).toBe(false);
    expect(manifest.missingArtifacts).toEqual([
      'tableEnriched',
      'reviewState',
      'pipelineSummary',
      'dataFileSav',
    ]);
    expect(getRecoveryFailureReason(manifest)).toContain('review_checkpoint');
  });

  it('requeues stale runs for durable recovery when the manifest is complete', () => {
    const manifest = buildWorkerRecoveryManifest({
      boundary: 'compute',
      pipelineContext: {
        pipelineId: 'pipeline-2',
        datasetName: 'study',
        outputDir: '/tmp/outputs/study/pipeline-2',
      },
      artifactRefs: {
        checkpoint: 'runs/run-2/checkpoint.json',
        questionIdFinal: 'runs/run-2/enrichment/12-questionid-final.json',
        tableEnriched: 'runs/run-2/tables/13e-table-enriched.json',
        crosstabPlan: 'runs/run-2/planning/21-crosstab-plan.json',
        computePackage: 'runs/run-2/compute/22-compute-package.json',
      },
      createdAt: 456,
    });

    const action = getStaleWorkerRecoveryAction({
      run: {
        cancelRequested: false,
        heartbeatAt: 0,
        _creationTime: 0,
        recoveryManifest: manifest,
      },
      staleBeforeMs: 10,
      now: 100,
    });

    expect(action).toEqual({
      action: 'requeue',
      resumeFromStage: 'executing_r',
      message: 'Run requeued for worker recovery from durable compute checkpoint.',
    });
  });

  it('fails stale recovery explicitly when the durable artifact set is incomplete', () => {
    const incompleteManifest = buildWorkerRecoveryManifest({
      boundary: 'fork_join',
      pipelineContext: {
        pipelineId: 'pipeline-3',
        datasetName: 'study',
        outputDir: '/tmp/outputs/study/pipeline-3',
      },
      artifactRefs: {
        checkpoint: 'runs/run-3/checkpoint.json',
        questionIdFinal: 'runs/run-3/enrichment/12-questionid-final.json',
      },
      createdAt: 789,
    });

    const action = getStaleWorkerRecoveryAction({
      run: {
        cancelRequested: false,
        heartbeatAt: 0,
        _creationTime: 0,
        recoveryManifest: incompleteManifest,
      },
      staleBeforeMs: 10,
      now: 100,
    });

    expect(action.action).toBe('fail');
    expect(action).toMatchObject({
      message: expect.stringContaining('Missing required artifacts: tableEnriched, crosstabPlan'),
    });
  });
});
