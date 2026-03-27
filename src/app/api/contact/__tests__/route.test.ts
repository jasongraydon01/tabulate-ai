import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  applyRateLimit: vi.fn(),
  sendContactNotification: vi.fn(),
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: mocks.applyRateLimit,
}));

vi.mock('@/lib/contactNotifications', () => ({
  sendContactNotification: mocks.sendContactNotification,
}));

describe('POST /api/contact', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.applyRateLimit.mockReturnValue(null);
    mocks.sendContactNotification.mockResolvedValue(true);
  });

  it('accepts a valid contact submission and triggers an internal notification', async () => {
    const { POST } = await import('@/app/api/contact/route');
    const request = new NextRequest('http://localhost/api/contact', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.25',
      },
      body: JSON.stringify({
        name: 'Casey Analyst',
        email: 'casey@example.com',
        company: 'Example Co',
        topic: 'billing',
        message: 'Can you help me understand which plan fits our team?',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(201);
    expect(payload).toEqual({ success: true });
    expect(mocks.applyRateLimit).toHaveBeenCalledWith('198.51.100.25', 'demo', 'contact/create');
    expect(mocks.sendContactNotification).toHaveBeenCalledWith({
      name: 'Casey Analyst',
      email: 'casey@example.com',
      company: 'Example Co',
      topic: 'billing',
      message: 'Can you help me understand which plan fits our team?',
    });
  });

  it('rejects invalid submissions', async () => {
    const { POST } = await import('@/app/api/contact/route');
    const request = new NextRequest('http://localhost/api/contact', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '',
        email: 'bad-email',
        topic: 'general',
        message: '',
      }),
    });

    const response = await POST(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toBeTruthy();
    expect(mocks.sendContactNotification).not.toHaveBeenCalled();
  });
});
