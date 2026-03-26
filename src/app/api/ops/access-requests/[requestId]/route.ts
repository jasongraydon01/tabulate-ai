import { NextRequest, NextResponse } from 'next/server';
import { mutateInternal } from '@/lib/convex';
import { internal } from '../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import { AuthenticationError } from '@/lib/auth';
import { requireInternalOperator } from '@/lib/requireInternalOperator';
import { applyRateLimit } from '@/lib/withRateLimit';

const CONVEX_ID_RE = /^[a-zA-Z0-9_]+$/;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ requestId: string }> },
) {
  try {
    const auth = await requireInternalOperator();
    const { requestId } = await params;

    const rateLimited = applyRateLimit(auth.email.trim().toLowerCase(), 'low', 'ops/access-requests/update');
    if (rateLimited) return rateLimited;

    if (!requestId || !CONVEX_ID_RE.test(requestId)) {
      return NextResponse.json({ error: 'Invalid access request ID' }, { status: 400 });
    }

    const body = await request.json().catch(() => null);
    const status = body?.status;
    const reviewNotes = typeof body?.reviewNotes === 'string'
      ? body.reviewNotes.trim() || undefined
      : undefined;

    if (status !== 'approved' && status !== 'rejected') {
      return NextResponse.json({ error: 'Invalid review status' }, { status: 400 });
    }

    await mutateInternal(internal.accessRequests.updateReviewStatus, {
      accessRequestId: requestId as Id<'accessRequests'>,
      status,
      reviewedByEmail: auth.email.trim().toLowerCase(),
      ...(reviewNotes ? { reviewNotes } : {}),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const message = error instanceof Error ? error.message : 'Failed to update access request';
    if (message.includes('not found')) {
      return NextResponse.json({ error: 'Access request not found' }, { status: 404 });
    }

    console.error('[Access Requests Ops PATCH] Error:', error);
    return NextResponse.json({ error: 'Failed to update access request' }, { status: 500 });
  }
}
