/**
 * Pipeline email notification service.
 *
 * Sends fire-and-forget emails when a pipeline reaches a terminal status.
 * Graceful no-ops: missing RESEND_API_KEY, missing launchedBy, user opted out.
 * Notification failure never affects pipeline execution.
 */
import { Resend } from 'resend';
import { getConvexClient, queryInternal } from '@/lib/convex';
import { api, internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { buildEmailContent } from './emailTemplates';

type PipelineStatus = 'success' | 'partial' | 'error' | 'review_required';

export interface PipelineNotificationParams {
  runId: string;
  status: PipelineStatus;
  launchedBy?: string;
  convexProjectId?: string;
  convexOrgId?: string;
  tableCount?: number;
  durationFormatted?: string;
  errorMessage?: string;
  flaggedColumnCount?: number;
  reviewUrl?: string;
}

/**
 * Send an email notification for a pipeline terminal event.
 * This is a fire-and-forget call — all errors are swallowed and logged.
 */
export async function sendPipelineNotification(params: PipelineNotificationParams): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.log('[Notifications] RESEND_API_KEY not set — skipping email notification');
      return;
    }

    if (!params.launchedBy) {
      console.log('[Notifications] No launchedBy on run — skipping email notification');
      return;
    }

    // Look up user (internalQuery — not browser-callable)
    const user = await queryInternal(internal.users.get, {
      userId: params.launchedBy as Id<"users">,
    });

    if (!user) {
      console.log(`[Notifications] User ${params.launchedBy} not found — skipping email`);
      return;
    }

    // Check notification preferences (default: opted in)
    const prefs = user.notificationPreferences as { pipelineEmails?: boolean } | undefined;
    if (prefs?.pipelineEmails === false) {
      console.log(`[Notifications] User ${user.email} opted out of pipeline emails — skipping`);
      return;
    }

    // Look up project name
    let projectName = 'Untitled Project';
    if (params.convexProjectId) {
      try {
        const convex = getConvexClient();
        const project = await convex.query(api.projects.get, {
          projectId: params.convexProjectId as Id<"projects">,
          orgId: params.convexOrgId as Id<"organizations">,
        });
        if (project?.name) {
          projectName = project.name;
        }
      } catch {
        // Non-fatal — use default name
      }
    }

    // Build project URL
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.crosstab-ai.com';
    const projectUrl = params.convexProjectId
      ? `${appUrl}/projects/${encodeURIComponent(params.convexProjectId)}`
      : appUrl;

    // Build review URL (absolute) for review_required emails
    const reviewUrl = params.reviewUrl
      ? `${appUrl}${params.reviewUrl}`
      : undefined;

    // Build email content
    const { subject, html } = buildEmailContent({
      status: params.status,
      projectName,
      projectUrl,
      tableCount: params.tableCount,
      durationFormatted: params.durationFormatted,
      errorMessage: params.errorMessage,
      flaggedColumnCount: params.flaggedColumnCount,
      reviewUrl,
    });

    // Send via Resend
    const fromAddress = process.env.RESEND_FROM_ADDRESS || 'TabulateAI <notifications@crosstab-ai.com>';
    const resend = new Resend(apiKey);

    const { error } = await resend.emails.send({
      from: fromAddress,
      to: user.email,
      subject,
      html,
    });

    if (error) {
      console.warn(`[Notifications] Resend API error:`, error);
    } else {
      console.log(`[Notifications] Email sent to ${user.email} (status: ${params.status})`);
    }
  } catch (err) {
    // Fire-and-forget — never let notification failure affect the pipeline
    console.warn('[Notifications] Failed to send email notification:', err);
  }
}
