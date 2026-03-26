import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api } from '../../../../../../../convex/_generated/api';
import { internal } from '../../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../../convex/_generated/dataModel';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails, shouldExposeApiErrorDetails } from '@/lib/api/errorDetails';
import {
  WinCrossExportPackageDescriptorSchema,
} from '@/lib/exportData/types';
import { generateWinCrossExportPackage } from '@/lib/exportData/wincross/service';
import { WinCrossExportServiceError } from '@/lib/exportData/wincross/types';
import type { WinCrossPreferenceSource } from '@/lib/exportData/wincross/preferenceResolver';
import { parseRunResult } from '@/schemas/runResultSchema';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractRequestedProfileId(body: unknown): string | null {
  const record = readRecord(body);
  if (!record) return null;

  if (typeof record.profileId === 'string' && record.profileId.trim().length > 0) {
    return record.profileId.trim();
  }
  return null;
}

async function extractPreferenceSource(
  convex: ReturnType<typeof getConvexClient>,
  body: unknown,
  orgId: Id<'organizations'>,
  fallbackProfileId?: string,
): Promise<WinCrossPreferenceSource> {
  const record = readRecord(body);
  if (record && typeof record.preferenceSource === 'string' && record.preferenceSource === 'default') {
    return { kind: 'default' };
  }

  const requestedProfileId = extractRequestedProfileId(body) ?? fallbackProfileId;
  if (requestedProfileId) {
    const profile = await convex.query(api.wincrossPreferenceProfiles.getById, {
      orgId,
      profileId: requestedProfileId as Id<'wincrossPreferenceProfiles'>,
    });
    if (profile) {
      return {
        kind: 'org_profile',
        profileId: String(profile._id),
        profile: profile.profile,
        diagnostics: profile.diagnostics,
        profileName: profile.name,
      };
    }
  }

  if (!record) {
    return { kind: 'default' };
  }

  if (typeof record.preferenceSource === 'string' && record.preferenceSource === 'embedded_reference:hcp_vaccines') {
    return { kind: 'embedded_reference', referenceId: 'hcp_vaccines' };
  }

  if (typeof record.preferenceJobText === 'string' && record.preferenceJobText.trim().length > 0) {
    return { kind: 'inline_job', content: Buffer.from(record.preferenceJobText, 'utf8') };
  }

  if (typeof record.preferenceJobBase64 === 'string' && record.preferenceJobBase64.trim().length > 0) {
    try {
      return { kind: 'inline_job', content: Buffer.from(record.preferenceJobBase64, 'base64') };
    } catch {
      return { kind: 'default' };
    }
  }

  return { kind: 'default' };
}

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  try {
    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'runs/export-wincross');
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

    const body = request.method === 'POST'
      ? await request.json().catch(() => null)
      : null;
    const fallbackProfileId = typeof run.config?.wincrossProfileId === 'string'
      ? run.config.wincrossProfileId
      : undefined;
    const preferenceSource = await extractPreferenceSource(
      convex,
      body,
      run.orgId,
      fallbackProfileId,
    );

    const existingDescriptor = WinCrossExportPackageDescriptorSchema.safeParse(
      readRecord(readRecord(runResult.exportPackages)?.wincross),
    );

    const packageResult = await generateWinCrossExportPackage({
      runId,
      orgId: String(run.orgId),
      projectId: String(run.projectId),
      runResult,
      existingDescriptor: existingDescriptor.success ? existingDescriptor.data : null,
      preferenceSource,
    });

    await mutateInternal(internal.runs.mergeExportPackage, {
      runId: runId as Id<'runs'>,
      platform: 'wincross',
      descriptor: {
        ...packageResult.descriptor,
        supportSummary: packageResult.manifest.supportSummary,
        blockedCount: packageResult.manifest.blockedCount,
        warningCount: packageResult.manifest.warnings.length,
        primaryDownloadPath: packageResult.descriptor.archivePath ?? 'wincross/export.zip',
        parseDiagnostics: packageResult.diagnostics,
      },
    });

    return NextResponse.json(
      {
        runId,
        platform: 'wincross',
        cached: packageResult.cached,
        descriptor: packageResult.descriptor,
        downloadUrls: packageResult.downloadUrls,
        supportSummary: packageResult.manifest.supportSummary,
        blockedCount: packageResult.manifest.blockedCount,
        warningCount: packageResult.manifest.warnings.length,
        parseDiagnostics: packageResult.diagnostics,
      },
      { status: packageResult.cached ? 200 : 201 },
    );
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (error instanceof WinCrossExportServiceError) {
      return NextResponse.json(
        {
          error: error.code,
          message: shouldExposeApiErrorDetails() ? error.message : 'WinCross export failed',
          details: shouldExposeApiErrorDetails() ? error.details : undefined,
        },
        { status: error.status },
      );
    }

    console.error('[WinCross Export API] Error:', error);
    Sentry.captureException(error, {
      tags: { route: '/api/runs/[runId]/exports/wincross', method: 'POST', run_id: runId },
    });
    return NextResponse.json(
      { error: 'Failed to generate WinCross export package', details: getApiErrorDetails(error) },
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
