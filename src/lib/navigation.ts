import { buildRequestAccessPath } from '@/lib/accessRequests';

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

export function getMarketingPrimaryCta({
  isAuthenticated,
  hasWorkspaceAccess,
}: {
  isAuthenticated: boolean;
  hasWorkspaceAccess: boolean;
}): { href: string; label: string } {
  if (hasWorkspaceAccess) {
    return { href: '/dashboard', label: 'Dashboard' };
  }

  if (isAuthenticated) {
    return { href: buildRequestAccessPath('marketing'), label: 'Request Access' };
  }

  return { href: '/demo', label: 'Try Demo' };
}

export function getMarketingSecondaryCta({
  isAuthenticated,
  hasWorkspaceAccess,
}: {
  isAuthenticated: boolean;
  hasWorkspaceAccess: boolean;
}): { href: string; label: string } | null {
  if (hasWorkspaceAccess) {
    return null;
  }

  if (isAuthenticated) {
    return null;
  }

  return {
    href: buildRequestAccessPath('marketing'),
    label: 'Request Access',
  };
}
