/**
 * Demo email delivery functions.
 *
 * - sendDemoVerificationEmail: sends confirmation link after form submit
 * - sendDemoOutputEmail: sends zip attachment after pipeline completes + email verified
 */

import { Resend } from 'resend';
import { buildVerificationEmail, buildOutputDeliveryEmail } from '@/lib/notifications/demoEmails';
import { bundleDemoOutput } from './bundleDemoOutput';

function getResend(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.warn('[Demo] RESEND_API_KEY not set — skipping email');
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

// =============================================================================
// Verification Email
// =============================================================================

export async function sendDemoVerificationEmail(opts: {
  to: string;
  name: string;
  projectName: string;
  verificationToken: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const appUrl = getAppUrl();
  const verifyUrl = `${appUrl}/api/demo/verify?token=${encodeURIComponent(opts.verificationToken)}`;

  const { subject, html } = buildVerificationEmail({
    name: opts.name,
    projectName: opts.projectName,
    verifyUrl,
  });

  try {
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: opts.to,
      subject,
      html,
    });
    if (error) {
      console.error('[Demo] Verification email failed:', error);
      return false;
    }
    console.log(`[Demo] Verification email sent to ${opts.to}`);
    return true;
  } catch (err) {
    console.error('[Demo] Verification email error:', err);
    return false;
  }
}

// =============================================================================
// Output Delivery Email
// =============================================================================

export async function sendDemoOutputEmail(opts: {
  to: string;
  name: string;
  projectName: string;
  outputDir: string;
  tableCount: number;
  durationFormatted?: string;
}): Promise<boolean> {
  const resend = getResend();
  if (!resend) return false;

  const appUrl = getAppUrl();
  const pricingUrl = `${appUrl}/pricing`;

  // Bundle output files into separate attachments
  let bundle: Awaited<ReturnType<typeof bundleDemoOutput>>;
  try {
    bundle = await bundleDemoOutput(opts.outputDir, opts.projectName);
    const parts = [
      bundle.excelAttachments.length > 0 ? `${bundle.excelAttachments.length} Excel` : null,
      bundle.qZip ? '1 Q zip' : null,
      bundle.wincrossZip ? '1 WinCross zip' : null,
    ].filter(Boolean);
    console.log(`[Demo] Bundled ${bundle.totalFileCount} files as: ${parts.join(', ')}`);
  } catch (err) {
    console.error('[Demo] Failed to bundle output files:', err);
    return false;
  }

  const { subject, html } = buildOutputDeliveryEmail({
    name: opts.name,
    projectName: opts.projectName,
    tableCount: opts.tableCount,
    durationFormatted: opts.durationFormatted,
    pricingUrl,
  });

  // Build attachments: Excel files standalone, exports as zips
  const attachments: Array<{ filename: string; content: Buffer }> = [];
  for (const excel of bundle.excelAttachments) {
    attachments.push({ filename: excel.filename, content: excel.content });
  }
  if (bundle.qZip) {
    attachments.push({ filename: bundle.qZip.filename, content: bundle.qZip.content });
  }
  if (bundle.wincrossZip) {
    attachments.push({ filename: bundle.wincrossZip.filename, content: bundle.wincrossZip.content });
  }

  try {
    const { error } = await resend.emails.send({
      from: getFromAddress(),
      to: opts.to,
      subject,
      html,
      attachments,
    });
    if (error) {
      console.error('[Demo] Output delivery email failed:', error);
      return false;
    }
    const fileNames = attachments.map(a => a.filename).join(', ');
    console.log(`[Demo] Output email sent to ${opts.to} with: ${fileNames}`);
    return true;
  } catch (err) {
    console.error('[Demo] Output delivery email error:', err);
    return false;
  }
}
