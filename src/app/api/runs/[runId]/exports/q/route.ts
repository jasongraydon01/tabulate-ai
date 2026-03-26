import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api } from '../../../../../../../convex/_generated/api';
import { internal } from '../../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../../convex/_generated/dataModel';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails, shouldExposeApiErrorDetails } from '@/lib/api/errorDetails';
import { QExportPackageDescriptorSchema } from '@/lib/exportData/types';
import { generateQExportPackage } from '@/lib/exportData/q/service';
import { QExportServiceError } from '@/lib/exportData/q/types';
import { parseRunResult } from '@/schemas/runResultSchema';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function handleRequest(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  try {
    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'runs/export-q');
    if (rateLimited) return rateLimited;

    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<'runs'>,
      orgId: auth.convexOrgId as Id<"organizations">,
    });
    if (!run) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const runResult = parseRunResult(run.result);
    if (!runResult) {
      return NextResponse.json({ error: 'Run result is missing' }, { status: 422 });
    }

    const existingDescriptor = QExportPackageDescriptorSchema.safeParse(
      readRecord(readRecord(runResult.exportPackages)?.q),
    );

    const packageResult = await generateQExportPackage({
      runId,
      orgId: String(run.orgId),
      projectId: String(run.projectId),
      runResult,
      existingDescriptor: existingDescriptor.success ? existingDescriptor.data : null,
    });

    await mutateInternal(internal.runs.mergeExportPackage, {
      runId: runId as Id<'runs'>,
      platform: 'q',
      descriptor: {
        ...packageResult.descriptor,
        supportSummary: packageResult.manifest.supportSummary,
        blockedCount: packageResult.manifest.blockedItems.length,
        warningCount: packageResult.manifest.warnings.length,
        primaryDownloadPath: 'q/setup-project.QScript',
      },
    });

    return NextResponse.json(
      {
        runId,
        platform: 'q',
        cached: packageResult.cached,
        descriptor: packageResult.descriptor,
        downloadUrls: packageResult.downloadUrls,
        supportSummary: packageResult.manifest.supportSummary,
        blockedCount: packageResult.manifest.blockedItems.length,
        warningCount: packageResult.manifest.warnings.length,
      },
      { status: packageResult.cached ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (error instanceof QExportServiceError) {
      return NextResponse.json(
        {
          error: error.code,
          message: shouldExposeApiErrorDetails() ? error.message : 'Q export failed',
          details: shouldExposeApiErrorDetails() ? error.details : undefined,
        },
        { status: error.status },
      );
    }

    console.error('[Q Export API] Error:', error);
    Sentry.captureException(error, {
      tags: { route: '/api/runs/[runId]/exports/q', method: 'POST', run_id: runId },
    });
    return NextResponse.json(
      { error: 'Failed to generate Q export package', details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  return handleRequest(request, context);
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> },
) {
  return handleRequest(request, context);
}
