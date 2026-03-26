import { promises as fs } from 'fs';
import { queryInternal, mutateInternal } from '@/lib/convex';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { sendDemoOutputEmail } from './sendDemoEmails';

export async function deliverDemoOutputIfReady(
  demoRunId: Id<'demoRuns'>,
  opts?: {
    tableCount?: number;
    durationFormatted?: string;
  },
): Promise<{ sent: boolean; reason: string }> {
  const demoRun = await queryInternal(internal.demoRuns.getById, { demoRunId });
  if (!demoRun) return { sent: false, reason: 'missing_demo_run' };
  if (!demoRun.emailVerified) return { sent: false, reason: 'unverified' };
  if (demoRun.pipelineStatus !== 'success' && demoRun.pipelineStatus !== 'partial') {
    return { sent: false, reason: 'pipeline_not_complete' };
  }
  if (!demoRun.outputTempDir) return { sent: false, reason: 'missing_output_dir' };

  const claim = await mutateInternal(internal.demoRuns.claimOutputDelivery, { demoRunId });
  if (!claim.claimed) return { sent: false, reason: 'already_claimed_or_sent' };

  try {
    const sent = await sendDemoOutputEmail({
      to: demoRun.email,
      name: demoRun.name,
      projectName: demoRun.projectName,
      outputDir: demoRun.outputTempDir,
      tableCount: opts?.tableCount ?? 25,
      durationFormatted: opts?.durationFormatted,
    });

    if (!sent) {
      await mutateInternal(internal.demoRuns.releaseOutputDelivery, { demoRunId });
      return { sent: false, reason: 'email_send_failed' };
    }

    let outputDeletedAt: number | undefined;
    try {
      await fs.rm(demoRun.outputTempDir, { recursive: true, force: true });
      outputDeletedAt = Date.now();
    } catch (deleteError) {
      console.warn('[Demo] Failed to delete demo output after delivery:', deleteError);
    }

    await mutateInternal(internal.demoRuns.markOutputSent, {
      demoRunId,
      ...(outputDeletedAt !== undefined ? { outputDeletedAt } : {}),
    });

    return { sent: true, reason: 'sent' };
  } catch (error) {
    await mutateInternal(internal.demoRuns.releaseOutputDelivery, { demoRunId });
    throw error;
  }
}
