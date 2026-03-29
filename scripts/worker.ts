import '../src/lib/loadEnv';

import { mutateInternal } from '@/lib/convex';
import { internal } from '../convex/_generated/api';
import { runClaimedWorkerRun } from '@/lib/worker/runClaimedRun';
import { cleanupPendingArtifactRuns } from '@/lib/worker/artifactCleanup';
import type { ClaimedWorkerRun } from '@/lib/worker/types';

const POLL_INTERVAL_MS = Number(process.env.PIPELINE_WORKER_POLL_MS ?? 5000);
const STALE_LEASE_MS = Number(process.env.PIPELINE_WORKER_STALE_MS ?? 10 * 60 * 1000);
const ARTIFACT_CLEANUP_INTERVAL_MS = 60 * 1000;
const workerId = process.env.PIPELINE_WORKER_ID ?? `worker-${process.pid}`;

let shuttingDown = false;
let lastArtifactCleanupAt = 0;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function main(): Promise<void> {
  console.log(`[Worker] Starting pipeline worker ${workerId}`);

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

      const claimedRun = await claimNextRun();
      if (!claimedRun) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      console.log(`[Worker] Claimed run ${claimedRun.runId} (attempt ${claimedRun.attemptCount})`);
      await runClaimedWorkerRun(claimedRun, workerId);
    } catch (error) {
      console.error('[Worker] Loop error:', error);
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
