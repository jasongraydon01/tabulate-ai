import { describe, expect, it } from 'vitest';

import { formatWorkerQueueSnapshotLog } from '@/lib/worker/logging';
import type { WorkerQueueDiagnosticsSnapshot } from '@/lib/worker/types';

function baseSnapshot(): WorkerQueueDiagnosticsSnapshot {
  return {
    queuedCount: 0,
    activeCount: 0,
    pendingReviewCount: 0,
    eligibleCount: 0,
    blockedCount: 0,
    blockedByOrgLimitCount: 0,
    blockedByDemoLimitCount: 0,
    queuedByClass: {
      review_resume: 0,
      project: 0,
      demo: 0,
    },
    activeByClass: {
      claimed: 0,
      running: 0,
      resuming: 0,
    },
    activeByOrg: {},
    nextClaimableQueueClass: null,
    capacity: {
      maxActiveDemoRuns: 2,
      maxActiveRunsPerOrg: 2,
    },
    queuedRuns: [],
    activeRuns: [],
    pendingReviewRuns: [],
  };
}

describe('formatWorkerQueueSnapshotLog', () => {
  it('prints an explicit pending-review line when no worker-claimable runs exist', () => {
    const now = 1_000_000;
    const lines = formatWorkerQueueSnapshotLog(
      {
        ...baseSnapshot(),
        pendingReviewCount: 1,
        pendingReviewRuns: [
          {
            runId: 'jx79c80kmg4qcvn6fa4ykafp8d850me9',
            projectId: 'jn79c80kmg4qcvn6fa4ykafp8d850me9',
            orgId: 'org-1',
            status: 'pending_review',
            executionState: 'pending_review',
            stage: 'review_check',
            progress: 40,
            message: 'Review required (24 columns)',
            createdAt: now - 38 * 60 * 1000,
          },
        ],
      },
      now,
    );

    expect(lines).toEqual([
      '[Worker] No claimable queued runs. active=0 pendingReview=1 activeStates=none',
      expect.stringContaining('Pending review: run=jx79c80k...850me9'),
    ]);
    expect(lines[1]).toContain('status=pending_review');
    expect(lines[1]).toContain('stage=review_check');
    expect(lines[1]).toContain('progress=40%');
    expect(lines[1]).toContain('age=38m');
  });

  it('prints active and queued run details when work is in flight', () => {
    const now = 2_000_000;
    const lines = formatWorkerQueueSnapshotLog(
      {
        ...baseSnapshot(),
        queuedCount: 1,
        activeCount: 1,
        eligibleCount: 1,
        activeByClass: {
          claimed: 0,
          running: 1,
          resuming: 0,
        },
        nextClaimableQueueClass: 'project',
        queuedRuns: [
          {
            runId: 'queued-run-1234567890',
            projectId: 'project-queued-123456',
            orgId: 'org-1',
            status: 'in_progress',
            executionState: 'queued',
            queueClass: 'project',
            message: 'Queued for worker pickup...',
            createdAt: now - 20_000,
          },
        ],
        activeRuns: [
          {
            runId: 'active-run-1234567890',
            projectId: 'project-active-123456',
            orgId: 'org-1',
            status: 'in_progress',
            executionState: 'running',
            queueClass: 'project',
            workerId: 'worker-123',
            stage: 'v3_enrichment',
            progress: 17,
            message: 'Enriching questions...',
            heartbeatAt: now - 12_000,
            claimedAt: now - 60_000,
            attemptCount: 1,
          },
        ],
      },
      now,
    );

    expect(lines[0]).toBe(
      '[Worker] Queue has pending work. queued=1 eligible=1 pendingReview=0 next=project activeStates=running:1',
    );
    expect(lines[1]).toContain('Active: run=active-r...567890');
    expect(lines[1]).toContain('stage=v3_enrichment');
    expect(lines[1]).toContain('heartbeat=12s');
    expect(lines[1]).toContain('claimed=1m');
    expect(lines[2]).toContain('Queued: run=queued-r...567890');
    expect(lines[2]).toContain('queue=project');
  });
});
