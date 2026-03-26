/**
 * GET /api/runs/[runId]/download/[...filename]
 * Download a pipeline output file via R2 presigned URL.
 * Looks up the R2 key from the run's result.r2Files, generates
 * a presigned URL with Content-Disposition for a user-friendly filename,
 * and redirects.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getConvexClient } from '@/lib/convex';
import { api } from '../../../../../../../convex/_generated/api';
import { getDownloadUrl } from '@/lib/r2/R2FileManager';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import type { Id } from '../../../../../../../convex/_generated/dataModel';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { buildDownloadFilename, buildPackageDownloadFilename } from '@/lib/utils/downloadFilename';
import { parseRunResult } from '@/schemas/runResultSchema';

// Map user-friendly filenames to the R2 output keys — crosstab Excel files only.
// Internal files (tables.json, master.R, pipeline-summary.json) are intentionally
// excluded to avoid leaking implementation details to end users.
const FILENAME_TO_OUTPUT_PATH: Record<string, string> = {
  'crosstabs.xlsx': 'results/crosstabs.xlsx',
  'crosstabs-weighted.xlsx': 'results/crosstabs-weighted.xlsx',
  'crosstabs-unweighted.xlsx': 'results/crosstabs-unweighted.xlsx',
  'crosstabs-counts.xlsx': 'results/crosstabs-counts.xlsx',
  'crosstabs-weighted-counts.xlsx': 'results/crosstabs-weighted-counts.xlsx',
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function basename(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  const parts = normalized.split('/');
  return parts[parts.length - 1] || normalized;
}

function normalizeRequestedPath(segments: string[]): string | null {
  if (segments.length === 0) return null;
  const normalizedSegments = segments
    .map((segment) => segment.replace(/\\/g, '/'))
    .filter((segment) => segment.length > 0);
  if (normalizedSegments.length !== segments.length) return null;
  if (normalizedSegments.some((segment) => segment === '.' || segment === '..' || segment.includes('/'))) {
    return null;
  }
  return normalizedSegments.join('/');
}

function resolvePackageArtifactKey(
  result: Record<string, unknown> | undefined,
  relativePath: string,
): string | null {
  const exportPackages = readRecord(result?.exportPackages);
  if (!exportPackages) return null;

  for (const platform of ['q', 'wincross']) {
    const descriptor = readRecord(exportPackages[platform]);
    const files = readRecord(descriptor?.files);
    if (!files) continue;
    const exactKey = files[relativePath];
    if (typeof exactKey === 'string') {
      return exactKey;
    }
  }

  if (relativePath.includes('/')) return null;

  const candidates: string[] = [];
  for (const platform of ['q', 'wincross']) {
    const descriptor = readRecord(exportPackages[platform]);
    const files = readRecord(descriptor?.files);
    if (!files) continue;
    for (const [candidatePath, key] of Object.entries(files)) {
      if (typeof key !== 'string') continue;
      if (basename(candidatePath) === relativePath) {
        candidates.push(key);
      }
    }
  }

  if (candidates.length === 0) return null;
  if (candidates.length > 1) return null;
  return candidates[0];
}


export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; filename: string[] }> },
) {
  try {
    const { runId, filename: filenameSegments } = await params;
    const requestedPath = normalizeRequestedPath(filenameSegments);

    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId) || !requestedPath) {
      return NextResponse.json({ error: 'Run ID and filename are required' }, { status: 400 });
    }

    // Authenticate and verify org ownership
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'runs/download');
    if (rateLimited) return rateLimited;

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

    if (!r2Files?.outputs && !readRecord(readRecord(result?.exportPackages)?.q) && !readRecord(readRecord(result?.exportPackages)?.wincross)) {
      return NextResponse.json({ error: 'No R2 files available for this run' }, { status: 404 });
    }

    // Look up the output path for this filename
    const outputPath = FILENAME_TO_OUTPUT_PATH[requestedPath] ?? requestedPath;
    const r2Key = outputPath
      ? r2Files?.outputs?.[outputPath]
      : null;
    const packageKey = resolvePackageArtifactKey(result, requestedPath);
    const resolvedKey = r2Key ?? packageKey;
    if (!resolvedKey) {
      return NextResponse.json(
        { error: `File not available: ${requestedPath}` },
        { status: 404 },
      );
    }

    const filename = basename(requestedPath);
    let contentDisposition: string | undefined;
    try {
      const project = await convex.query(api.projects.get, {
        projectId: run.projectId,
        orgId: auth.convexOrgId as Id<"organizations">,
      });
      if (project?.name) {
        const friendlyFilename = requestedPath.endsWith('.xlsx')
          ? buildDownloadFilename(project.name, run._creationTime, filename)
          : buildPackageDownloadFilename(project.name, run._creationTime, requestedPath) ?? filename;
        contentDisposition = `attachment; filename="${friendlyFilename}"`;
      }
    } catch {
      // Non-fatal — fall back to default filename from R2
    }

    // Generate presigned URL (1 hour expiry) with optional Content-Disposition
    const url = await getDownloadUrl(resolvedKey, 3600, contentDisposition);

    // Redirect to presigned URL
    return NextResponse.redirect(url);
  } catch (error) {
    console.error('[Download API] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Failed to generate download URL', details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
