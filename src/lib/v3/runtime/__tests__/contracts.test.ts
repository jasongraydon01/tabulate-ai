import { describe, it, expect } from 'vitest';
import {
  V3_CONTRACT_SCHEMA_VERSION,
  V3_STAGE_ARTIFACTS,
  V3_CHECKPOINT_FILENAME,
  createPipelineCheckpoint,
  recordStageCompletion,
  isCheckpointCompatible,
} from '../contracts';
import { V3_STAGE_ORDER } from '../stageOrder';

describe('V3 Contracts', () => {
  // =========================================================================
  // Schema version
  // =========================================================================

  it('has a positive integer schema version', () => {
    expect(V3_CONTRACT_SCHEMA_VERSION).toBeGreaterThan(0);
    expect(Number.isInteger(V3_CONTRACT_SCHEMA_VERSION)).toBe(true);
  });

  // =========================================================================
  // Stage artifacts
  // =========================================================================

  it('defines an artifact name for every active stage', () => {
    for (const stage of V3_STAGE_ORDER) {
      expect(stage in V3_STAGE_ARTIFACTS).toBe(true);
    }
  });

  it('key artifacts have expected filenames', () => {
    expect(V3_STAGE_ARTIFACTS['00']).toBe('enrichment/00-questionid-raw.json');
    expect(V3_STAGE_ARTIFACTS['12']).toBe('enrichment/12-questionid-final.json');
    expect(V3_STAGE_ARTIFACTS['13b']).toBe('tables/13b-table-plan.json');
    expect(V3_STAGE_ARTIFACTS['13d']).toBe('tables/13d-table-canonical.json');
    expect(V3_STAGE_ARTIFACTS['20']).toBe('planning/20-banner-plan.json');
    expect(V3_STAGE_ARTIFACTS['21']).toBe('planning/21-crosstab-plan.json');
    expect(V3_STAGE_ARTIFACTS['22']).toBe('compute/22-compute-package.json');
  });

  it('post-R QC (14) has null artifact (validation-only stage)', () => {
    expect(V3_STAGE_ARTIFACTS['14']).toBeNull();
  });

  // =========================================================================
  // Checkpoint filename
  // =========================================================================

  it('defines a checkpoint filename', () => {
    expect(V3_CHECKPOINT_FILENAME).toBe('checkpoint.json');
  });

  // =========================================================================
  // Pipeline checkpoint creation
  // =========================================================================

  it('creates an empty checkpoint with correct defaults', () => {
    const cp = createPipelineCheckpoint('test-run-123', 'test-dataset');

    expect(cp.schemaVersion).toBe(V3_CONTRACT_SCHEMA_VERSION);
    expect(cp.pipelineId).toBe('test-run-123');
    expect(cp.dataset).toBe('test-dataset');
    expect(cp.completedStages).toEqual([]);
    expect(cp.lastCompletedStage).toBeNull();
    expect(cp.nextStage).toBe('00');
    expect(cp.updatedAt).toBeDefined();
  });

  // =========================================================================
  // Stage completion recording
  // =========================================================================

  it('records a stage completion and advances nextStage', () => {
    const cp = createPipelineCheckpoint('run-1', 'dataset-1');
    const updated = recordStageCompletion(cp, '00', 1500, 'enrichment/00-questionid-raw.json');

    expect(updated.lastCompletedStage).toBe('00');
    expect(updated.nextStage).toBe('03');
    expect(updated.completedStages).toHaveLength(1);
    expect(updated.completedStages[0].completedStage).toBe('00');
    expect(updated.completedStages[0].durationMs).toBe(1500);
    expect(updated.completedStages[0].artifactPath).toBe('enrichment/00-questionid-raw.json');
    expect(updated.completedStages[0].artifactName).toBe('enrichment/00-questionid-raw.json');
    expect(updated.completedStages[0].schemaVersion).toBe(V3_CONTRACT_SCHEMA_VERSION);
  });

  it('sets nextStage to null after last stage completes', () => {
    let cp = createPipelineCheckpoint('run-2', 'dataset-2');
    // Record all stages in order
    for (const stage of V3_STAGE_ORDER) {
      cp = recordStageCompletion(cp, stage, 100);
    }

    expect(cp.lastCompletedStage).toBe('14');
    expect(cp.nextStage).toBeNull();
    expect(cp.completedStages).toHaveLength(V3_STAGE_ORDER.length);
  });

  it('preserves immutability — original checkpoint is not mutated', () => {
    const original = createPipelineCheckpoint('run-3', 'dataset-3');
    const updated = recordStageCompletion(original, '00', 500);

    expect(original.completedStages).toHaveLength(0);
    expect(original.lastCompletedStage).toBeNull();
    expect(updated.completedStages).toHaveLength(1);
    expect(updated.lastCompletedStage).toBe('00');
  });

  // =========================================================================
  // Checkpoint serialization roundtrip
  // =========================================================================

  it('survives JSON serialization roundtrip', () => {
    let cp = createPipelineCheckpoint('run-4', 'dataset-4');
    cp = recordStageCompletion(cp, '00', 1000, 'enrichment/00-questionid-raw.json');
    cp = recordStageCompletion(cp, '03', 500, 'enrichment/03-questionid-base.json');

    const serialized = JSON.stringify(cp);
    const deserialized = JSON.parse(serialized);

    expect(deserialized.schemaVersion).toBe(V3_CONTRACT_SCHEMA_VERSION);
    expect(deserialized.pipelineId).toBe('run-4');
    expect(deserialized.lastCompletedStage).toBe('03');
    expect(deserialized.nextStage).toBe('08a');
    expect(deserialized.completedStages).toHaveLength(2);
  });

  // =========================================================================
  // Compatibility check
  // =========================================================================

  it('isCheckpointCompatible returns true for current version', () => {
    const cp = createPipelineCheckpoint('run-5', 'dataset-5');
    expect(isCheckpointCompatible(cp)).toBe(true);
  });

  it('isCheckpointCompatible returns false for old version', () => {
    const cp = createPipelineCheckpoint('run-6', 'dataset-6');
    const oldCp = { ...cp, schemaVersion: 0 };
    expect(isCheckpointCompatible(oldCp)).toBe(false);
  });
});
