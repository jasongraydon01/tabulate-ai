import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
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
  mutateInternal: vi.fn(),
}));

describe('review route', () => {
  let POST: typeof import('@/app/api/runs/[runId]/review/route').POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import('@/app/api/runs/[runId]/review/route'));
    }
    vi.clearAllMocks();
  });

  it('returns 410 when run artifacts are expired', async () => {
    mocks.query.mockResolvedValueOnce({
      _id: 'run-1',
      orgId: 'org-1',
      projectId: 'project-1',
      status: 'success',
      expiredAt: Date.UTC(2026, 3, 20),
    });

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decisions: [] }),
      }),
      { params: Promise.resolve({ runId: 'run-1' }) },
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: 'Run artifacts have been removed after the 30-day retention period.',
    });
  });
});
