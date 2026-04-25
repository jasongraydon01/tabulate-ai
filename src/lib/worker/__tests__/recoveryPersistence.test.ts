import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  mkdir: vi.fn(),
  mutateInternal: vi.fn(),
  uploadRunOutputArtifact: vi.fn(),
  downloadToTemp: vi.fn(),
}));

vi.mock('fs', () => ({
  promises: {
    mkdir: mocks.mkdir,
    readFile: vi.fn(),
  },
}));

vi.mock('@/lib/convex', () => ({
  mutateInternal: mocks.mutateInternal,
}));

vi.mock('@/lib/r2/R2FileManager', () => ({
  uploadRunOutputArtifact: mocks.uploadRunOutputArtifact,
  downloadToTemp: mocks.downloadToTemp,
}));

describe('restoreDurableRecoveryWorkspace', () => {
  let restoreDurableRecoveryWorkspace: typeof import('@/lib/worker/recoveryPersistence').restoreDurableRecoveryWorkspace;

  beforeEach(async () => {
    if (!restoreDurableRecoveryWorkspace) {
      ({ restoreDurableRecoveryWorkspace } = await import('@/lib/worker/recoveryPersistence'));
    }
    vi.clearAllMocks();
  });

  it('accepts a normal repo-scoped outputs directory', async () => {
    await expect(restoreDurableRecoveryWorkspace({
      schemaVersion: 1,
      boundary: 'fork_join',
      resumeStage: 'v3_compute',
      pipelineContext: {
        pipelineId: 'pipeline-2026-04-17T04-28-08-972Z',
        datasetName: 'cambridge-savings-bank-w3-data-3-31-26',
        outputDir: `${process.cwd()}/outputs/cambridge-savings-bank-w3-data-3-31-26/pipeline-2026-04-17T04-28-08-972Z`,
      },
      artifactRefs: {},
      requiredArtifacts: ['checkpoint', 'questionIdFinal', 'tableEnriched', 'crosstabPlan'],
      missingArtifacts: [],
      isComplete: true,
      createdAt: Date.now(),
    })).resolves.toBe(
      `${process.cwd()}/outputs/cambridge-savings-bank-w3-data-3-31-26/pipeline-2026-04-17T04-28-08-972Z`,
    );

    expect(mocks.mkdir).toHaveBeenCalledWith(
      `${process.cwd()}/outputs/cambridge-savings-bank-w3-data-3-31-26/pipeline-2026-04-17T04-28-08-972Z`,
      { recursive: true },
    );
  });

  it('restores into the canonical outputs directory even if the manifest carries a stale absolute path', async () => {
    await expect(restoreDurableRecoveryWorkspace({
      schemaVersion: 1,
      boundary: 'fork_join',
      resumeStage: 'v3_compute',
      pipelineContext: {
        pipelineId: 'pipeline-1',
        datasetName: 'dataset',
        outputDir: `${process.cwd()}/tmp/dataset/pipeline-1`,
      },
      artifactRefs: {},
      requiredArtifacts: ['checkpoint', 'questionIdFinal', 'tableEnriched', 'crosstabPlan'],
      missingArtifacts: [],
      isComplete: true,
      createdAt: Date.now(),
    })).resolves.toBe(
      `${process.cwd()}/outputs/dataset/pipeline-1`,
    );

    expect(mocks.mkdir).toHaveBeenCalledWith(
      `${process.cwd()}/outputs/dataset/pipeline-1`,
      { recursive: true },
    );
  });

  it('rejects derived output directories that escape outputs/', async () => {
    await expect(restoreDurableRecoveryWorkspace({
      schemaVersion: 1,
      boundary: 'fork_join',
      resumeStage: 'v3_compute',
      pipelineContext: {
        pipelineId: 'pipeline-1',
        datasetName: '../tmp',
        outputDir: `${process.cwd()}/outputs/../tmp/pipeline-1`,
      },
      artifactRefs: {},
      requiredArtifacts: ['checkpoint', 'questionIdFinal', 'tableEnriched', 'crosstabPlan'],
      missingArtifacts: [],
      isComplete: true,
      createdAt: Date.now(),
    })).rejects.toThrow('Invalid recovery output path');
  });
});
