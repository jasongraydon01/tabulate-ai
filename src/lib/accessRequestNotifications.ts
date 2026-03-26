import { Resend } from 'resend';
import type { AccessRequestSource } from '@/lib/accessRequests';
import {
  buildAccessRequestConfirmationEmail,
  buildAccessRequestInternalEmail,
} from '@/lib/notifications/accessRequestEmails';

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Access Requests] RESEND_API_KEY not set — skipping email');
    return null;
  }

  return new Resend(apiKey);
}

function getFromAddress(): string {
  return process.env.RESEND_FROM_ADDRESS || 'TabulateAI <notifications@tabulate-ai.com>';
}

function getAppUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || 'https://tabulate-ai.com';
}

function getNotificationRecipients(): string[] {
  return (process.env.ACCESS_REQUEST_NOTIFICATION_TO ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function sendAccessRequestConfirmationEmail(params: {
  to: string;
  name: string;
  company: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const { subject, html } = buildAccessRequestConfirmationEmail(params);

  try {
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: params.to,
      subject,
      html,
    });

    if (error) {
      console.error('[Access Requests] Confirmation email failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Access Requests] Confirmation email error:', error);
    return false;
  }
}

export async function sendAccessRequestInternalNotification(params: {
  name: string;
  email: string;
  company: string;
  emailDomain: string;
  source: AccessRequestSource;
  notes?: string;
  initialAdminEmail?: string;
}): Promise<boolean> {
  const resend = getResend();
  const recipients = getNotificationRecipients();

  if (!resend || recipients.length === 0) {
    if (recipients.length === 0) {
      console.warn('[Access Requests] ACCESS_REQUEST_NOTIFICATION_TO not set — skipping internal email');
    }
    return false;
  }

  const { subject, html } = buildAccessRequestInternalEmail({
    ...params,
    queueUrl: `${getAppUrl()}/ops/access-requests`,
  });

  try {
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: recipients,
      subject,
      html,
    });

    if (error) {
      console.error('[Access Requests] Internal notification failed:', error);
      return false;
    }

    return true;
  } catch (error) {
    console.error('[Access Requests] Internal notification error:', error);
    return false;
  }
}
