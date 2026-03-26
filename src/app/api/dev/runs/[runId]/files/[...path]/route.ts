/**
 * GET /api/dev/runs/[runId]/files/[...path]
 *
 * DEV ONLY: Download ANY pipeline file from R2 for debugging.
 * Unlike the production /download endpoint, this allows access to:
 * - R scripts (r/master.R)
 * - JSON outputs (results/tables.json, pipeline-summary.json)
 * - Validation logs
 * - Agent scratchpads
 * - Error logs
 *
 * Security: Only accessible in development or to admins.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getConvexClient } from '@/lib/convex';
import { api } from '../../../../../../../../convex/_generated/api';
import { getDownloadUrl } from '@/lib/r2/R2FileManager';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import type { Id } from '../../../../../../../../convex/_generated/dataModel';
import { parseRunResult } from '@/schemas/runResultSchema';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; path: string[] }> },
) {
  try {
    // Security check: only allow in development
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json(
        { error: 'This endpoint is only available in development' },
        { status: 403 }
      );
    }

    const { runId, path: pathSegments } = await params;

    if (!runId || !pathSegments || pathSegments.length === 0) {
      return NextResponse.json(
        { error: 'Run ID and file path are required' },
        { status: 400 }
      );
    }

    // Authenticate
    const auth = await requireConvexAuth();

    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });

    if (!run) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const result = parseRunResult(run.result);
    const r2Files = result?.r2Files;

    if (!r2Files?.outputs) {
      return NextResponse.json(
        { error: 'No R2 files available for this run' },
        { status: 404 }
      );
    }

    // Reconstruct the relative path from segments
    const relativePath = pathSegments.join('/');

    // Look up the R2 key for this path
    const r2Key = r2Files.outputs[relativePath];
    if (!r2Key) {
      return NextResponse.json(
        {
          error: `File not found: ${relativePath}`,
          hint: 'Available files',
          files: Object.keys(r2Files.outputs).sort()
        },
        { status: 404 }
      );
    }

    // Generate presigned URL (1 hour expiry)
    const filename = pathSegments[pathSegments.length - 1];
    const contentDisposition = `attachment; filename="${filename}"`;
    const url = await getDownloadUrl(r2Key, 3600, contentDisposition);

    // Redirect to presigned URL
    return NextResponse.redirect(url);
  } catch (error) {
    console.error('[Dev Files API] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: 'Failed to generate download URL',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}
