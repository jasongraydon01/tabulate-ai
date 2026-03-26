/**
 * GET /api/maxdiff/template
 *
 * Returns a pre-formatted Excel template for MaxDiff message lists.
 * No authentication required — it's a static template.
 */

import { NextResponse } from 'next/server';
import { generateMessageTemplate } from '@/lib/maxdiff/generateMessageTemplate';

export async function GET() {
  try {
    const workbook = await generateMessageTemplate();
    const buffer = await workbook.xlsx.writeBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="maxdiff-message-template.xlsx"',
        'Cache-Control': 'public, max-age=86400', // Cache for 24 hours
      },
    });
  } catch (error) {
    console.error('[MaxDiff Template] Error generating template:', error);
    return NextResponse.json(
      { error: 'Failed to generate template' },
      { status: 500 }
    );
  }
}
