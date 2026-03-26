import { NextResponse } from 'next/server';
import { queryInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import { AuthenticationError } from '@/lib/auth';
import { requireInternalOperator } from '@/lib/requireInternalOperator';
import { applyRateLimit } from '@/lib/withRateLimit';

export async function GET() {
  try {
    const auth = await requireInternalOperator();

    const rateLimited = applyRateLimit(auth.email.trim().toLowerCase(), 'low', 'ops/access-requests/list');
    if (rateLimited) return rateLimited;

    const requests = await queryInternal(internal.accessRequests.listAll, {});
    return NextResponse.json({ requests });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error('[Access Requests Ops GET] Error:', error);
    return NextResponse.json({ error: 'Failed to load access requests' }, { status: 500 });
  }
}
