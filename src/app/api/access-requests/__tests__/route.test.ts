import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  applyRateLimit: vi.fn(),
  queryInternal: vi.fn(),
  mutateInternal: vi.fn(),
  sendConfirmation: vi.fn(),
  sendInternal: vi.fn(),
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: mocks.applyRateLimit,
}));

vi.mock('@/lib/convex', () => ({
  queryInternal: mocks.queryInternal,
  mutateInternal: mocks.mutateInternal,
}));

vi.mock('@/lib/accessRequestNotifications', () => ({
  sendAccessRequestConfirmationEmail: mocks.sendConfirmation,
  sendAccessRequestInternalNotification: mocks.sendInternal,
}));

describe('POST /api/access-requests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyRateLimit.mockReturnValue(null);
    mocks.sendConfirmation.mockResolvedValue(true);
    mocks.sendInternal.mockResolvedValue(true);
  });

  it('creates a new access request and links it to a demo run when a token is present', async () => {
    mocks.queryInternal
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ _id: 'demo_run_123' });

    const { POST } = await import('@/app/api/access-requests/route');
    const request = new NextRequest('http://localhost/api/access-requests', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.20',
      },
      body: JSON.stringify({
        name: 'Casey Analyst',
        email: 'Casey@Example.com',
        company: 'Example Co',
        source: 'demo_status',
        demoToken: 'demo-token-1',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ success: true });
    expect(mocks.applyRateLimit).toHaveBeenCalledWith('198.51.100.20', 'demo', 'access-requests/create');
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        name: 'Casey Analyst',
        email: 'casey@example.com',
        company: 'Example Co',
        emailDomain: 'example.com',
        source: 'demo_status',
        demoRunId: 'demo_run_123',
      }),
    );
    expect(mocks.sendConfirmation).toHaveBeenCalled();
    expect(mocks.sendInternal).toHaveBeenCalled();
  });

  it('treats duplicate pending requests as idempotent', async () => {
    mocks.queryInternal.mockResolvedValueOnce({ _id: 'existing_request' });

    const { POST } = await import('@/app/api/access-requests/route');
    const request = new NextRequest('http://localhost/api/access-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Casey Analyst',
        email: 'casey@example.com',
        company: 'Example Co',
        source: 'pricing',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
    expect(mocks.sendConfirmation).toHaveBeenCalled();
    expect(mocks.sendInternal).toHaveBeenCalled();
  });

  it('rejects free-email domains', async () => {
    const { POST } = await import('@/app/api/access-requests/route');
    const request = new NextRequest('http://localhost/api/access-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Casey Analyst',
        email: 'casey@gmail.com',
        company: 'Example Co',
        source: 'marketing',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toContain('work email');
    expect(mocks.queryInternal).not.toHaveBeenCalled();
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });
});
