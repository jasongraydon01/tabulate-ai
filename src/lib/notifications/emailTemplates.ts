/**
 * Email HTML templates for pipeline notifications.
 * Plain HTML with inline styles — reliable across email clients, no build-step dependency.
 */

type PipelineStatus = 'success' | 'partial' | 'error' | 'review_required';

interface EmailContentParams {
  status: PipelineStatus;
  projectName: string;
  projectUrl: string;
  tableCount?: number;
  durationFormatted?: string;
  errorMessage?: string;
  flaggedColumnCount?: number;
  reviewUrl?: string;
}

interface EmailContent {
  subject: string;
  html: string;
}

export function buildEmailContent(params: EmailContentParams): EmailContent {
  const { status, projectName, projectUrl, tableCount, durationFormatted, errorMessage, flaggedColumnCount, reviewUrl } = params;

  const subject = buildSubject(status, projectName);
  const html = buildHtml(status, projectName, projectUrl, tableCount, durationFormatted, errorMessage, flaggedColumnCount, reviewUrl);

  return { subject, html };
}

function buildSubject(status: PipelineStatus, projectName: string): string {
  switch (status) {
    case 'success':
      return `Your crosstabs are ready — ${projectName}`;
    case 'partial':
      return `Crosstabs completed with issues — ${projectName}`;
    case 'error':
      return `Pipeline failed — ${projectName}`;
    case 'review_required':
      return `Review needed — ${projectName}`;
  }
}

function buildHtml(
  status: PipelineStatus,
  projectName: string,
  projectUrl: string,
  tableCount?: number,
  durationFormatted?: string,
  errorMessage?: string,
  flaggedColumnCount?: number,
  reviewUrl?: string,
): string {
  const headline = buildHeadline(status);
  const body = buildBody(status, projectName, tableCount, durationFormatted, errorMessage, flaggedColumnCount);
  const ctaText = status === 'review_required' ? 'Review Now' : status === 'error' ? 'View Project' : 'View Results';
  const ctaUrl = status === 'review_required' && reviewUrl ? reviewUrl : projectUrl;

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
        <!-- Headline -->
        <tr><td style="padding:16px 32px 0 32px;">
          <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;">${headline}</h1>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:16px 32px 0 32px;">
          ${body}
        </td></tr>
        <!-- CTA -->
        <tr><td style="padding:24px 32px;">
          <a href="${ctaUrl}" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#fafafa;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">${ctaText}</a>
        </td></tr>
        <!-- Divider -->
        <tr><td style="padding:0 32px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
        </td></tr>
        <!-- Footer -->
        <tr><td style="padding:16px 32px 24px 32px;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;">You received this because you launched this pipeline run. Manage notification preferences in Settings.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildHeadline(status: PipelineStatus): string {
  switch (status) {
    case 'success':
      return 'Your crosstabs are ready';
    case 'partial':
      return 'Crosstabs completed with issues';
    case 'error':
      return 'Pipeline failed';
    case 'review_required':
      return 'Your project needs review';
  }
}

function buildBody(
  status: PipelineStatus,
  projectName: string,
  tableCount?: number,
  durationFormatted?: string,
  errorMessage?: string,
  flaggedColumnCount?: number,
): string {
  const pStyle = 'style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;"';

  switch (status) {
    case 'success': {
      const details = [
        `<strong style="color:#18181b;">${projectName}</strong>`,
        tableCount !== undefined ? `${tableCount} tables generated` : null,
        durationFormatted ? `completed in ${durationFormatted}` : null,
      ].filter(Boolean).join(' &mdash; ');
      return `<p ${pStyle}>${details}.</p>
<p ${pStyle}>Your Excel file is ready to download.</p>`;
    }
    case 'partial': {
      const details = [
        `<strong style="color:#18181b;">${projectName}</strong>`,
        tableCount !== undefined ? `${tableCount} tables generated` : null,
      ].filter(Boolean).join(' &mdash; ');
      return `<p ${pStyle}>${details}.</p>
<p ${pStyle}>The pipeline completed but some steps encountered issues. Review the results to check for any problems.</p>`;
    }
    case 'error': {
      const summary = errorMessage
        ? errorMessage.length > 200 ? errorMessage.slice(0, 200) + '...' : errorMessage
        : 'An unexpected error occurred';
      return `<p ${pStyle}><strong style="color:#18181b;">${projectName}</strong></p>
<p ${pStyle}>${summary}</p>
<p ${pStyle}>You can try re-running the project or contact support if the issue persists.</p>`;
    }
    case 'review_required': {
      const columnNote = flaggedColumnCount
        ? `<strong style="color:#18181b;">${flaggedColumnCount}</strong> banner ${flaggedColumnCount === 1 ? 'column needs' : 'columns need'} your confirmation`
        : 'Some items need your confirmation';
      return `<p ${pStyle}><strong style="color:#18181b;">${projectName}</strong> has been processed, but ${columnNote} before the final tables can be generated.</p>
<p ${pStyle}>The pipeline is paused and waiting for your input. Review the flagged items and the pipeline will resume automatically.</p>`;
    }
  }
}
