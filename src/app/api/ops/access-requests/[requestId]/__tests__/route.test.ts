import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireInternalOperator: vi.fn(),
  applyRateLimit: vi.fn(),
  mutateInternal: vi.fn(),
}));

class MockAuthenticationError extends Error {}

vi.mock('@/lib/requireInternalOperator', () => ({
  requireInternalOperator: mocks.requireInternalOperator,
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: mocks.applyRateLimit,
}));

vi.mock('@/lib/convex', () => ({
  mutateInternal: mocks.mutateInternal,
}));

vi.mock('@/lib/auth', () => ({
  AuthenticationError: MockAuthenticationError,
}));

describe('PATCH /api/ops/access-requests/[requestId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireInternalOperator.mockResolvedValue({ email: 'ops@tabulate-ai.com' });
    mocks.applyRateLimit.mockReturnValue(null);
  });

  it('updates request status and review notes for allowlisted operators', async () => {
    const { PATCH } = await import('@/app/api/ops/access-requests/[requestId]/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/ops/access-requests/req_1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'approved', reviewNotes: 'Provisioned in WorkOS' }),
      }),
      { params: Promise.resolve({ requestId: 'req_1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.applyRateLimit).toHaveBeenCalledWith(
      'ops@tabulate-ai.com',
      'low',
      'ops/access-requests/update',
    );
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        accessRequestId: 'req_1',
        status: 'approved',
        reviewedByEmail: 'ops@tabulate-ai.com',
        reviewNotes: 'Provisioned in WorkOS',
      }),
    );
  });

  it('rejects invalid statuses before mutating data', async () => {
    const { PATCH } = await import('@/app/api/ops/access-requests/[requestId]/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/ops/access-requests/req_1', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'pending' }),
      }),
      { params: Promise.resolve({ requestId: 'req_1' }) },
    );

    expect(response.status).toBe(400);
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });
});
