import '../src/lib/loadEnv';

import { mutateInternal, queryInternal } from '@/lib/convex';
import { isTransientConvexError } from '@/lib/convex';
import { internal } from '../convex/_generated/api';
import { runClaimedWorkerRun } from '@/lib/worker/runClaimedRun';
import { runClaimedTableRollupJob, type ClaimedTableRollupJob } from '@/lib/api/tableRollupCompletion';
import { cleanupPendingArtifactRuns } from '@/lib/worker/artifactCleanup';
import { formatWorkerQueueSnapshotLog } from '@/lib/worker/logging';
import type { ClaimedWorkerRun } from '@/lib/worker/types';

const POLL_INTERVAL_MS = Number(process.env.PIPELINE_WORKER_POLL_MS ?? 5000);
const STALE_LEASE_MS = Number(process.env.PIPELINE_WORKER_STALE_MS ?? 10 * 60 * 1000);
const ARTIFACT_CLEANUP_INTERVAL_MS = 60 * 1000;
const IDLE_LOG_INTERVAL_MS = Number(process.env.PIPELINE_WORKER_IDLE_LOG_MS ?? 15000);
const workerId = process.env.PIPELINE_WORKER_ID ?? `worker-${process.pid}`;

let shuttingDown = false;
let lastArtifactCleanupAt = 0;
let lastIdleSnapshotKey = '';
let lastIdleLogAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

async function claimNextRun(): Promise<ClaimedWorkerRun | null> {
  const claimed = await mutateInternal(internal.runs.claimNextQueuedRun, {
    workerId,
  });
  if (!claimed) return null;

  return {
    runId: String(claimed.runId),
    orgId: String(claimed.orgId),
    projectId: String(claimed.projectId),
    launchedBy: claimed.launchedBy ? String(claimed.launchedBy) : undefined,
    attemptCount: claimed.attemptCount,
    config: claimed.config as Record<string, unknown>,
    executionPayload: claimed.executionPayload,
    recoveryManifest: claimed.recoveryManifest,
    resumeFromStage: claimed.resumeFromStage,
  };
}

async function claimNextTableRollupJob(): Promise<ClaimedTableRollupJob | null> {
  const claimed = await mutateInternal(internal.analysisComputeJobs.claimNextQueuedTableRollupJob, {
    workerId,
  });
  if (!claimed) return null;

  return {
    jobId: String(claimed.jobId),
    orgId: String(claimed.orgId),
    projectId: String(claimed.projectId),
    parentRunId: String(claimed.parentRunId),
    sessionId: String(claimed.sessionId),
    requestedBy: String(claimed.requestedBy),
    requestText: claimed.requestText,
    frozenTableRollupSpec: claimed.frozenTableRollupSpec,
    fingerprint: claimed.fingerprint,
  };
}

async function logIdleQueueSnapshot(): Promise<void> {
  const now = Date.now();
  let snapshot;

  try {
    snapshot = await queryInternal(internal.runs.getWorkerQueueSnapshot, {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const snapshotKey = `unavailable:${message}`;

    if (snapshotKey === lastIdleSnapshotKey && now - lastIdleLogAt < IDLE_LOG_INTERVAL_MS) {
      return;
    }

    lastIdleSnapshotKey = snapshotKey;
    lastIdleLogAt = now;
    console.log('[Worker] Queue diagnostics unavailable until Convex is ready.');
    return;
  }

  const snapshotKey = JSON.stringify(snapshot);

  if (snapshotKey === lastIdleSnapshotKey && now - lastIdleLogAt < IDLE_LOG_INTERVAL_MS) {
    return;
  }

  lastIdleSnapshotKey = snapshotKey;
  lastIdleLogAt = now;
  for (const line of formatWorkerQueueSnapshotLog(snapshot, now)) {
    console.log(line);
  }
}

async function main(): Promise<void> {
  console.log(
    `[Worker] Starting pipeline worker ${workerId} (poll ${POLL_INTERVAL_MS}ms, stale ${STALE_LEASE_MS}ms)`,
  );

  while (!shuttingDown) {
    try {
      const now = Date.now();
      if (now - lastArtifactCleanupAt >= ARTIFACT_CLEANUP_INTERVAL_MS) {
        lastArtifactCleanupAt = now;
        const cleanup = await cleanupPendingArtifactRuns();
        if (cleanup.processed > 0) {
          console.log(
            `[Worker] Artifact cleanup: processed=${cleanup.processed} purged=${cleanup.purged} failed=${cleanup.failed}`,
          );
        }
      }

      await mutateInternal(internal.runs.requeueStaleRuns, {
        staleBeforeMs: STALE_LEASE_MS,
      });
      await mutateInternal(internal.analysisComputeJobs.requeueStaleTableRollupJobs, {
        staleBeforeMs: STALE_LEASE_MS,
      });

      const claimedRun = await claimNextRun();
      if (claimedRun) {
        lastIdleSnapshotKey = '';
        console.log(`[Worker] Claimed run ${claimedRun.runId} (attempt ${claimedRun.attemptCount})`);
        await runClaimedWorkerRun(claimedRun, workerId);
        continue;
      }

      const claimedRollupJob = await claimNextTableRollupJob();
      if (claimedRollupJob) {
        lastIdleSnapshotKey = '';
        console.log(`[Worker] Claimed table roll-up job ${claimedRollupJob.jobId}`);
        await runClaimedTableRollupJob(claimedRollupJob);
        continue;
      }

      await logIdleQueueSnapshot();
      await sleep(POLL_INTERVAL_MS);
      continue;
    } catch (error) {
      if (isTransientConvexError(error)) {
        console.warn(
          `[Worker] Convex unavailable, retrying in ${POLL_INTERVAL_MS}ms: ${describeError(error)}`,
        );
      } else {
        console.error('[Worker] Loop error:', error);
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  console.log(`[Worker] Shutting down worker ${workerId}`);
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    shuttingDown = true;
  });
}

main().catch(async (error) => {
  console.error('[Worker] Fatal error:', error);
  process.exitCode = 1;
});
