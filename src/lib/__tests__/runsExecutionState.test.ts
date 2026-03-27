import { describe, expect, it } from 'vitest';

import { patchForStatusTransition } from '../../../convex/runs';

describe('patchForStatusTransition', () => {
  it('keeps worker-owned resuming runs in heartbeat-managed execution state', () => {
    const patch = patchForStatusTransition('claimed', 'resuming', 123);

    expect(patch).toEqual({
      executionState: 'running',
      lastHeartbeat: 123,
      heartbeatAt: 123,
    });
  });

  it('preserves queued execution state before a resuming run is claimed', () => {
    const patch = patchForStatusTransition('queued', 'resuming', 456);

    expect(patch).toEqual({
      executionState: 'queued',
      lastHeartbeat: 456,
    });
  });

  it('normalizes legacy resuming execution state back to running for heartbeat recovery', () => {
    const patch = patchForStatusTransition('resuming', 'resuming', 789);

    expect(patch).toEqual({
      executionState: 'running',
      lastHeartbeat: 789,
      heartbeatAt: 789,
    });
  });
});
