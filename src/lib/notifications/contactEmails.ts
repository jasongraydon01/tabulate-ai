import type { ContactTopic } from '@/lib/contact';

interface ContactNotificationParams {
  name: string;
  email: string;
  company?: string;
  topic: ContactTopic;
  message: string;
}

const TOPIC_LABELS: Record<ContactTopic, string> = {
  demo: 'Demo',
  access: 'Access / Workspace setup',
  billing: 'Billing',
  wincross: 'WinCross / Exports',
  general: 'General question',
};

export function buildContactNotificationEmail(
  params: ContactNotificationParams,
): { subject: string; html: string } {
  return {
    subject: `New TabulateAI contact request — ${TOPIC_LABELS[params.topic]}`,
    html: wrapEmail(`
      <tr><td style="padding:16px 32px 0 32px;">
        <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;">New contact request</h1>
      </td></tr>
      <tr><td style="padding:16px 32px 0 32px;">
        <p style="margin:0 0 12px 0;font-size:14px;color:#52525b;line-height:1.6;">
          Someone reached out through the TabulateAI contact form.
        </p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e4e4e7;border-radius:8px;">
          ${buildDetailRow('Name', escapeHtml(params.name))}
          ${buildDetailRow('Email', escapeHtml(params.email))}
          ${params.company ? buildDetailRow('Company', escapeHtml(params.company)) : ''}
          ${buildDetailRow('Topic', escapeHtml(TOPIC_LABELS[params.topic]))}
          ${buildDetailRow('Message', escapeHtml(params.message).replace(/\n/g, '<br />'))}
        </table>
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
          <p style="margin:0;font-size:12px;color:#a1a1aa;">Submitted from <a href="https://tabulate-ai.com/contact" style="color:#71717a;text-decoration:underline;">tabulate-ai.com/contact</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}
