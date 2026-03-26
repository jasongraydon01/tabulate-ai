/**
 * Heartbeat helper for pipeline liveness tracking.
 *
 * Sends periodic heartbeats to Convex so the reconciler cron can detect
 * stale runs (e.g., container died mid-pipeline) and mark them as errored.
 *
 * All heartbeat operations are non-fatal — failures are logged but never thrown.
 */
import { mutateInternal } from '@/lib/convex';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

/** Per-run consecutive failure counter for escalated logging. */
const failureCounts = new Map<string, number>();
const ESCALATE_AFTER = 5;

/**
 * Send a single heartbeat for a run. Non-fatal — warns on failure, never throws.
 */
export async function sendHeartbeat(runId: string): Promise<void> {
  try {
    await mutateInternal(internal.runs.heartbeat, {
      runId: runId as Id<"runs">,
    });
    // Reset failure counter on success
    const prev = failureCounts.get(runId);
    if (prev && prev >= ESCALATE_AFTER) {
      console.log(`[Heartbeat] Recovered for run ${runId} after ${prev} consecutive failures`);
    }
    failureCounts.delete(runId);
  } catch (err) {
    const count = (failureCounts.get(runId) ?? 0) + 1;
    failureCounts.set(runId, count);
    if (count === ESCALATE_AFTER) {
      console.error(`[Heartbeat] ${count} consecutive failures for run ${runId} — Convex may be unreachable`);
    } else if (count < ESCALATE_AFTER) {
      console.warn('[Heartbeat] Failed to send heartbeat:', err);
    }
    // After escalation, stay silent to avoid log spam
  }
}

/**
 * Start a periodic heartbeat for a run using recursive setTimeout.
 * Sends an initial heartbeat immediately, then schedules the next tick
 * only after the previous one completes (prevents overlapping async calls).
 *
 * Returns a cleanup function that stops the timer.
 */
export function startHeartbeatInterval(
  runId: string,
  intervalMs = 30_000,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;

  async function tick() {
    if (stopped) return;
    await sendHeartbeat(runId);
    if (!stopped) {
      timer = setTimeout(tick, intervalMs);
    }
  }

  // Fire initial heartbeat (non-blocking)
  sendHeartbeat(runId);
  timer = setTimeout(tick, intervalMs);

  return () => {
    stopped = true;
    clearTimeout(timer);
    failureCounts.delete(runId); // Clean up failure counter
  };
}
