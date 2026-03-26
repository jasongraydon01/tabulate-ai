export function sanitizeRelativeReturnTo(value: string | null | undefined, fallback = '/dashboard'): string {
  if (!value) return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//')) return fallback;
  return value;
}

export function encodeAuthReturnState(returnTo: string): string {
  return Buffer.from(JSON.stringify({ returnPathname: returnTo }), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

export function buildSignInPath(returnTo = '/dashboard'): string {
  const sanitizedReturnTo = sanitizeRelativeReturnTo(returnTo);
  return `/auth/sign-in?returnTo=${encodeURIComponent(sanitizedReturnTo)}`;
}

export function getMarketingPrimaryCta(isAuthenticated: boolean): { href: string; label: string } {
  if (isAuthenticated) {
    return { href: '/dashboard', label: 'Dashboard' };
  }

  return { href: buildSignInPath('/dashboard'), label: 'Get Started' };
}
