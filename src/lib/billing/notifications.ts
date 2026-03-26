import { Resend } from 'resend';
import { mutateInternal, queryInternal } from '@/lib/convex';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { getSmartUpgradeBreakpoint, type PlanId } from './plans';
import {
  buildBillingEmailContent,
  type BillingNotificationKind,
} from '@/lib/notifications/billingEmailTemplates';

export interface BillingNotificationSnapshot {
  orgId: string;
  plan: PlanId;
  projectsUsed: number;
  projectLimit: number;
  overageRate: number;
  billingNotifications?: {
    nearLimitSentAt?: number;
    overageSentAt?: number;
    upgradeSuggestionSentAt?: number;
  };
}

export function getPendingBillingNotificationKinds(
  snapshot: BillingNotificationSnapshot,
): BillingNotificationKind[] {
  const pending: BillingNotificationKind[] = [];
  const notifications = snapshot.billingNotifications ?? {};
  const upgradeBreakpoint = getSmartUpgradeBreakpoint(snapshot.plan);

  // PAYG has no included project limit — near_limit and overage don't apply.
  // Only upgrade_suggestion is relevant (e.g., when Starter would be cheaper).
  if (snapshot.projectLimit > 0) {
    const nearLimitThreshold = Math.ceil(snapshot.projectLimit * 0.8);

    if (
      snapshot.projectsUsed >= nearLimitThreshold &&
      snapshot.projectsUsed <= snapshot.projectLimit &&
      !notifications.nearLimitSentAt
    ) {
      pending.push('near_limit');
    }

    if (snapshot.projectsUsed > snapshot.projectLimit && !notifications.overageSentAt) {
      pending.push('overage');
    }
  }

  if (
    upgradeBreakpoint &&
    snapshot.projectsUsed >= upgradeBreakpoint.projectCount &&
    !notifications.upgradeSuggestionSentAt
  ) {
    pending.push('upgrade_suggestion');
  }

  return pending;
}

export async function sendBillingNotifications(
  snapshot: BillingNotificationSnapshot,
): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log('[Billing Notifications] RESEND_API_KEY not set — skipping');
    return;
  }

  const pendingKinds = getPendingBillingNotificationKinds(snapshot);
  if (pendingKinds.length === 0) {
    return;
  }

  const resend = new Resend(apiKey);
  const contacts = await queryInternal(internal.orgMemberships.listBillingContacts, {
    orgId: snapshot.orgId as Id<'organizations'>,
  });

  const recipients = contacts.filter(
    (contact: {
      email: string;
      notificationPreferences?: { pipelineEmails?: boolean };
    }) => contact.notificationPreferences?.pipelineEmails !== false,
  );

  if (recipients.length === 0) {
    console.log('[Billing Notifications] No opted-in admin recipients — skipping');
    return;
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://tabulate-ai.com';
  const settingsUrl = `${appUrl}/settings`;
  const fromAddress =
    process.env.RESEND_FROM_ADDRESS || 'TabulateAI <notifications@tabulate-ai.com>';

  for (const kind of pendingKinds) {
    const reserved = await mutateInternal(internal.subscriptions.reserveBillingNotification, {
      orgId: snapshot.orgId as Id<'organizations'>,
      kind,
    });

    if (!reserved) {
      continue;
    }

    const { subject, html } = buildBillingEmailContent({
      kind,
      plan: snapshot.plan,
      projectsUsed: snapshot.projectsUsed,
      projectLimit: snapshot.projectLimit,
      settingsUrl,
    });

    for (const recipient of recipients) {
      const { error } = await resend.emails.send({
        from: fromAddress,
        to: recipient.email,
        subject,
        html,
      });

      if (error) {
        console.warn('[Billing Notifications] Resend API error:', error);
      }
    }
  }
}
