/**
 * GET /api/export-workbook/[sessionId]
 * Purpose: Generate Excel workbook from tables.json
 * Reads: results/tables.json
 * Returns: Excel workbook download
 *
 * @deprecated Legacy endpoint — no org ownership verification on session data.
 * The main pipeline uses Convex-backed runs with proper org scoping.
 * Remove once all clients migrate to the Convex pipeline flow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import * as path from 'path';
import { formatTablesFileToBuffer } from '@/lib/excel/ExcelFormatter';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  // Legacy route gate — disabled in production by default (Phase 8.5)
  if (process.env.ENABLE_LEGACY_SESSION_ROUTES !== 'true') {
    return NextResponse.json({ error: 'This endpoint has been retired' }, { status: 410 });
  }

  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'medium', 'export-workbook');
    if (rateLimited) return rateLimited;

    const { sessionId } = await params;
    console.warn(`[export-workbook] DEPRECATED: Legacy session endpoint called for ${sessionId}. No org ownership verification.`);

    // Strict allowlist — alphanumeric, underscore, hyphen after known prefixes
    if (!/^(output|test-pipeline)-[a-zA-Z0-9_-]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
    }

    const sessionPath = path.join(process.cwd(), 'temp-outputs', sessionId);
    const resultsDir = path.join(sessionPath, 'results');
    const tablesJsonPath = path.join(resultsDir, 'tables.json');

    // Check if tables.json exists
    try {
      await fs.access(tablesJsonPath);
    } catch {
      return NextResponse.json(
        { error: 'No tables.json found. Execute R script first.' },
        { status: 404 }
      );
    }

    console.log(`[Excel Export] Formatting tables.json from: ${sessionId}`);

    // Format tables.json to Excel buffer
    const buffer = await formatTablesFileToBuffer(tablesJsonPath);

    console.log(`[Excel Export] Generated workbook: ${buffer.byteLength} bytes`);

    // Return as downloadable file (convert Buffer to Uint8Array for NextResponse)
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="crosstabs-${sessionId}.xlsx"`,
        'Content-Length': buffer.byteLength.toString()
      }
    });

  } catch (error) {
    console.error('[Excel Export] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: 'Failed to generate Excel workbook',
        details: getApiErrorDetails(error),
      },
      { status: 500 }
    );
  }
}
