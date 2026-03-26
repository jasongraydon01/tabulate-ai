import { describe, expect, it } from 'vitest';

import { getPipelineEventBus, resetPipelineEventBus } from '../PipelineEventBus';
import { runWithPipelineContext } from '../../pipeline/PipelineContext';
import type { PipelineEvent } from '../types';

describe('PipelineEventBus run scoping', () => {
  it('attaches pipelineId and runId to emitted events', async () => {
    resetPipelineEventBus();
    const bus = getPipelineEventBus();
    bus.enable();

    const captured: PipelineEvent[] = [];
    const handler = (event: PipelineEvent) => {
      captured.push(event);
    };

    bus.on('*', handler);

    await runWithPipelineContext(
      { pipelineId: 'pipeline-evt', runId: 'run-evt', source: 'pipelineRunner' },
      async () => {
        bus.emitPipelineStart('dataset-a', 11, '/tmp/out');
        bus.emitStageStart(1, 'DataMapProcessor');
        bus.emitSlotLog('VerificationAgent', 'table-1', 'review', 'checking table');
        bus.emitPipelineComplete('dataset-a', 1000, 0.25, 12, '/tmp/out');
      },
    );

    bus.off('*', handler);

    expect(captured.length).toBeGreaterThan(0);
    for (const event of captured) {
      expect(event.pipelineId).toBe('pipeline-evt');
      expect(event.runId).toBe('run-evt');
    }
  });
});
