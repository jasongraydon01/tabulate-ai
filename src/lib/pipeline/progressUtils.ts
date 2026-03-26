/**
 * Shared throttled progress callback for pipeline stages that process tables
 * in parallel (e.g., VerificationAgent).
 *
 * Compatible with the `onProgress` signature expected by `verifyAllTablesParallel()`.
 */

import type { V3PipelineStage } from '@/schemas/pipelineStageSchema';

type StatusUpdateFn = (updates: {
  status: string;
  stage: V3PipelineStage;
  progress: number;
  message: string;
}) => Promise<void>;

interface ThrottledProgressOptions {
  /** Function to push status updates (e.g., updateRunStatus or updateReviewRunStatus) */
  updateFn: StatusUpdateFn;
  /** Pipeline status value (e.g., 'in_progress' or 'resuming') */
  statusValue: string;
  /** Orchestrator stage name aligned with the shared V3 stage contract. */
  stage: V3PipelineStage;
  /** Progress range [start, end] — maps 0..total onto this range */
  progressRange: [number, number];
  /** Minimum interval between intermediate updates (ms). Defaults to 5000. */
  throttleMs?: number;
}

/**
 * Creates a throttled onProgress callback for use with `verifyAllTablesParallel()`.
 *
 * - Fires immediately on the first completed table
 * - Fires on the last completed table
 * - Throttles intermediate updates to `throttleMs` (default 5s)
 * - Calls updateFn fire-and-forget (no await) to avoid blocking the parallel loop
 */
export function createThrottledProgressCallback(
  options: ThrottledProgressOptions
): (completed: number, total: number, tableId: string) => void {
  const {
    updateFn,
    statusValue,
    stage,
    progressRange: [start, end],
    throttleMs = 5000,
  } = options;

  let lastFireTime = 0;

  return (completed: number, total: number, _tableId: string) => {
    const now = Date.now();
    const isFirst = completed === 1;
    const isLast = completed === total;
    const throttleExpired = now - lastFireTime >= throttleMs;

    if (!isFirst && !isLast && !throttleExpired) return;

    lastFireTime = now;

    const progress = Math.round(start + (completed / total) * (end - start));
    const message = `Verifying tables (${completed} of ${total})...`;

    // Fire-and-forget — don't await to avoid blocking the parallel verification loop
    updateFn({
      status: statusValue,
      stage,
      progress,
      message,
    }).catch(() => {
      // Ignore status update errors — they're non-fatal
    });
  };
}
