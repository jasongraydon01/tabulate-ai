import { describe, expect, it, vi } from 'vitest';

vi.mock('@workos-inc/authkit-nextjs', () => ({
  authkitMiddleware: vi.fn(() => vi.fn()),
}));

describe('middleware config', () => {
  it('runs the WorkOS middleware on public routes so auth-aware marketing pages can read the current session', async () => {
    const { config } = await import('@/middleware');

    expect(config.matcher).toContain(
      '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)',
    );
  });
});
