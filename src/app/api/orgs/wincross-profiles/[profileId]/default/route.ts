import { NextRequest, NextResponse } from 'next/server';

import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { mutateInternal } from '@/lib/convex';
import { internal } from '../../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../../convex/_generated/dataModel';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';

const CONVEX_ID_RE = /^[a-zA-Z0-9_]+$/;

export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> },
) {
  try {
    const { profileId } = await params;
    if (!profileId || !CONVEX_ID_RE.test(profileId)) {
      return NextResponse.json({ error: 'Invalid profile ID' }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'orgs/wincross-profiles/default');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'manage_wincross_profiles')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    await mutateInternal(internal.wincrossPreferenceProfiles.setDefault, {
      orgId: auth.convexOrgId as Id<'organizations'>,
      profileId: profileId as Id<'wincrossPreferenceProfiles'>,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : 'Failed to set default WinCross profile';
    if (message.includes('Profile not found')) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    console.error('[WinCross Profile Default PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to set default WinCross profile', details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
