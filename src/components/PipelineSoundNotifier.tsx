'use client';

import { useEffect, useRef } from 'react';
import { useQuery } from 'convex/react';
import { useAuthContext } from '@/providers/auth-provider';
import { useSoundPreference } from '@/hooks/useSoundPreference';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

/**
 * Statuses that indicate the pipeline just started or resumed processing.
 */
const STARTED_STATUSES = new Set(['in_progress', 'resuming']);

/**
 * Statuses that indicate the pipeline reached a terminal or pause state.
 */
const FINISHED_STATUSES = new Set(['success', 'partial', 'error']);

/**
 * Determines whether a status transition should trigger a notification sound.
 * Returns true for:
 *  1. Pipeline started — any run enters in_progress (from null/pending/other)
 *  2. Review needed — run transitions to pending_review
 *  3. Pipeline continued — run transitions from pending_review back to in_progress/resuming
 *  4. Pipeline finished — run reaches success, partial, or error
 */
function shouldNotify(prevStatus: string | undefined, newStatus: string): boolean {
  // No previous status means initial load — skip to avoid noise on page load
  if (prevStatus === undefined) return false;
  // Same status — no transition
  if (prevStatus === newStatus) return false;

  // Pipeline started or resumed
  if (STARTED_STATUSES.has(newStatus)) return true;
  // Review needed
  if (newStatus === 'pending_review') return true;
  // Pipeline finished
  if (FINISHED_STATUSES.has(newStatus)) return true;

  return false;
}

function playNotificationSound() {
  try {
    const audio = new Audio('/sounds/pipeline-notify.mp3');
    audio.play().catch(() => {
      // Browser autoplay policy blocked — silently ignore
    });
  } catch {
    // Audio constructor not available (SSR edge case)
  }
}

/**
 * Invisible component that monitors all org runs via Convex subscription
 * and plays a notification sound on meaningful pipeline status transitions.
 *
 * Mount once at the app shell level (e.g. inside AuthProvider).
 */
export function PipelineSoundNotifier() {
  const { convexOrgId } = useAuthContext();
  const [soundEnabled] = useSoundPreference();

  const runs = useQuery(
    api.runs.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<'organizations'> } : 'skip',
  );

  // Track previous status per run. Key: run._id, Value: status string.
  // Using undefined as sentinel for "first time seeing this run".
  const prevStatusMap = useRef<Map<string, string | undefined>>(new Map());

  useEffect(() => {
    if (!runs || !soundEnabled) return;

    let shouldPlay = false;
    const currentRunIds = new Set<string>();

    for (const run of runs) {
      const runId = String(run._id);
      currentRunIds.add(runId);
      const prevStatus = prevStatusMap.current.get(runId);
      const newStatus = run.status;

      if (shouldNotify(prevStatus, newStatus)) {
        shouldPlay = true;
      }

      prevStatusMap.current.set(runId, newStatus);
    }

    // Clean up stale entries for runs no longer in the list
    for (const [runId] of prevStatusMap.current) {
      if (!currentRunIds.has(runId)) {
        prevStatusMap.current.delete(runId);
      }
    }

    if (shouldPlay) {
      playNotificationSound();
    }
  }, [runs, soundEnabled]);

  // Invisible component — renders nothing
  return null;
}
