/**
 * GET /api/generate-tables/[sessionId]
 * Purpose: Convert crosstab validation output into cut tables (JSON + CSV)
 * Reads: temp-outputs/<sessionId>/crosstab-output-*.json
 * Writes: temp-outputs/<sessionId>/{cut-tables.json, cut-tables.csv}
 *
 * @deprecated Legacy endpoint — no org ownership verification on session data.
 * The main pipeline uses Convex-backed runs with proper org scoping.
 * Remove once all clients migrate to the Convex pipeline flow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import * as path from 'path';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import { buildCutTable } from '@/lib/tables/CutTable';
import { exportCutTableToCSV } from '@/lib/exporters/csv';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { applyRateLimit } from '@/lib/withRateLimit';

export async function GET(_req: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  // Legacy route gate — disabled in production by default (Phase 8.5)
  if (process.env.ENABLE_LEGACY_SESSION_ROUTES !== 'true') {
    return NextResponse.json({ error: 'This endpoint has been retired' }, { status: 410 });
  }

  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'medium', 'generate-tables');
    if (rateLimited) return rateLimited;

    const { sessionId } = await params;
    console.warn(`[generate-tables] DEPRECATED: Legacy session endpoint called for ${sessionId}. No org ownership verification.`);
    if (!/^output-[a-zA-Z0-9_-]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
    }

    const sessionPath = path.join(process.cwd(), 'temp-outputs', sessionId);
    await fs.access(sessionPath);

    const files = await fs.readdir(sessionPath);
    const crosstabFile = files.find((f) => f.includes('crosstab-output') && f.endsWith('.json'));
    if (!crosstabFile) {
      return NextResponse.json({ error: 'No crosstab output found for session' }, { status: 404 });
    }

    const crosstabPath = path.join(sessionPath, crosstabFile);
    const content = await fs.readFile(crosstabPath, 'utf-8');
    const validation = JSON.parse(content) as ValidationResultType;

    const table = buildCutTable(validation, sessionId);
    const csv = exportCutTableToCSV(table);

    const jsonOut = path.join(sessionPath, 'cut-tables.json');
    const csvOut = path.join(sessionPath, 'cut-tables.csv');
    await Promise.all([
      fs.writeFile(jsonOut, JSON.stringify(table, null, 2), 'utf-8'),
      fs.writeFile(csvOut, csv, 'utf-8'),
    ]);

    return NextResponse.json({
      success: true,
      sessionId,
      files: {
        json: `temp-outputs/${sessionId}/cut-tables.json`,
        csv: `temp-outputs/${sessionId}/cut-tables.csv`,
      },
      groupCount: table.stats.groupCount,
      columnCount: table.stats.columnCount,
      averageConfidence: Number(table.stats.averageConfidence.toFixed(3)),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate tables' },
      { status: 500 },
    );
  }
}


