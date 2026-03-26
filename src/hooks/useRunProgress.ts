'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { parseRunResult } from '@/schemas/runResultSchema';
import { useRunStatus } from './useRunStatus';

interface UseRunProgressCallbacks {
  setRunId: (id: string | null) => void;
  setIsProcessing: (v: boolean) => void;
  setRunError: (err: string | null) => void;
  refresh: () => void;
}

/**
 * Replaces both useJobPolling and useJobRecovery.
 * Uses Convex real-time subscription instead of HTTP polling.
 * No localStorage needed — Convex persists state across restarts.
 */
export function useRunProgress(
  runId: string | null,
  orgId: string | null,
  callbacks: UseRunProgressCallbacks,
) {
  const router = useRouter();
  const run = useRunStatus(runId, orgId);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  const prevStatusRef = useRef<string | null>(null);

  useEffect(() => {
    if (!runId || run === undefined) return; // loading or no runId

    // run is null → run not found in Convex
    if (run === null) {
      callbacksRef.current.setIsProcessing(false);
      callbacksRef.current.setRunId(null);
      toast.error('Run not found', {
        id: 'pipeline-progress',
        description: 'The pipeline run could not be found.',
      });
      return;
    }

    const { setRunId, setIsProcessing, setRunError, refresh } = callbacksRef.current;
    const status = run.status;
    const projectId = run.projectId ? String(run.projectId) : null;
    const prevStatus = prevStatusRef.current;
    prevStatusRef.current = status;

    // Cancelled
    if (status === 'cancelled') {
      setIsProcessing(false);
      setRunId(null);
      refresh();
      if (prevStatus && prevStatus !== 'cancelled') {
        toast.info('Pipeline cancelled', {
          id: 'pipeline-progress',
          description: 'The processing was stopped.',
        });
      }
      return;
    }

    // Review required
    if (status === 'pending_review') {
      setIsProcessing(false);
      setRunId(null);
      refresh();
      if (prevStatus && prevStatus !== 'pending_review') {
        const reviewUrl = parseRunResult(run.result)?.reviewUrl;
        const reviewDestination = projectId
          ? `/projects/${encodeURIComponent(projectId)}/review`
          : reviewUrl;
        toast.warning('Mapping Review Required', {
          id: 'pipeline-progress',
          description: 'Some columns need your attention',
          action: reviewDestination
            ? { label: 'Review Now', onClick: () => router.push(reviewDestination) }
            : undefined,
          duration: 30000,
        });
      }
      return;
    }

    // Terminal success states
    if (status === 'success' || status === 'partial') {
      setIsProcessing(false);
      setRunId(null);
      refresh();
      if (prevStatus && prevStatus !== status) {
        const result = parseRunResult(run.result);
        const pipelineId = result?.pipelineId;
        const detailsDestination = projectId
          ? `/projects/${encodeURIComponent(projectId)}`
          : (pipelineId ? `/projects/${encodeURIComponent(pipelineId)}` : undefined);
        toast.success('Pipeline complete!', {
          id: 'pipeline-progress',
          description: run.message || 'Your crosstabs have been generated.',
          action: detailsDestination
            ? { label: 'View Details', onClick: () => router.push(detailsDestination) }
            : undefined,
        });
      }
      return;
    }

    // Error
    if (status === 'error') {
      setIsProcessing(false);
      setRunId(null);
      setRunError(run.error || 'Unknown error');
      if (prevStatus && prevStatus !== 'error') {
        toast.error('Processing failed', {
          id: 'pipeline-progress',
          description: run.error || 'Unknown error',
        });
      }
      return;
    }

    // In progress — show toast with stage/progress
    if (status === 'in_progress' || status === 'resuming') {
      setIsProcessing(true);
      const percent = Math.max(1, Math.min(100, run.progress ?? 0));
      toast.loading('Processing pipeline...', {
        id: 'pipeline-progress',
        description: `${run.message || 'Processing...'} (${percent}%)`,
        duration: Infinity,
      });
    }
  }, [runId, run, router]);
}
