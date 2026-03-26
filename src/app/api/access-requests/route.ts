import { NextRequest, NextResponse } from 'next/server';
import { mutateInternal, queryInternal } from '@/lib/convex';
import { internal } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import {
  AccessRequestSubmissionSchema,
  extractEmailDomain,
  isFreeEmailDomain,
  normalizeEmail,
  sanitizeOptionalText,
} from '@/lib/accessRequests';
import { applyRateLimit } from '@/lib/withRateLimit';
import {
  sendAccessRequestConfirmationEmail,
  sendAccessRequestInternalNotification,
} from '@/lib/accessRequestNotifications';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimited = applyRateLimit(ip, 'demo', 'access-requests/create');
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = AccessRequestSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json({ error: firstIssue?.message || 'Invalid request' }, { status: 400 });
    }

    const normalizedEmail = normalizeEmail(parsed.data.email);
    const emailDomain = extractEmailDomain(normalizedEmail);
    if (!emailDomain) {
      return NextResponse.json({ error: 'Enter a valid work email' }, { status: 400 });
    }

    if (isFreeEmailDomain(emailDomain)) {
      return NextResponse.json(
        { error: 'Use your work email so we can set up the right workspace.' },
        { status: 400 },
      );
    }

    const normalizedInitialAdminEmail = parsed.data.initialAdminEmail
      ? normalizeEmail(parsed.data.initialAdminEmail)
      : undefined;

    const existingPending = await queryInternal(internal.accessRequests.getPendingByEmail, {
      email: normalizedEmail,
    });

    if (!existingPending) {
      let demoRunId: Id<'demoRuns'> | undefined;

      if (parsed.data.demoToken) {
        const demoRun = await queryInternal(internal.demoRuns.getByToken, {
          verificationToken: parsed.data.demoToken,
        });
        if (demoRun?._id) {
          demoRunId = demoRun._id as Id<'demoRuns'>;
        }
      }

      await mutateInternal(internal.accessRequests.create, {
        name: parsed.data.name.trim(),
        email: normalizedEmail,
        company: parsed.data.company.trim(),
        emailDomain,
        initialAdminEmail: normalizedInitialAdminEmail,
        notes: sanitizeOptionalText(parsed.data.notes),
        source: parsed.data.source,
        ...(demoRunId ? { demoRunId } : {}),
      });
    }

    void sendAccessRequestConfirmationEmail({
      to: normalizedEmail,
      name: parsed.data.name.trim(),
      company: parsed.data.company.trim(),
    });

    void sendAccessRequestInternalNotification({
      name: parsed.data.name.trim(),
      email: normalizedEmail,
      company: parsed.data.company.trim(),
      emailDomain,
      source: parsed.data.source,
      initialAdminEmail: normalizedInitialAdminEmail,
      notes: sanitizeOptionalText(parsed.data.notes),
    });

    return NextResponse.json({ success: true }, { status: existingPending ? 200 : 201 });
  } catch (error) {
    console.error('[Access Requests POST] Error:', error);
    return NextResponse.json({ error: 'Failed to submit access request' }, { status: 500 });
  }
}
