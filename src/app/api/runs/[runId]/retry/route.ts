import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';

import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api } from '../../../../../../convex/_generated/api';
import { internal } from '../../../../../../convex/_generated/api';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { getCheckpointRetryAvailability, isCheckpointRetryEnabled } from '@/lib/runs/checkpointRetry';
import type { Id } from '../../../../../../convex/_generated/dataModel';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;

  try {
    if (!isCheckpointRetryEnabled()) {
      return NextResponse.json({ error: 'Checkpoint retry is disabled.' }, { status: 404 });
    }

    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }

    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'runs/retry');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'cancel_run')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<'runs'>,
      orgId: auth.convexOrgId as Id<'organizations'>,
    });
    if (!run) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const availability = getCheckpointRetryAvailability({
      status: run.status,
      expiredAt: run.expiredAt,
      executionState: run.executionState,
      executionPayload: run.executionPayload,
      recoveryManifest: run.recoveryManifest,
    });
    if (!availability.eligible) {
      return NextResponse.json(
        { error: availability.reason ?? 'Run is not eligible for checkpoint retry.' },
        { status: 409 },
      );
    }

    await mutateInternal(internal.runs.enqueueCheckpointRetry, {
      runId: runId as Id<'runs'>,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[Checkpoint Retry API] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    Sentry.captureException(error, {
      tags: { route: '/api/runs/[runId]/retry', method: 'POST', run_id: runId },
    });
    return NextResponse.json(
      { error: 'Failed to queue checkpoint retry', details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
