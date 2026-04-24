import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  buildRecoveryRestoreOutputDir,
  resolveRecoveryManifestPath,
} from '@/lib/worker/recoveryDev';
import type { WorkerRecoveryManifest } from '@/lib/worker/recovery';

const manifest: WorkerRecoveryManifest = {
  schemaVersion: 1,
  boundary: 'compute',
  resumeStage: 'executing_r',
  pipelineContext: {
    pipelineId: 'pipeline-2026-04-24T19-53-14-717Z',
    datasetName: 'cambridge-savings-bank-w3-data-4-22-26',
    outputDir: '/Users/jasongraydon01/tabulate-ai/outputs/cambridge-savings-bank-w3-data-4-22-26/pipeline-2026-04-24T19-53-14-717Z',
  },
  artifactRefs: {},
  requiredArtifacts: ['checkpoint', 'questionIdFinal', 'tableEnriched', 'crosstabPlan', 'computePackage'],
  missingArtifacts: [],
  isComplete: true,
  createdAt: Date.now(),
};

describe('recovery dev helpers', () => {
  it('resolves a manifest json path directly', () => {
    expect(
      resolveRecoveryManifestPath({
        inputPath: 'outputs/_r2-downloads/run-1/recovery/compute-manifest.json',
      }),
    ).toBe(path.resolve('outputs/_r2-downloads/run-1/recovery/compute-manifest.json'));
  });

  it('resolves the highest-priority manifest from a downloaded run directory', () => {
    expect(
      resolveRecoveryManifestPath({
        inputPath: 'outputs/_r2-downloads/run-1',
      }),
    ).toBe(path.resolve('outputs/_r2-downloads/run-1/recovery/compute-manifest.json'));
  });

  it('resolves a requested manifest boundary from a downloaded run directory', () => {
    expect(
      resolveRecoveryManifestPath({
        inputPath: 'outputs/_r2-downloads/run-1',
        boundary: 'fork_join',
      }),
    ).toBe(path.resolve('outputs/_r2-downloads/run-1/recovery/fork_join-manifest.json'));
  });

  it('defaults restored output into outputs/_recovered/<pipelineId>', () => {
    expect(
      buildRecoveryRestoreOutputDir({
        manifest,
      }),
    ).toBe(path.resolve('outputs/_recovered/pipeline-2026-04-24T19-53-14-717Z'));
  });

  it('uses an explicit output override when provided', () => {
    expect(
      buildRecoveryRestoreOutputDir({
        manifest,
        explicitOutputDir: 'outputs/_recovered/dev-run',
      }),
    ).toBe(path.resolve('outputs/_recovered/dev-run'));
  });
});
