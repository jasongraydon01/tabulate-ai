/**
 * V3 Runtime — HITL Review Checkpoint Contract
 *
 * Defines the checkpoint/resume contract for the V3 HITL review flow.
 *
 * In the V3 pipeline, stage 21 (crosstab-plan) is the HITL review checkpoint.
 * When the pipeline pauses for review:
 *   - The planning chain (20-21) has completed
 *   - The canonical chain (13b-13d) may still be running in parallel
 *   - The reviewer can modify the crosstab plan
 *   - After review, the compute chain (22-14) runs with the reviewed plan
 *
 * The review checkpoint stores the state needed to resume after review,
 * including references to V3 stage artifacts by stage ID.
 *
 * See: docs/v3-runtime-architecture-refactor-plan.md (Phase 5)
 */

import type { V3PipelineCheckpoint, V3StageCheckpoint } from '../contracts';
import type { V3StageId } from '../stageOrder';

// =============================================================================
// Review Checkpoint Types
// =============================================================================

/** Stage at which HITL review occurs in the V3 pipeline. */
export const V3_REVIEW_STAGE: V3StageId = '21';

/** Review status for the V3 pipeline. */
export type V3ReviewStatus =
  | 'pending_review'   // Stage 21 complete, awaiting reviewer
  | 'in_review'        // Reviewer is actively working
  | 'review_complete'  // Review done, ready to resume
  | 'review_skipped';  // No review needed, proceed directly

/**
 * V3-specific review checkpoint.
 * Stored alongside the pipeline checkpoint to track review state.
 */
export interface V3ReviewCheckpoint {
  /** Review checkpoint schema version. */
  schemaVersion: 1;

  /** Pipeline run identifier (matches V3PipelineCheckpoint.pipelineId). */
  pipelineId: string;

  /** Dataset name. */
  dataset: string;

  /** Current review status. */
  reviewStatus: V3ReviewStatus;

  /** The V3 stage at which review occurs. */
  reviewStage: V3StageId;

  /** ISO timestamp when the review checkpoint was created. */
  createdAt: string;

  /** ISO timestamp when review was completed (null if pending). */
  completedAt: string | null;

  /**
   * Stage IDs whose artifacts are available at review time.
   * At minimum: stages 00-12 (question-id), 20-21 (planning).
   * May also include 13b-13d if canonical chain finished first.
   */
  availableStageArtifacts: V3StageId[];

  /**
   * Whether the canonical chain (13b-13d) was complete when review started.
   * If false, the canonical chain was still running in the background.
   */
  canonicalChainCompleteAtReview: boolean;

  /**
   * Reference to the pre-review crosstab plan artifact path.
   * Used for diff reporting after review.
   */
  preReviewCrosstabPlanPath: string | null;
}

/** Filename for the V3 review checkpoint within stages/ directory. */
export const V3_REVIEW_CHECKPOINT_FILENAME = 'v3-review-checkpoint.json';

// =============================================================================
// Factory Helpers
// =============================================================================

/**
 * Create a new review checkpoint when the pipeline pauses for HITL review.
 */
export function createReviewCheckpoint(
  pipelineId: string,
  dataset: string,
  pipelineCheckpoint: V3PipelineCheckpoint,
  options?: {
    canonicalChainComplete?: boolean;
    preReviewCrosstabPlanPath?: string;
  },
): V3ReviewCheckpoint {
  const availableStages = pipelineCheckpoint.completedStages
    .map((s: V3StageCheckpoint) => s.completedStage);

  return {
    schemaVersion: 1,
    pipelineId,
    dataset,
    reviewStatus: 'pending_review',
    reviewStage: V3_REVIEW_STAGE,
    createdAt: new Date().toISOString(),
    completedAt: null,
    availableStageArtifacts: availableStages,
    canonicalChainCompleteAtReview: options?.canonicalChainComplete ?? false,
    preReviewCrosstabPlanPath: options?.preReviewCrosstabPlanPath ?? null,
  };
}

/**
 * Mark a review checkpoint as complete.
 * Returns a new checkpoint (immutable update).
 */
export function completeReviewCheckpoint(
  checkpoint: V3ReviewCheckpoint,
  additionalCompletedStages?: V3StageId[],
): V3ReviewCheckpoint {
  const availableStages = new Set(checkpoint.availableStageArtifacts);
  if (additionalCompletedStages) {
    for (const s of additionalCompletedStages) {
      availableStages.add(s);
    }
  }

  return {
    ...checkpoint,
    reviewStatus: 'review_complete',
    completedAt: new Date().toISOString(),
    availableStageArtifacts: [...availableStages],
    canonicalChainCompleteAtReview: true, // Must be true by resume time
  };
}

/**
 * Check if a review checkpoint is compatible with the current runtime.
 */
export function isReviewCheckpointCompatible(
  checkpoint: V3ReviewCheckpoint,
): boolean {
  return checkpoint.schemaVersion === 1;
}

/**
 * Determine if the pipeline can resume after review.
 * Requires: review complete + canonical chain artifacts available.
 */
export function canResumeAfterReview(
  reviewCheckpoint: V3ReviewCheckpoint,
): boolean {
  if (reviewCheckpoint.reviewStatus !== 'review_complete') return false;
  if (!reviewCheckpoint.canonicalChainCompleteAtReview) return false;

  // Must have both canonical and planning chain artifacts
  const stages = new Set(reviewCheckpoint.availableStageArtifacts);
  return stages.has('13e') && stages.has('21');
}
