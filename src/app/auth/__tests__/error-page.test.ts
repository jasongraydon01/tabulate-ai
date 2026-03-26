import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/auth/sign-out-button', () => ({
  SignOutButton: () => React.createElement('button', null, 'Sign out'),
}));

vi.mock('@/app/auth/error/sign-out-button', () => ({
  SignOutButton: () => React.createElement('button', null, 'Sign out'),
}));

vi.mock('@/app/auth/actions', () => ({
  authSignOutAction: vi.fn(),
}));

describe('auth error page', () => {
  it('shows request-access guidance for users without a workspace', async () => {
    const { default: AuthErrorPage } = await import('@/app/auth/error/page');

    const markup = renderToStaticMarkup(
      await AuthErrorPage({
        searchParams: Promise.resolve({ reason: 'no-org' }),
      }),
    );

    expect(markup).toContain('Workspace setup required');
    expect(markup).toContain('/request-access?source=auth_no_org');
    expect(markup).toContain('Request Access');
  });
});
