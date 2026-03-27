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

  it('keeps the contact page and contact API public', async () => {
    const { middleware } = await import('@/middleware');
    expect(middleware).toBeTypeOf('function');

    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(`${process.cwd()}/src/middleware.ts`, 'utf8'),
    );

    expect(source).toContain('"/contact"');
    expect(source).toContain('"/api/contact"');
  });
});
