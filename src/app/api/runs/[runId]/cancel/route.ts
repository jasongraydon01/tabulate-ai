/**
 * POST /api/runs/[runId]/cancel
 * Cancel a pipeline run via Convex + in-memory AbortController.
 */
import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api } from '../../../../../../convex/_generated/api';
import { internal } from '../../../../../../convex/_generated/api';
import { abortRun, cleanupAbort } from '@/lib/abortStore';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;
  try {
    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }

    // Authenticate, verify role, and verify org ownership
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'runs/cancel');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'cancel_run')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const convex = getConvexClient();

    const run = await convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });
    if (!run) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Update Convex status to cancelled
    await mutateInternal(internal.runs.requestCancel, {
      runId: runId as Id<"runs">,
    });

    // Abort local process if running on this server
    const aborted = abortRun(runId);
    // Always cleanup stale controllers after cancel request.
    cleanupAbort(runId);

    return NextResponse.json({
      success: true,
      localAbort: aborted,
    });
  } catch (error) {
    console.error('[Cancel API] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    Sentry.captureException(error, {
      tags: { route: '/api/runs/[runId]/cancel', method: 'POST', run_id: runId },
    });
    return NextResponse.json(
      { error: 'Failed to cancel run', details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}
