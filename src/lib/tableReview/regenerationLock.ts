/**
 * @deprecated Legacy Review Tables backend removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not invoke from active code.
 */
/**
 * Regeneration lock helpers for table regeneration.
 *
 * Prevents concurrent regeneration operations on the same run.
 * Uses Convex atomic mutations for race-condition-safe locking.
 */
import { mutateInternal } from '@/lib/convex';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

/**
 * Acquire a regeneration lock for a run.
 * Throws if the lock is already held (caller should return 409).
 * Auto-recovers stale locks older than 15 minutes.
 */
export async function acquireLock(runId: string, userId: string): Promise<void> {
  await mutateInternal(internal.runs.acquireRegenerationLock, {
    runId: runId as Id<'runs'>,
    lockedBy: userId,
  });
}

/**
 * Release a regeneration lock for a run.
 * Best-effort: never throws, logs errors.
 */
export async function releaseLock(runId: string): Promise<void> {
  try {
    await mutateInternal(internal.runs.releaseRegenerationLock, {
      runId: runId as Id<'runs'>,
    });
  } catch (error) {
    console.error('[RegenerationLock] Failed to release lock:', error);
  }
}
