import { NextRequest, NextResponse } from 'next/server';
import { ContactSubmissionSchema } from '@/lib/contact';
import { sanitizeOptionalText } from '@/lib/accessRequests';
import { sendContactNotification } from '@/lib/contactNotifications';
import { applyRateLimit } from '@/lib/withRateLimit';

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimited = applyRateLimit(ip, 'demo', 'contact/create');
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const parsed = ContactSubmissionSchema.safeParse(body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      return NextResponse.json({ error: firstIssue?.message || 'Invalid request' }, { status: 400 });
    }

    void sendContactNotification({
      name: parsed.data.name.trim(),
      email: parsed.data.email.trim().toLowerCase(),
      company: sanitizeOptionalText(parsed.data.company),
      topic: parsed.data.topic,
      message: parsed.data.message.trim(),
    });

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    console.error('[Contact POST] Error:', error);
    return NextResponse.json({ error: 'Failed to send contact request' }, { status: 500 });
  }
}
