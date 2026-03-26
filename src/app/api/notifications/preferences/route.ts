/**
 * GET/PATCH /api/notifications/preferences
 *
 * Read and update the current user's notification preferences.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { mutateInternal, queryInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import { applyRateLimit } from '@/lib/withRateLimit';

export async function GET() {
  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'notifications/preferences');
    if (rateLimited) return rateLimited;

    const user = await queryInternal(internal.users.get, {
      userId: auth.convexUserId as Id<"users">,
    });

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    // Default: pipelineEmails = true when preferences are absent
    const preferences = (user as Record<string, unknown>).notificationPreferences as
      | { pipelineEmails: boolean }
      | undefined;

    return NextResponse.json({
      pipelineEmails: preferences?.pipelineEmails ?? true,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Notifications Preferences GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'notifications/preferences');
    if (rateLimited) return rateLimited;

    let body: { pipelineEmails?: boolean };
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    if (typeof body.pipelineEmails !== 'boolean') {
      return NextResponse.json(
        { error: 'pipelineEmails must be a boolean' },
        { status: 400 },
      );
    }

    await mutateInternal(internal.users.updateNotificationPreferences, {
      userId: auth.convexUserId as Id<"users">,
      notificationPreferences: {
        pipelineEmails: body.pipelineEmails,
      },
    });

    return NextResponse.json({
      pipelineEmails: body.pipelineEmails,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Notifications Preferences PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
