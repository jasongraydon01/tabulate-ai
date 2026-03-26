/**
 * GET /api/demo/verify?token=xxx
 *
 * Verifies a demo user's email. If the pipeline is already complete,
 * triggers the output delivery email immediately. Otherwise, redirects
 * to the status page where they'll see progress.
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryInternal, mutateInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import { deliverDemoOutputIfReady } from '@/lib/demo/delivery';

export async function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get('token');
  if (!token) {
    return NextResponse.json({ error: 'Missing token' }, { status: 400 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tabulate-ai.com';
  const statusUrl = `${appUrl}/demo/status?token=${encodeURIComponent(token)}`;

  try {
    // Look up demo run
    const demoRun = await queryInternal(internal.demoRuns.getByToken, {
      verificationToken: token,
    });

    if (!demoRun) {
      return NextResponse.redirect(`${appUrl}/demo?error=invalid_token`);
    }

    // Check expiry (48 hours)
    const expiryMs = 48 * 60 * 60 * 1000;
    if (Date.now() - demoRun.createdAt > expiryMs) {
      return NextResponse.redirect(`${appUrl}/demo?error=expired`);
    }

    // Mark as verified (idempotent)
    await mutateInternal(internal.demoRuns.markVerified, {
      verificationToken: token,
    });

    // If pipeline is already complete, send output email now
    if (demoRun.pipelineStatus === 'success' || demoRun.pipelineStatus === 'partial') {
      if (!demoRun.outputSentAt && demoRun.outputTempDir) {
        // Fire-and-forget — don't block redirect
        deliverDemoOutputIfReady(demoRun._id, {
          tableCount: 25,
        }).catch(err => console.error('[Demo] Output email error after verify:', err));
      }
    }

    // Always redirect to status page
    return NextResponse.redirect(statusUrl);
  } catch (error) {
    console.error('[Demo] Verify error:', error);
    return NextResponse.redirect(statusUrl);
  }
}
