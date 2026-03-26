import {
  formatPrice,
  getOverageCost,
  getPlan,
  getSmartUpgradeBreakpoint,
  type PlanId,
} from '@/lib/billing/plans';

export type BillingNotificationKind = 'near_limit' | 'overage' | 'upgrade_suggestion';

export interface BillingEmailContentParams {
  kind: BillingNotificationKind;
  plan: PlanId;
  projectsUsed: number;
  projectLimit: number;
  settingsUrl: string;
}

export interface BillingEmailContent {
  subject: string;
  html: string;
}

export function buildBillingEmailContent(
  params: BillingEmailContentParams,
): BillingEmailContent {
  const { kind, plan, projectsUsed, projectLimit, settingsUrl } = params;
  const planConfig = getPlan(plan);
  const overageCost = getOverageCost(plan, projectsUsed);
  const breakpoint = getSmartUpgradeBreakpoint(plan);

  const subject =
    kind === 'near_limit'
      ? `${planConfig.name} plan nearing limit`
      : kind === 'overage'
        ? `${planConfig.name} plan is now in overage`
        : `Upgrading from ${planConfig.name} could save money this cycle`;

  const headline =
    kind === 'near_limit'
      ? 'You are approaching your included project limit'
      : kind === 'overage'
        ? 'Your organization has entered overage billing'
        : 'A plan upgrade would lower this month\u2019s bill';

  const nearLimitThreshold = Math.ceil(projectLimit * 0.8);
  const body =
    kind === 'near_limit'
      ? `<p ${P_STYLE}>Your organization has used <strong style="color:#18181b;">${projectsUsed} of ${projectLimit}</strong> included projects on the <strong style="color:#18181b;">${planConfig.name}</strong> plan.</p>
<p ${P_STYLE}>That passes the 80% threshold (${nearLimitThreshold} projects). Additional projects are still allowed, and overages start only after project ${projectLimit}.</p>`
      : kind === 'overage'
        ? `<p ${P_STYLE}>Your organization has used <strong style="color:#18181b;">${projectsUsed}</strong> projects on the <strong style="color:#18181b;">${planConfig.name}</strong> plan, which is <strong style="color:#18181b;">${projectsUsed - projectLimit}</strong> over the included limit of ${projectLimit}.</p>
<p ${P_STYLE}>Current overage charges this cycle are <strong style="color:#18181b;">${formatPrice(overageCost)}</strong>.</p>`
        : `<p ${P_STYLE}>Your organization has used <strong style="color:#18181b;">${projectsUsed}</strong> projects on the <strong style="color:#18181b;">${planConfig.name}</strong> plan.</p>
<p ${P_STYLE}>At this usage level, upgrading to <strong style="color:#18181b;">${breakpoint ? getPlan(breakpoint.nextPlan).name : 'the next tier'}</strong> would be cheaper than staying on the current tier with overages.</p>`;

  return {
    subject,
    html: `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:40px 20px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;border:1px solid #e4e4e7;">
        <tr><td style="padding:32px 32px 0 32px;">
          <p style="margin:0;font-size:13px;color:#71717a;letter-spacing:0.05em;text-transform:uppercase;">TabulateAI Billing</p>
        </td></tr>
        <tr><td style="padding:16px 32px 0 32px;">
          <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;">${headline}</h1>
        </td></tr>
        <tr><td style="padding:16px 32px 0 32px;">
          ${body}
        </td></tr>
        <tr><td style="padding:24px 32px;">
          <a href="${settingsUrl}" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#fafafa;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Open Billing Settings</a>
        </td></tr>
        <tr><td style="padding:0 32px;">
          <hr style="border:none;border-top:1px solid #e4e4e7;margin:0;">
        </td></tr>
        <tr><td style="padding:16px 32px 24px 32px;">
          <p style="margin:0;font-size:12px;color:#a1a1aa;">You received this because you are an admin for this organization.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`,
  };
}

const P_STYLE = 'style="margin:0 0 8px 0;font-size:14px;color:#52525b;line-height:1.6;"';
