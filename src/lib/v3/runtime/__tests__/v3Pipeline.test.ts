/**
 * Phase 5 Tests — Fork/Join, Review Checkpoint, Migration Reader
 *
 * Tests the Phase 5 deliverables:
 *   1. Fork/join parallelism (getResumePhase, mergeParallelCheckpoints)
 *   2. HITL review checkpoint contract (create, complete, canResume)
 *   3. Migration reader (detect format, synthesize legacy checkpoint)
 *   4. Resume semantics across checkpoint boundaries
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createPipelineCheckpoint,
  recordStageCompletion,
  V3_CHECKPOINT_FILENAME,
  type V3PipelineCheckpoint,
} from '../contracts';
import { writeCheckpoint } from '../persistence';
import {
  getResumePhase,
  mergeParallelCheckpoints,
} from '../runV3Pipeline';

import {
  V3_REVIEW_STAGE,
  V3_REVIEW_CHECKPOINT_FILENAME,
  createReviewCheckpoint,
  completeReviewCheckpoint,
  isReviewCheckpointCompatible,
  canResumeAfterReview,
} from '../review/v3ReviewCheckpoint';

// migrationReader deleted in Phase 6a — tests removed

// =============================================================================
// Test Fixtures
// =============================================================================

const tempDirs: string[] = [];

async function makeTempOutputDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v3-pipeline-test-'));
  tempDirs.push(dir);
  return dir;
}

function makeCheckpointThroughStage(
  stageIds: string[],
  pipelineId = 'test-pipeline',
  dataset = 'test-dataset',
): V3PipelineCheckpoint {
  let checkpoint = createPipelineCheckpoint(pipelineId, dataset);
  for (const id of stageIds) {
    checkpoint = recordStageCompletion(
      checkpoint,
      id as Parameters<typeof recordStageCompletion>[1],
      100,
    );
  }
  return checkpoint;
}

// =============================================================================
// Setup / Teardown
// =============================================================================

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await Promise.all(
    tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })),
  );
  tempDirs.length = 0;
});

// =============================================================================
// getResumePhase Tests
// =============================================================================

describe('getResumePhase', () => {
  it('returns questionId for null checkpoint', () => {
    expect(getResumePhase(null)).toBe('questionId');
  });

  it('returns questionId for empty checkpoint', () => {
    const cp = createPipelineCheckpoint('test', 'test');
    expect(getResumePhase(cp)).toBe('questionId');
  });

  it('returns questionId when within stages 00-12', () => {
    const cp = makeCheckpointThroughStage(['00', '03', '08a']);
    expect(getResumePhase(cp)).toBe('questionId');
  });

  it('returns forkJoin when stage 12 is complete but not 13d+21', () => {
    const cp = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
    ]);
    expect(getResumePhase(cp)).toBe('forkJoin');
  });

  it('returns forkJoin when only canonical is done (13e but not 21)', () => {
    const cp = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e',
    ]);
    expect(getResumePhase(cp)).toBe('forkJoin');
  });

  it('returns forkJoin when only planning is done (21 but not 13e)', () => {
    const cp = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '20', '21',
    ]);
    // Stage order means 21 is lastCompletedStage. But 13e isn't done.
    expect(getResumePhase(cp)).toBe('forkJoin');
  });

  it('returns compute when both 13e and 21 are complete', () => {
    const cp = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e', '20', '21',
    ]);
    expect(getResumePhase(cp)).toBe('compute');
  });

  it('returns compute when stage 22 is complete', () => {
    const cp = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e', '20', '21', '22',
    ]);
    expect(getResumePhase(cp)).toBe('compute');
  });

  it('returns complete when stage 14 is complete', () => {
    const cp = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e', '20', '21', '22', '14',
    ]);
    expect(getResumePhase(cp)).toBe('complete');
  });
});

// =============================================================================
// mergeParallelCheckpoints Tests
// =============================================================================

describe('mergeParallelCheckpoints', () => {
  it('merges stages from two parallel chains', () => {
    const base = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
    ]);

    const canonical = makeCheckpointThroughStage([
      '13b', '13c1', '13c2', '13d', '13e',
    ]);

    const planning = makeCheckpointThroughStage([
      '20', '21',
    ]);

    const merged = mergeParallelCheckpoints(base, canonical, planning);

    const stageIds = merged.completedStages.map(s => s.completedStage);
    expect(stageIds).toContain('12');
    expect(stageIds).toContain('13d');
    expect(stageIds).toContain('21');
    expect(stageIds.length).toBe(15); // 8 + 5 + 2
  });

  it('deduplicates shared stages from base', () => {
    const base = makeCheckpointThroughStage(['00', '03']);
    const chain1 = makeCheckpointThroughStage(['00', '03', '13b']);
    const chain2 = makeCheckpointThroughStage(['00', '03', '20']);

    const merged = mergeParallelCheckpoints(base, chain1, chain2);
    const stageIds = merged.completedStages.map(s => s.completedStage);

    // 00 and 03 should appear only once
    expect(stageIds.filter(s => s === '00').length).toBe(1);
    expect(stageIds.filter(s => s === '03').length).toBe(1);
    expect(stageIds).toContain('13b');
    expect(stageIds).toContain('20');
  });

  it('sets nextStage to 22 when both chains complete', () => {
    const base = makeCheckpointThroughStage(['00', '03', '08a', '09d', '10a', '10', '11', '12']);
    const canonical = makeCheckpointThroughStage(['13b', '13c1', '13c2', '13d', '13e']);
    const planning = makeCheckpointThroughStage(['20', '21']);

    const merged = mergeParallelCheckpoints(base, canonical, planning);
    expect(merged.nextStage).toBe('22');
  });

  it('sets nextStage to null when only one chain complete', () => {
    const base = makeCheckpointThroughStage(['00', '03', '08a', '09d', '10a', '10', '11', '12']);
    const canonical = makeCheckpointThroughStage(['13b', '13c1']);
    const planning = makeCheckpointThroughStage(['20', '21']);

    const merged = mergeParallelCheckpoints(base, canonical, planning);
    // Canonical not fully done — nextStage should be null (in progress)
    expect(merged.nextStage).toBeNull();
  });

  it('throws when both parallel chains claim the same non-base stage', () => {
    const base = makeCheckpointThroughStage(['00', '03', '08a', '09d', '10a', '10', '11', '12']);
    const canonical = makeCheckpointThroughStage(['13b']);
    const planning = makeCheckpointThroughStage(['13b', '20']);

    expect(() => mergeParallelCheckpoints(base, canonical, planning)).toThrow(
      'Invalid parallel checkpoint merge: stage 13b',
    );
  });
});

// =============================================================================
// Review Checkpoint Contract Tests
// =============================================================================

describe('V3 review checkpoint contract', () => {
  it('V3_REVIEW_STAGE is stage 21', () => {
    expect(V3_REVIEW_STAGE).toBe('21');
  });

  it('creates review checkpoint with correct defaults', () => {
    const pipelineCheckpoint = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12', '20', '21',
    ]);

    const review = createReviewCheckpoint(
      'test-pipeline',
      'test-dataset',
      pipelineCheckpoint,
    );

    expect(review.schemaVersion).toBe(1);
    expect(review.pipelineId).toBe('test-pipeline');
    expect(review.dataset).toBe('test-dataset');
    expect(review.reviewStatus).toBe('pending_review');
    expect(review.reviewStage).toBe('21');
    expect(review.completedAt).toBeNull();
    expect(review.canonicalChainCompleteAtReview).toBe(false);
    expect(review.availableStageArtifacts).toContain('21');
  });

  it('creates review checkpoint with canonical complete flag', () => {
    const pipelineCheckpoint = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e', '20', '21',
    ]);

    const review = createReviewCheckpoint(
      'test',
      'test',
      pipelineCheckpoint,
      { canonicalChainComplete: true },
    );

    expect(review.canonicalChainCompleteAtReview).toBe(true);
    expect(review.availableStageArtifacts).toContain('13e');
  });

  it('completes review checkpoint', () => {
    const pipelineCheckpoint = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12', '20', '21',
    ]);
    const review = createReviewCheckpoint('test', 'test', pipelineCheckpoint);

    const completed = completeReviewCheckpoint(review, ['13e']);

    expect(completed.reviewStatus).toBe('review_complete');
    expect(completed.completedAt).toBeTruthy();
    expect(completed.canonicalChainCompleteAtReview).toBe(true);
    expect(completed.availableStageArtifacts).toContain('13e');
  });

  it('validates review checkpoint compatibility', () => {
    const pipelineCheckpoint = makeCheckpointThroughStage(['00']);
    const review = createReviewCheckpoint('test', 'test', pipelineCheckpoint);

    expect(isReviewCheckpointCompatible(review)).toBe(true);
    expect(isReviewCheckpointCompatible({ ...review, schemaVersion: 99 as 1 })).toBe(false);
  });

  it('canResumeAfterReview requires review_complete and canonical done', () => {
    const pipelineCheckpoint = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12', '20', '21',
    ]);
    const review = createReviewCheckpoint('test', 'test', pipelineCheckpoint);

    // Can't resume: still pending
    expect(canResumeAfterReview(review)).toBe(false);

    // Complete but canonical not done
    const completed = completeReviewCheckpoint(review);
    // canonicalChainCompleteAtReview is true because completeReviewCheckpoint sets it
    // But need 13e in available artifacts
    expect(canResumeAfterReview(completed)).toBe(false);

    // Complete with 13e available
    const withCanonical = completeReviewCheckpoint(review, ['13e']);
    expect(canResumeAfterReview(withCanonical)).toBe(true);
  });

  it('canResumeAfterReview requires stage 21 artifact to be available', () => {
    const review: Parameters<typeof canResumeAfterReview>[0] = {
      schemaVersion: 1 as const,
      pipelineId: 'test',
      dataset: 'test',
      reviewStatus: 'review_complete' as const,
      reviewStage: '21' as const,
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      availableStageArtifacts: ['13e'],
      canonicalChainCompleteAtReview: true,
      preReviewCrosstabPlanPath: null,
    };

    expect(canResumeAfterReview(review)).toBe(false);
  });

  it('review checkpoint filename is defined', () => {
    expect(V3_REVIEW_CHECKPOINT_FILENAME).toBe('v3-review-checkpoint.json');
  });
});

// Migration reader tests removed — migrationReader.ts deleted in Phase 6a

// =============================================================================
// Checkpoint Resume Boundary Tests
// =============================================================================

describe('checkpoint progression through fork/join boundary', () => {
  it('checkpoint at stage 12 has nextStage 13b', () => {
    const cp = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
    ]);
    expect(cp.nextStage).toBe('13b');
    expect(cp.lastCompletedStage).toBe('12');
  });

  it('merged checkpoint after both chains sets nextStage to 22', () => {
    const base = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
    ]);
    const canonical = makeCheckpointThroughStage(['13b', '13c1', '13c2', '13d', '13e']);
    const planning = makeCheckpointThroughStage(['20', '21']);

    const merged = mergeParallelCheckpoints(base, canonical, planning);
    expect(merged.nextStage).toBe('22');
    expect(merged.lastCompletedStage).toBe('21');
  });

  it('full pipeline checkpoint ends with stage 14 and null nextStage', () => {
    const cp = makeCheckpointThroughStage([
      '00', '03', '08a', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e', '20', '21', '22', '14',
    ]);
    expect(cp.lastCompletedStage).toBe('14');
    expect(cp.nextStage).toBeNull();
  });
});

// =============================================================================
// Checkpoint Serialization Round-Trip Tests
// =============================================================================

describe('checkpoint persistence round-trip', () => {
  it('persists and loads V3 checkpoint correctly', async () => {
    const outputDir = await makeTempOutputDir();
    const cp = makeCheckpointThroughStage(['00', '03', '08a']);

    await writeCheckpoint(outputDir, cp);

    // Verify file written
    const raw = JSON.parse(
      await fs.readFile(path.join(outputDir, V3_CHECKPOINT_FILENAME), 'utf-8'),
    );

    expect(raw.pipelineId).toBe('test-pipeline');
    expect(raw.completedStages.length).toBe(3);
    expect(raw.lastCompletedStage).toBe('08a');
  });

  it('merged parallel checkpoint persists correctly', async () => {
    const outputDir = await makeTempOutputDir();

    const base = makeCheckpointThroughStage(['00', '03', '08a', '09d', '10a', '10', '11', '12']);
    const canonical = makeCheckpointThroughStage(['13b', '13c1', '13c2', '13d', '13e']);
    const planning = makeCheckpointThroughStage(['20', '21']);

    const merged = mergeParallelCheckpoints(base, canonical, planning);
    await writeCheckpoint(outputDir, merged);

    // Verify persisted checkpoint has all stages
    const raw = JSON.parse(
      await fs.readFile(
        path.join(outputDir, V3_CHECKPOINT_FILENAME),
        'utf-8',
      ),
    );

    expect(raw.completedStages.length).toBe(15);
    expect(raw.nextStage).toBe('22');
  });
});
