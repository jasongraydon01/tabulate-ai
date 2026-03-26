/**
 * V3 Runtime Artifact Contracts
 *
 * Typed contracts for the artifacts produced and consumed at each V3 stage
 * boundary. These contracts define what each stage emits and what the next
 * stage expects, enabling typed handoff, checkpoint serialization, and
 * resume-by-stage-id.
 *
 * Schema version fields support forward migration: if the contract shape
 * changes, bumping the version allows runtime readers to detect stale
 * checkpoints and either migrate or reject them.
 *
 * See also:
 *   - src/lib/v3/runtime/stageOrder.ts (canonical stage order)
 *   - docs/v3-runtime-architecture-refactor-plan.md
 */

import { type V3StageId, getNextStage } from './stageOrder';

// =============================================================================
// Schema Versioning
// =============================================================================

/** Current contract schema version. Bump when any artifact shape changes. */
export const V3_CONTRACT_SCHEMA_VERSION = 2;

// =============================================================================
// Stage Checkpoint
// =============================================================================

/**
 * Checkpoint persisted after each stage completes.
 * Used for resume, telemetry, and stage-addressable audit.
 */
export interface V3StageCheckpoint {
  /** Contract schema version for forward migration safety. */
  schemaVersion: number;

  /** The stage that just completed. */
  completedStage: V3StageId;

  /** The next stage to run (null if pipeline is complete). */
  nextStage: V3StageId | null;

  /** ISO timestamp when the stage completed. */
  completedAt: string;

  /** Duration of the completed stage in milliseconds. */
  durationMs: number;

  /** Path to the artifact produced by this stage (relative to output dir). */
  artifactPath: string | null;

  /** Artifact filename (e.g., 'questionid-final.json', 'table-plan.json'). */
  artifactName: string | null;
}

/**
 * Full pipeline checkpoint state — accumulates as stages complete.
 * Written to `stages/v3-checkpoint.json` in the output directory.
 */
export interface V3PipelineCheckpoint {
  /** Contract schema version. */
  schemaVersion: number;

  /** Pipeline run identifier. */
  pipelineId: string;

  /** Dataset name. */
  dataset: string;

  /** Ordered list of completed stage checkpoints. */
  completedStages: V3StageCheckpoint[];

  /** The last completed stage ID (shortcut for resume logic). */
  lastCompletedStage: V3StageId | null;

  /** The next stage to execute (null if all stages complete). */
  nextStage: V3StageId | null;

  /** ISO timestamp of last checkpoint update. */
  updatedAt: string;
}

// =============================================================================
// Stage Artifact Contracts (Boundary Types)
// =============================================================================

/**
 * Artifact names produced at each V3 stage boundary.
 * These are the filenames written to the output directory.
 */
export const V3_STAGE_ARTIFACTS: Record<V3StageId, string | null> = {
  '00':   'enrichment/00-questionid-raw.json',
  '03':   'enrichment/03-questionid-base.json',
  '08a':  'enrichment/08a-questionid-survey.json',
  '08b':  'enrichment/08b-questionid-survey-cleanup.json',
  '09d':  'enrichment/09d-questionid-message.json',
  '10a':  'enrichment/10a-questionid-loop.json',
  '10':   'enrichment/10-questionid-triage.json',
  '11':   'enrichment/11-questionid-validated.json',
  '12':   'enrichment/12-questionid-final.json',
  '13b':  'tables/13b-table-plan.json',
  '13c1': 'tables/13c-table-plan-validated.json',
  '13c2': 'tables/13c-table-plan-validated.json', // 13c2 overwrites 13c1's output
  '13d':  'tables/13d-table-canonical.json',
  '13e':  'tables/13e-table-enriched.json',
  '20':   'planning/20-banner-plan.json',
  '21':   'planning/21-crosstab-plan.json',
  '22':   'compute/22-compute-package.json',
  '14':   null, // post-R QC produces validation report, not a chained artifact
};

// =============================================================================
// Factory Helpers
// =============================================================================

/**
 * Creates an empty pipeline checkpoint for a new run.
 */
export function createPipelineCheckpoint(
  pipelineId: string,
  dataset: string,
): V3PipelineCheckpoint {
  return {
    schemaVersion: V3_CONTRACT_SCHEMA_VERSION,
    pipelineId,
    dataset,
    completedStages: [],
    lastCompletedStage: null,
    nextStage: '00',
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Records a stage completion in the pipeline checkpoint.
 * Returns a new checkpoint (immutable update).
 */
export function recordStageCompletion(
  checkpoint: V3PipelineCheckpoint,
  stageId: V3StageId,
  durationMs: number,
  artifactPath: string | null = null,
): V3PipelineCheckpoint {
  const artifactName = V3_STAGE_ARTIFACTS[stageId];
  const next = getNextStage(stageId);

  const stageCheckpoint: V3StageCheckpoint = {
    schemaVersion: V3_CONTRACT_SCHEMA_VERSION,
    completedStage: stageId,
    nextStage: next,
    completedAt: new Date().toISOString(),
    durationMs,
    artifactPath,
    artifactName: artifactName ?? null,
  };

  return {
    ...checkpoint,
    completedStages: [...checkpoint.completedStages, stageCheckpoint],
    lastCompletedStage: stageId,
    nextStage: next,
    updatedAt: stageCheckpoint.completedAt,
  };
}

/**
 * Validates that a checkpoint's schema version is compatible with the current runtime.
 * Returns true if compatible, false if migration is needed.
 */
export function isCheckpointCompatible(checkpoint: V3PipelineCheckpoint): boolean {
  return checkpoint.schemaVersion === V3_CONTRACT_SCHEMA_VERSION;
}

/** Checkpoint filename at the root of the output directory. */
export const V3_CHECKPOINT_FILENAME = 'checkpoint.json';
