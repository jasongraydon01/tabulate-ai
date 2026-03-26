import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  getAuthorizationUrl: vi.fn(),
}));

vi.mock('@workos-inc/authkit-nextjs', () => ({
  getWorkOS: () => ({
    userManagement: {
      getAuthorizationUrl: mocks.getAuthorizationUrl,
    },
  }),
}));

describe('GET /auth/sign-in', () => {
  const originalEnv = {
    AUTH_BYPASS: process.env.AUTH_BYPASS,
    WORKOS_CLIENT_ID: process.env.WORKOS_CLIENT_ID,
    NEXT_PUBLIC_WORKOS_REDIRECT_URI: process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI,
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.AUTH_BYPASS = 'false';
    process.env.WORKOS_CLIENT_ID = 'client_test_123';
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = 'https://tabulate-ai.com/auth/callback';
    mocks.getAuthorizationUrl.mockReturnValue('https://authkit.test/authorize');
  });

  it('redirects to WorkOS with a sanitized return path in state', async () => {
    const { GET } = await import('@/app/auth/sign-in/route');

    const response = await GET(
      new NextRequest('https://tabulate-ai.com/auth/sign-in?returnTo=%2Fpricing%3FcheckoutPlan%3Dstarter'),
    );

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith({
      provider: 'authkit',
      clientId: 'client_test_123',
      redirectUri: 'https://tabulate-ai.com/auth/callback',
      screenHint: 'sign-in',
      state: expect.any(String),
    });
    expect(response.headers.get('location')).toBe('https://authkit.test/authorize');
  });

  it('falls back to /dashboard for unsafe return paths', async () => {
    const { GET } = await import('@/app/auth/sign-in/route');

    await GET(
      new NextRequest('https://tabulate-ai.com/auth/sign-in?returnTo=https%3A%2F%2Fevil.test'),
    );

    expect(mocks.getAuthorizationUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        state: 'eyJyZXR1cm5QYXRobmFtZSI6Ii9kYXNoYm9hcmQifQ==',
      }),
    );
  });

  it('short-circuits to the target route in bypass mode', async () => {
    process.env.AUTH_BYPASS = 'true';
    const { GET } = await import('@/app/auth/sign-in/route');

    const response = await GET(
      new NextRequest('https://tabulate-ai.com/auth/sign-in?returnTo=%2Fpricing'),
    );

    expect(mocks.getAuthorizationUrl).not.toHaveBeenCalled();
    expect(response.headers.get('location')).toBe('https://tabulate-ai.com/pricing');
  });

  afterAll(() => {
    process.env.AUTH_BYPASS = originalEnv.AUTH_BYPASS;
    process.env.WORKOS_CLIENT_ID = originalEnv.WORKOS_CLIENT_ID;
    process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI = originalEnv.NEXT_PUBLIC_WORKOS_REDIRECT_URI;
  });
});
