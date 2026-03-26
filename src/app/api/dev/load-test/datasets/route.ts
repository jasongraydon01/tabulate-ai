/**
 * GET /api/dev/load-test/datasets
 *
 * Returns the test dataset manifest from R2.
 * Admin-only, dev-mode only.
 */

import { NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { downloadFile } from '@/lib/r2/r2';
import type { TestDatasetManifest } from '@/lib/loadTest/types';

export async function GET() {
  // Dev-only gate
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'dev/load-test/datasets');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'delete_project')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Download manifest from R2
    const buffer = await downloadFile('dev-test/manifest.json');
    const manifest: TestDatasetManifest = JSON.parse(buffer.toString('utf-8'));

    return NextResponse.json(manifest);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error('[LoadTest/datasets] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch dataset manifest. Run the upload script first.' },
      { status: 500 },
    );
  }
}
