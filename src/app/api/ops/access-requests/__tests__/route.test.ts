import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireInternalOperator: vi.fn(),
  applyRateLimit: vi.fn(),
  queryInternal: vi.fn(),
}));

class MockAuthenticationError extends Error {}

vi.mock('@/lib/requireInternalOperator', () => ({
  requireInternalOperator: mocks.requireInternalOperator,
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: mocks.applyRateLimit,
}));

vi.mock('@/lib/convex', () => ({
  queryInternal: mocks.queryInternal,
}));

vi.mock('@/lib/auth', () => ({
  AuthenticationError: MockAuthenticationError,
}));

describe('GET /api/ops/access-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyRateLimit.mockReturnValue(null);
  });

  it('returns the internal request queue for allowlisted operators', async () => {
    mocks.requireInternalOperator.mockResolvedValue({ email: 'ops@tabulate-ai.com' });
    mocks.queryInternal.mockResolvedValue([{ _id: 'req_1', company: 'Example Co' }]);

    const { GET } = await import('@/app/api/ops/access-requests/route');
    const response = await GET();
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.applyRateLimit).toHaveBeenCalledWith(
      'ops@tabulate-ai.com',
      'low',
      'ops/access-requests/list',
    );
    expect(payload.requests).toEqual([{ _id: 'req_1', company: 'Example Co' }]);
  });

  it('returns 401 when the operator is not authorized', async () => {
    mocks.requireInternalOperator.mockRejectedValue(new MockAuthenticationError('Unauthorized'));

    const { GET } = await import('@/app/api/ops/access-requests/route');
    const response = await GET();

    expect(response.status).toBe(401);
  });
});
