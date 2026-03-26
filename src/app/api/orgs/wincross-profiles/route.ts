import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api, internal } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { parseWinCrossPreferenceJob } from '@/lib/exportData/wincross/parser';

export async function GET() {
  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'orgs/wincross-profiles/list');
    if (rateLimited) return rateLimited;

    const convex = getConvexClient();
    const profiles = await convex.query(api.wincrossPreferenceProfiles.listByOrg, {
      orgId: auth.convexOrgId as Id<'organizations'>,
    });

    return NextResponse.json({ profiles });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[WinCross Profiles GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load WinCross profiles', details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'orgs/wincross-profiles/create');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'manage_wincross_profiles')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const formData = await request.formData().catch(() => null);
    if (!formData) {
      return NextResponse.json({ error: 'Invalid multipart form data' }, { status: 400 });
    }

    const name = String(formData.get('name') ?? '').trim();
    const description = String(formData.get('description') ?? '').trim();
    const isDefault = String(formData.get('isDefault') ?? '').toLowerCase() === 'true';
    const file = formData.get('file');

    if (!name) {
      return NextResponse.json({ error: 'Profile name is required' }, { status: 400 });
    }
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'A .job file is required' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = parseWinCrossPreferenceJob(buffer);
    const sourceFileHash = createHash('sha256').update(buffer).digest('hex');

    const profileId = await mutateInternal(internal.wincrossPreferenceProfiles.create, {
      orgId: auth.convexOrgId as Id<'organizations'>,
      name,
      description: description || undefined,
      profile: parsed.profile,
      diagnostics: parsed.diagnostics,
      sourceFileName: file.name,
      sourceFileHash,
      isDefault,
      createdBy: auth.convexUserId as Id<'users'>,
    });

    const convex = getConvexClient();
    const created = await convex.query(api.wincrossPreferenceProfiles.getById, {
      orgId: auth.convexOrgId as Id<'organizations'>,
      profileId,
    });

    return NextResponse.json(
      {
        success: true,
        profile: created,
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : 'Failed to create WinCross profile';
    if (
      message.includes('at most 10 WinCross profiles')
      || message.includes('already exists')
      || message.includes('Profile name is required')
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error('[WinCross Profiles POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create WinCross profile', details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
