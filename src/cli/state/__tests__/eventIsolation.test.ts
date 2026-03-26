import { describe, expect, it } from 'vitest';

import { appReducer } from '../reducer';
import { createInitialAppState } from '../types';

describe('CLI event isolation', () => {
  it('ignores foreign-run events once a run is active', () => {
    let state = createInitialAppState();

    state = appReducer(state, {
      type: 'event',
      event: {
        type: 'pipeline:start',
        pipelineId: 'pipeline-A',
        runId: 'run-A',
        dataset: 'dataset-a',
        totalStages: 11,
        outputDir: '/tmp/a',
        timestamp: Date.now(),
      },
    });

    const stageStatusBefore = state.pipeline.stages[0].status;

    state = appReducer(state, {
      type: 'event',
      event: {
        type: 'stage:start',
        pipelineId: 'pipeline-B',
        runId: 'run-B',
        stageNumber: 1,
        name: 'DataMapProcessor',
        timestamp: Date.now(),
      },
    });

    expect(state.pipeline.stages[0].status).toBe(stageStatusBefore);

    state = appReducer(state, {
      type: 'event',
      event: {
        type: 'stage:start',
        pipelineId: 'pipeline-A',
        runId: 'run-A',
        stageNumber: 1,
        name: 'DataMapProcessor',
        timestamp: Date.now(),
      },
    });

    expect(state.pipeline.stages[0].status).toBe('running');
  });
});
