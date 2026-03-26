/**
 * POST /api/validate-data
 *
 * Accepts a .sav data file, runs ValidationRunner, and returns
 * weight candidates, stacked detection, row/column counts, and data quality issues.
 * Used by the wizard Step 2B to validate data before pipeline launch.
 */

import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { applyRateLimit } from '@/lib/withRateLimit';
import { validate } from '@/lib/validation/ValidationRunner';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';

// Allow large .sav file uploads and time for validation
export const maxDuration = 120; // 2 minutes
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

export async function POST(request: NextRequest) {
  // Temp directory for this validation — cleaned up in finally block
  let tempDir: string | null = null;

  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'high', 'validate-data');
    if (rateLimited) return rateLimited;

    // Reject oversized uploads early
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Upload too large (${Math.round(contentLength / 1024 / 1024)}MB). Maximum is 100MB.` },
        { status: 413 }
      );
    }

    const formData = await request.formData();
    const dataFile = formData.get('dataFile') as File | null;

    if (!dataFile) {
      return NextResponse.json(
        { error: 'Missing required field: dataFile (.sav)' },
        { status: 400 }
      );
    }

    if (!dataFile.name.toLowerCase().endsWith('.sav')) {
      return NextResponse.json(
        { error: 'Data file must be a .sav (SPSS) file' },
        { status: 400 }
      );
    }

    if (dataFile.size > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Data file is too large (${Math.round(dataFile.size / 1024 / 1024)}MB). Maximum is 100MB.` },
        { status: 413 }
      );
    }

    // Save to temp directory
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ct-validate-'));
    const spssPath = path.join(tempDir, 'dataFile.sav');
    const buffer = Buffer.from(await dataFile.arrayBuffer());
    await fs.writeFile(spssPath, buffer);

    // Run validation — skip loop detection (V3 handles loops in enrichment chain stage 10a)
    const report = await validate({ spssPath, outputDir: tempDir, skipLoopDetection: true });

    // Build response
    const columnCount = report.processingResult?.verbose?.length ?? 0;
    const rowCount = report.dataFileStats?.rowCount ?? 0;

    const weightCandidates = (report.weightDetection?.candidates ?? []).map((c) => ({
      column: c.column,
      label: c.label,
      score: c.score,
      mean: c.mean,
    }));

    const isStacked = report.fillRateResults.some((r) => r.pattern === 'likely_stacked');
    const stackedResult = report.fillRateResults.find((r) => r.pattern === 'likely_stacked');
    const stackedWarning = stackedResult?.explanation ?? null;

    // Filter out noise warnings the UI handles via dedicated sections:
    // - Stage 4 weight candidate warnings → shown via weightCandidates UI
    const filteredWarnings = report.warnings.filter(
      (w) => w.stage !== 4
    );

    const errors: { message: string; severity: 'error' | 'warning' }[] = [
      ...report.errors.map((e) => ({ message: e.message, severity: 'error' as const })),
      ...filteredWarnings.map((w) => ({ message: w.message, severity: 'warning' as const })),
    ];

    return NextResponse.json({
      rowCount,
      columnCount,
      weightCandidates,
      isStacked,
      stackedWarning,
      errors,
      canProceed: report.canProceed && !isStacked,
    });
  } catch (error) {
    console.error('[validate-data] Error:', error);

    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    Sentry.captureException(error, {
      tags: { route: '/api/validate-data', method: 'POST' },
    });

    return NextResponse.json(
      {
        error: 'Validation failed',
        details: getApiErrorDetails(error),
      },
      { status: 500 }
    );
  } finally {
    // Clean up temp directory
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}
