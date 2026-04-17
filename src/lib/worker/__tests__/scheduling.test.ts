import { describe, expect, it } from 'vitest';

import {
  buildClaimCandidateOrder,
  getWorkerQueueClass,
  summarizeWorkerQueue,
} from '../scheduling';

type TestRun = {
  id: string;
  orgId: string;
  queueClass?: 'review_resume' | 'project' | 'demo';
  resumeFromStage?: string;
};

describe('worker scheduling', () => {
  it('prioritizes review resumes ahead of projects and demos', () => {
    const queuedRuns: TestRun[] = [
      { id: 'demo-1', orgId: 'demo-org', queueClass: 'demo' },
      { id: 'project-1', orgId: 'project-org', queueClass: 'project' },
      { id: 'resume-1', orgId: 'project-org', queueClass: 'review_resume' },
    ];

    const ordered = buildClaimCandidateOrder(queuedRuns, []);

    expect(ordered.map((run) => run.id)).toEqual(['resume-1', 'project-1', 'demo-1']);
  });

  it('preserves fifo order within the same queue class', () => {
    const queuedRuns: TestRun[] = [
      { id: 'project-1', orgId: 'org-a', queueClass: 'project' },
      { id: 'project-2', orgId: 'org-b', queueClass: 'project' },
      { id: 'project-3', orgId: 'org-c', queueClass: 'project' },
    ];

    const ordered = buildClaimCandidateOrder(queuedRuns, []);

    expect(ordered.map((run) => run.id)).toEqual(['project-1', 'project-2', 'project-3']);
  });

  it('caps active demo runs while still allowing projects', () => {
    const queuedRuns: TestRun[] = [
      { id: 'demo-queued', orgId: 'demo-org', queueClass: 'demo' },
      { id: 'project-queued', orgId: 'project-org', queueClass: 'project' },
    ];
    const activeRuns: TestRun[] = [
      { id: 'demo-active-1', orgId: 'demo-org', queueClass: 'demo' },
      { id: 'demo-active-2', orgId: 'demo-org-2', queueClass: 'demo' },
    ];

    const ordered = buildClaimCandidateOrder(queuedRuns, activeRuns, {
      maxActiveDemoRuns: 2,
      maxActiveRunsPerOrg: 2,
    });

    expect(ordered.map((run) => run.id)).toEqual(['project-queued']);
  });

  it('caps active runs per org for projects and demos', () => {
    const queuedRuns: TestRun[] = [
      { id: 'blocked-project', orgId: 'org-a', queueClass: 'project' },
      { id: 'allowed-project', orgId: 'org-b', queueClass: 'project' },
      { id: 'allowed-demo', orgId: 'org-c', queueClass: 'demo' },
    ];
    const activeRuns: TestRun[] = [
      { id: 'active-1', orgId: 'org-a', queueClass: 'project' },
      { id: 'active-2', orgId: 'org-a', queueClass: 'project' },
    ];

    const ordered = buildClaimCandidateOrder(queuedRuns, activeRuns, {
      maxActiveDemoRuns: 2,
      maxActiveRunsPerOrg: 2,
    });

    expect(ordered.map((run) => run.id)).toEqual(['allowed-project', 'allowed-demo']);
  });

  it('treats legacy queued review resumes as review_resume priority', () => {
    const legacyReviewResume: TestRun = {
      id: 'legacy-review',
      orgId: 'org-a',
      resumeFromStage: 'applying_review',
    };

    expect(getWorkerQueueClass(legacyReviewResume)).toBe('review_resume');
  });

  it('summarizes blocked org-capacity runs for diagnostics', () => {
    const queuedRuns: TestRun[] = [
      { id: 'blocked-project', orgId: 'org-a', queueClass: 'project' },
      { id: 'eligible-project', orgId: 'org-b', queueClass: 'project' },
    ];
    const activeRuns: Array<TestRun & { executionState: 'claimed' | 'running' | 'resuming' }> = [
      { id: 'active-1', orgId: 'org-a', queueClass: 'project', executionState: 'running' },
      { id: 'active-2', orgId: 'org-a', queueClass: 'project', executionState: 'claimed' },
    ];

    const snapshot = summarizeWorkerQueue(
      queuedRuns,
      activeRuns,
      {
        maxActiveDemoRuns: 2,
        maxActiveRunsPerOrg: 2,
      },
    );

    expect(snapshot.queuedCount).toBe(2);
    expect(snapshot.eligibleCount).toBe(1);
    expect(snapshot.blockedByOrgLimitCount).toBe(1);
    expect(snapshot.blockedByDemoLimitCount).toBe(0);
    expect(snapshot.nextClaimableQueueClass).toBe('project');
    expect(snapshot.activeByOrg).toEqual({ 'org-a': 2 });
  });

  it('summarizes demo-capacity blocks separately from org limits', () => {
    const queuedRuns: TestRun[] = [
      { id: 'demo-queued', orgId: 'demo-org', queueClass: 'demo' },
      { id: 'project-queued', orgId: 'project-org', queueClass: 'project' },
    ];
    const activeRuns: Array<TestRun & { executionState: 'claimed' | 'running' | 'resuming' }> = [
      { id: 'demo-active-1', orgId: 'demo-org', queueClass: 'demo', executionState: 'running' },
      { id: 'demo-active-2', orgId: 'demo-org-2', queueClass: 'demo', executionState: 'claimed' },
    ];

    const snapshot = summarizeWorkerQueue(
      queuedRuns,
      activeRuns,
      {
        maxActiveDemoRuns: 2,
        maxActiveRunsPerOrg: 2,
      },
    );

    expect(snapshot.queuedByClass).toEqual({
      review_resume: 0,
      project: 1,
      demo: 1,
    });
    expect(snapshot.eligibleCount).toBe(1);
    expect(snapshot.blockedByOrgLimitCount).toBe(0);
    expect(snapshot.blockedByDemoLimitCount).toBe(1);
    expect(snapshot.nextClaimableQueueClass).toBe('project');
  });
});
