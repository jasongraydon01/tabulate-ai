/**
 * Tests for the question-id pipeline orchestrator.
 *
 * Tests checkpoint progression, resume logic, and stage order compliance.
 * Uses mocked stage modules to avoid real R/AI calls.
 */

import { describe, it, expect } from 'vitest';
import {
  createPipelineCheckpoint,
  recordStageCompletion,
  isCheckpointCompatible,
} from '../contracts';
import { getStageRange, V3_STAGE_ORDER, V3_STAGE_NAMES } from '../stageOrder';

// =============================================================================
// Checkpoint Progression Tests
// =============================================================================

describe('Checkpoint progression', () => {
  it('creates a fresh checkpoint with nextStage=00', () => {
    const cp = createPipelineCheckpoint('run-1', 'test-dataset');
    expect(cp.pipelineId).toBe('run-1');
    expect(cp.dataset).toBe('test-dataset');
    expect(cp.lastCompletedStage).toBeNull();
    expect(cp.nextStage).toBe('00');
    expect(cp.completedStages).toHaveLength(0);
  });

  it('records stage completion and advances nextStage', () => {
    let cp = createPipelineCheckpoint('run-1', 'ds');
    cp = recordStageCompletion(cp, '00', 100);
    expect(cp.lastCompletedStage).toBe('00');
    expect(cp.nextStage).toBe('03');
    expect(cp.completedStages).toHaveLength(1);
    expect(cp.completedStages[0].completedStage).toBe('00');
    expect(cp.completedStages[0].durationMs).toBe(100);
  });

  it('progresses through the full question-id chain', () => {
    const stages = getStageRange('00', '12');
    let cp = createPipelineCheckpoint('run-1', 'ds');

    for (const stage of stages) {
      cp = recordStageCompletion(cp, stage, 50);
    }

    expect(cp.completedStages).toHaveLength(stages.length);
    expect(cp.lastCompletedStage).toBe('12');
    // After '12', the next stage is '13b' (table chain)
    expect(cp.nextStage).toBe('13b');
  });

  it('does not mutate the original checkpoint (immutable update)', () => {
    const original = createPipelineCheckpoint('run-1', 'ds');
    const updated = recordStageCompletion(original, '00', 50);

    expect(original.completedStages).toHaveLength(0);
    expect(original.lastCompletedStage).toBeNull();
    expect(updated.completedStages).toHaveLength(1);
  });
});

// =============================================================================
// Resume Logic Tests
// =============================================================================

describe('Resume logic', () => {
  it('identifies completed stages for resume', () => {
    let cp = createPipelineCheckpoint('run-1', 'ds');
    cp = recordStageCompletion(cp, '00', 100);
    cp = recordStageCompletion(cp, '03', 200);

    // After completing 00 and 03, next should be 08a
    expect(cp.nextStage).toBe('08a');
    expect(cp.lastCompletedStage).toBe('03');

    // Stages that would be skipped on resume
    const stages = getStageRange('00', '12');
    const lastCompletedIdx = stages.indexOf(cp.lastCompletedStage! as (typeof stages)[number]);
    const resumeIndex = lastCompletedIdx + 1;
    const skippedStages = stages.slice(0, resumeIndex);
    const remainingStages = stages.slice(resumeIndex);

    expect(skippedStages).toEqual(['00', '03']);
    expect(remainingStages).toEqual(['08a', '08b', '09d', '10a', '10', '11', '12']);
  });

  it('handles fresh run (no completed stages)', () => {
    const cp = createPipelineCheckpoint('run-1', 'ds');
    const stages = getStageRange('00', '12');

    const lastCompletedIdx = cp.lastCompletedStage
      ? stages.indexOf(cp.lastCompletedStage as (typeof stages)[number])
      : -1;
    const resumeIndex = lastCompletedIdx + 1;

    expect(resumeIndex).toBe(0);
    expect(stages.slice(resumeIndex)).toEqual(stages);
  });

  it('validates checkpoint schema compatibility', () => {
    const cp = createPipelineCheckpoint('run-1', 'ds');
    expect(isCheckpointCompatible(cp)).toBe(true);

    const stale = { ...cp, schemaVersion: 999 };
    expect(isCheckpointCompatible(stale)).toBe(false);
  });
});

// =============================================================================
// Stage Order Compliance Tests
// =============================================================================

describe('Stage order compliance', () => {
  it('question-id chain spans 00 through 12', () => {
    const stages = getStageRange('00', '12');
    expect(stages).toEqual(['00', '03', '08a', '08b', '09d', '10a', '10', '11', '12']);
  });

  it('every question-id stage has a name', () => {
    const stages = getStageRange('00', '12');
    for (const stage of stages) {
      expect(V3_STAGE_NAMES[stage]).toBeDefined();
      expect(V3_STAGE_NAMES[stage].length).toBeGreaterThan(0);
    }
  });

  it('question-id chain is a subset of V3_STAGE_ORDER', () => {
    const stages = getStageRange('00', '12');
    for (const stage of stages) {
      expect(V3_STAGE_ORDER).toContain(stage);
    }
  });

  it('stages are in strictly ascending order within V3_STAGE_ORDER', () => {
    const stages = getStageRange('00', '12');
    for (let i = 1; i < stages.length; i++) {
      const prevIdx = V3_STAGE_ORDER.indexOf(stages[i - 1]);
      const currIdx = V3_STAGE_ORDER.indexOf(stages[i]);
      expect(currIdx).toBeGreaterThan(prevIdx);
    }
  });
});
