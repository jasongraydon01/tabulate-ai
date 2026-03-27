import type { AccessRequestSource } from '@/lib/accessRequests';

interface RequesterConfirmationParams {
  name: string;
  company: string;
}

interface InternalNotificationParams {
  name: string;
  email: string;
  company: string;
  emailDomain: string;
  source: AccessRequestSource;
  notes?: string;
  initialAdminEmail?: string;
  queueUrl: string;
}

interface ApprovalEmailParams {
  company: string;
  signInUrl: string;
}

const SOURCE_LABELS: Record<AccessRequestSource, string> = {
  demo_status: 'Demo status page',
  demo_email: 'Demo results email',
  pricing: 'Pricing page',
  auth_no_org: 'No-organization auth state',
  marketing: 'Marketing site',
};

export function buildAccessRequestConfirmationEmail(
  params: RequesterConfirmationParams,
): { subject: string; html: string } {
  return {
    subject: 'We received your TabulateAI access request',
    html: wrapEmail(`
      <tr><td style="padding:16px 32px 0 32px;">
        <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;">Access request received</h1>
      </td></tr>
      <tr><td style="padding:16px 32px 0 32px;">
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Hi ${escapeHtml(params.name)},
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          We received your request to set up a TabulateAI workspace for <strong style="color:#18181b;">${escapeHtml(params.company)}</strong>.
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          We provision the initial workspace and admin access manually so billing, domain ownership, and team setup start cleanly.
        </p>
        <p style="margin:0;font-size:14px;color:#52525b;line-height:1.6;">
          We&apos;ll follow up with your sign-in path once the workspace is ready. Pricing and billing happen after that setup step.
        </p>
      </td></tr>
      <tr><td style="padding:24px 32px 16px 32px;">
        <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">
          Questions? Reply to this email and it will come straight to us.
        </p>
      </td></tr>
    `),
  };
}

export function buildAccessRequestInternalEmail(
  params: InternalNotificationParams,
): { subject: string; html: string } {
  return {
    subject: `New TabulateAI access request — ${params.company}`,
    html: wrapEmail(`
      <tr><td style="padding:16px 32px 0 32px;">
        <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;">New access request</h1>
      </td></tr>
      <tr><td style="padding:16px 32px 0 32px;">
        <p style="margin:0 0 12px 0;font-size:14px;color:#52525b;line-height:1.6;">
          A new workspace request came in for <strong style="color:#18181b;">${escapeHtml(params.company)}</strong>.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;">
          ${buildDetailRow('Requester', escapeHtml(params.name))}
          ${buildDetailRow('Work email', escapeHtml(params.email))}
          ${buildDetailRow('Domain', escapeHtml(params.emailDomain))}
          ${buildDetailRow('Source', escapeHtml(SOURCE_LABELS[params.source]))}
          ${params.initialAdminEmail ? buildDetailRow('Initial admin', escapeHtml(params.initialAdminEmail)) : ''}
          ${params.notes ? buildDetailRow('Notes', escapeHtml(params.notes)) : ''}
        </table>
      </td></tr>
      <tr><td style="padding:24px 32px;">
        <a href="${params.queueUrl}" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#fafafa;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Open request queue</a>
      </td></tr>
    `),
  };
}

export function buildAccessRequestApprovedEmail(
  params: ApprovalEmailParams,
): { subject: string; html: string } {
  return {
    subject: `Your TabulateAI workspace is ready`,
    html: wrapEmail(`
      <tr><td style="padding:16px 32px 0 32px;">
        <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;">Workspace ready</h1>
      </td></tr>
      <tr><td style="padding:16px 32px 0 32px;">
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Your TabulateAI workspace for <strong style="color:#18181b;">${escapeHtml(params.company)}</strong> has been set up.
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Use the button below to sign in. If your team set a different first admin, ask them to invite the rest of the workspace after they land in the app.
        </p>
      </td></tr>
      <tr><td style="padding:24px 32px;">
        <a href="${params.signInUrl}" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#fafafa;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Sign In</a>
      </td></tr>
    `),
  };
}

function buildDetailRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:10px 14px;border-bottom:1px solid #e4e4e7;font-size:12px;color:#71717a;text-transform:uppercase;letter-spacing:0.05em;width:140px;">${label}</td>
    <td style="padding:10px 14px;border-bottom:1px solid #e4e4e7;font-size:14px;color:#18181b;line-height:1.6;">${value}</td>
  </tr>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function wrapEmail(bodyRows: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
        <tr><td style="padding:32px 32px 0 32px;">
          <p style="margin:0;font-size:13px;color:#71717a;letter-spacing:0.05em;text-transform:uppercase;">TabulateAI</p>
        </td></tr>
        ${bodyRows}
        <tr><td style="padding:0 32px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
        </td></tr>
        <tr><td style="padding:16px 32px 24px 32px;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;">See our plain-English privacy details here: <a href="https://tabulate-ai.com/data-privacy" style="color:#71717a;text-decoration:underline;">Data &amp; Privacy</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
