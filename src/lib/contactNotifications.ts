import { Resend } from 'resend';
import type { ContactTopic } from '@/lib/contact';
import { buildContactNotificationEmail } from '@/lib/notifications/contactEmails';

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Contact] RESEND_API_KEY not set — skipping email');
    return null;
  }

  return new Resend(apiKey);
}

function getFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS || 'TabulateAI <notifications@tabulate-ai.com>';
}

function getNotificationRecipients(): string[] {
  const raw = process.env.CONTACT_NOTIFICATION_TO ?? process.env.ACCESS_REQUEST_NOTIFICATION_TO ?? '';
  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function getContactReplyToAddress(): string | null {
  return getNotificationRecipients()[0] ?? null;
}

export async function sendContactNotification(params: {
  name: string;
  email: string;
  company?: string;
  topic: ContactTopic;
  message: string;
}): Promise<boolean> {
  const resend = getResend();
  const recipients = getNotificationRecipients();

  if (!resend || recipients.length === 0) {
    if (recipients.length === 0) {
      console.warn('[Contact] CONTACT_NOTIFICATION_TO not set — skipping internal email');
    }
    return false;
  }

  const { subject, html } = buildContactNotificationEmail(params);

  try {
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: recipients,
      replyTo: params.email,
      subject,
      html,
    });

    if (error) {
      console.error('[Contact] Notification email failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Contact] Notification email error:', error);
    return false;
  }
}
