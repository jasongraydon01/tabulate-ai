import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  formatCheckpointBoundary,
  getCheckpointRetryAvailability,
  getCheckpointRetryLabel,
  isCheckpointRetryEnabled,
} from '@/lib/runs/checkpointRetry';

describe('checkpoint retry helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults checkpoint retry to enabled outside production', () => {
    vi.stubEnv('NODE_ENV', 'development');
    delete process.env.NEXT_PUBLIC_ENABLE_RUN_CHECKPOINT_RETRY;

    expect(isCheckpointRetryEnabled()).toBe(true);
  });

  it('defaults checkpoint retry to disabled in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    delete process.env.NEXT_PUBLIC_ENABLE_RUN_CHECKPOINT_RETRY;

    expect(isCheckpointRetryEnabled()).toBe(false);
  });

  it('honors an explicit checkpoint retry flag', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NEXT_PUBLIC_ENABLE_RUN_CHECKPOINT_RETRY', 'true');

    expect(isCheckpointRetryEnabled()).toBe(true);
  });

  it('marks complete durable recovery checkpoints as retryable', () => {
    expect(getCheckpointRetryAvailability({
      status: 'error',
      executionState: 'error',
      executionPayload: { sessionId: 'session-1' },
      recoveryManifest: {
        boundary: 'compute',
        resumeStage: 'executing_r',
        isComplete: true,
      },
    })).toEqual({ eligible: true });
  });

  it('rejects non-error runs and incomplete checkpoints', () => {
    expect(getCheckpointRetryAvailability({
      status: 'success',
      executionPayload: { sessionId: 'session-1' },
      recoveryManifest: {
        boundary: 'compute',
        resumeStage: 'executing_r',
        isComplete: true,
      },
    })).toEqual({
      eligible: false,
      reason: 'Only failed runs can retry from a checkpoint.',
    });

    expect(getCheckpointRetryAvailability({
      status: 'error',
      executionPayload: { sessionId: 'session-1' },
      recoveryManifest: {
        boundary: 'compute',
        resumeStage: 'executing_r',
        isComplete: false,
      },
    })).toEqual({
      eligible: false,
      reason: 'Durable recovery checkpoint is incomplete.',
    });
  });

  it('formats user-facing boundary labels', () => {
    expect(formatCheckpointBoundary('compute')).toBe('compute');
    expect(getCheckpointRetryLabel({ boundary: 'review_checkpoint' })).toBe(
      'Retry from review checkpoint',
    );
  });
});
