import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
}));

vi.mock('@/lib/requireConvexAuth', () => ({
  requireConvexAuth: vi.fn(async () => ({ convexOrgId: 'org-1', role: 'admin' })),
  AuthenticationError: class AuthenticationError extends Error {},
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
}));

vi.mock('@/lib/permissions', () => ({
  canPerform: vi.fn(() => true),
}));

vi.mock('@/lib/convex', () => ({
  getConvexClient: () => ({ query: mocks.query }),
  mutateInternal: mocks.mutateInternal,
}));

describe('checkpoint retry route', () => {
  let POST: typeof import('@/app/api/runs/[runId]/retry/route').POST;

  beforeEach(async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_RUN_CHECKPOINT_RETRY', 'true');
    if (!POST) {
      ({ POST } = await import('@/app/api/runs/[runId]/retry/route'));
    }
    vi.clearAllMocks();
  });

  it('queues a retry for an eligible failed run', async () => {
    mocks.query.mockResolvedValueOnce({
      _id: 'run-1',
      orgId: 'org-1',
      status: 'error',
      executionState: 'error',
      executionPayload: { sessionId: 'session-1' },
      recoveryManifest: {
        boundary: 'compute',
        resumeStage: 'executing_r',
        isComplete: true,
      },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/retry', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
  });

  it('returns 409 for ineligible runs', async () => {
    mocks.query.mockResolvedValueOnce({
      _id: 'run-1',
      orgId: 'org-1',
      status: 'error',
      executionState: 'error',
      executionPayload: { sessionId: 'session-1' },
      recoveryManifest: {
        boundary: 'compute',
        resumeStage: 'executing_r',
        isComplete: false,
      },
    });

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/retry', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: 'Durable recovery checkpoint is incomplete.',
    });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it('returns 404 when the feature is disabled', async () => {
    vi.stubEnv('NEXT_PUBLIC_ENABLE_RUN_CHECKPOINT_RETRY', 'false');

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/retry', { method: 'POST' }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: 'Checkpoint retry is disabled.',
    });
  });
});
