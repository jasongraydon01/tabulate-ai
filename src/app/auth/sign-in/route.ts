import { NextRequest, NextResponse } from 'next/server';
import { getWorkOS } from '@workos-inc/authkit-nextjs';
import { encodeAuthReturnState, sanitizeRelativeReturnTo } from '@/lib/navigation';

export async function GET(request: NextRequest) {
  const returnTo = sanitizeRelativeReturnTo(
    request.nextUrl.searchParams.get('returnTo'),
    '/dashboard',
  );

  if (process.env.AUTH_BYPASS === 'true') {
    return NextResponse.redirect(new URL(returnTo, request.url));
  }

  const clientId = process.env.WORKOS_CLIENT_ID;
  const redirectUri = process.env.NEXT_PUBLIC_WORKOS_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Authentication is not configured' }, { status: 500 });
  }

  const authorizationUrl = getWorkOS().userManagement.getAuthorizationUrl({
    provider: 'authkit',
    clientId,
    redirectUri,
    screenHint: 'sign-in',
    state: encodeAuthReturnState(returnTo),
  });

  return NextResponse.redirect(authorizationUrl);
}
