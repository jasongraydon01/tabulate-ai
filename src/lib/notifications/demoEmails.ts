/**
 * Email HTML templates for demo mode.
 * Two email types: verification (confirm email) and output delivery (with attachments).
 * Light theme with inline styles — reliable across email clients, no build-step dependency.
 */

// =============================================================================
// Verification Email
// =============================================================================

interface VerificationEmailParams {
  name: string;
  projectName: string;
  verifyUrl: string;
}

export function buildVerificationEmail(params: VerificationEmailParams): { subject: string; html: string } {
  const { name, projectName, verifyUrl } = params;

  return {
    subject: 'Confirm your email to receive your crosstabs',
    html: wrapEmail(`
      <!-- Headline -->
      <tr><td style="padding:16px 32px 0 32px;">
        <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;">Confirm your email</h1>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:16px 32px 0 32px;">
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Hi ${escapeHtml(name)},
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Thanks for trying TabulateAI. Your project <strong style="color:#18181b;">${escapeHtml(projectName)}</strong> is already processing &mdash; we'll send your results as soon as it's ready.
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Click below to confirm your email address so we can deliver your output:
        </p>
      </td></tr>
      <!-- CTA -->
      <tr><td style="padding:24px 32px;">
        <a href="${verifyUrl}" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#fafafa;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Confirm Email</a>
      </td></tr>
      <!-- Demo info -->
      <tr><td style="padding:0 32px 16px 32px;">
        <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">
          In demo mode, TabulateAI processes the first 100 respondents and produces the first 25 tables from your data. This gives you a representative preview of the full pipeline. This link expires in 48 hours.
        </p>
      </td></tr>
    `),
  };
}

// =============================================================================
// Output Delivery Email
// =============================================================================

interface OutputDeliveryEmailParams {
  name: string;
  projectName: string;
  tableCount: number;
  durationFormatted?: string;
  requestAccessUrl: string;
}

export function buildOutputDeliveryEmail(params: OutputDeliveryEmailParams): { subject: string; html: string } {
  const { name, projectName, tableCount, durationFormatted, requestAccessUrl } = params;

  const details = [
    `<strong style="color:#18181b;">${escapeHtml(projectName)}</strong>`,
    `${tableCount} tables`,
    durationFormatted ? `completed in ${durationFormatted}` : null,
  ].filter(Boolean).join(' &mdash; ');

  return {
    subject: `Your demo crosstabs are ready — ${projectName}`,
    html: wrapEmail(`
      <!-- Headline -->
      <tr><td style="padding:16px 32px 0 32px;">
        <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;">Your crosstabs are ready</h1>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:16px 32px 0 32px;">
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Hi ${escapeHtml(name)},
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Your crosstabs from TabulateAI are attached.
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          ${details}.
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          In demo mode, we processed the first 100 respondents and produced ${tableCount} tables so you could get a sense of how TabulateAI works on your own data. The full product processes your complete dataset with no table or respondent limits.
        </p>
        <p style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;">
          After successful delivery, we attempt to remove the demo output
          files from our servers. Your contact details may still remain in
          our system so we can manage verification, delivery state, and any
          follow-up support.
        </p>
        <p style="margin:0;font-size:14px;color:#52525b;line-height:1.6;">
          If you want a full workspace for your team, request access and we&apos;ll provision the first admin path before billing begins.
        </p>
      </td></tr>
      <!-- CTA -->
      <tr><td style="padding:24px 32px;">
        <a href="${requestAccessUrl}" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#fafafa;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Request Access</a>
      </td></tr>
      <!-- Footer note -->
      <tr><td style="padding:0 32px 16px 32px;">
        <p style="margin:0;font-size:12px;color:#a1a1aa;line-height:1.5;">
          Questions? Reply to this email &mdash; it comes straight to us.
        </p>
      </td></tr>
    `),
  };
}

// =============================================================================
// Shared Helpers
// =============================================================================

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
        <!-- Header -->
        <tr><td style="padding:32px 32px 0 32px;">
          <p style="margin:0;font-size:13px;color:#71717a;letter-spacing:0.05em;text-transform:uppercase;">TabulateAI</p>
        </td></tr>
        ${bodyRows}
        <!-- Divider -->
        <tr><td style="padding:0 32px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px 24px 32px;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;">See our plain-English privacy details here: <a href="https://tabulate-ai.com/data-privacy" style="color:#71717a;text-decoration:underline;">Data &amp; Privacy</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
