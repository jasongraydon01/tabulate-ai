import type { WorkerQueueClass } from './types';

export interface QueueSchedulingRun {
  orgId: string;
  queueClass?: WorkerQueueClass;
  resumeFromStage?: string;
}

export interface WorkerQueueCapacity {
  maxActiveDemoRuns: number;
  maxActiveRunsPerOrg: number;
}

export interface WorkerQueueSnapshot {
  queuedCount: number;
  activeCount: number;
  eligibleCount: number;
  blockedCount: number;
  blockedByOrgLimitCount: number;
  blockedByDemoLimitCount: number;
  queuedByClass: Record<WorkerQueueClass, number>;
  activeByClass: Record<'claimed' | 'running' | 'resuming', number>;
  activeByOrg: Record<string, number>;
  nextClaimableQueueClass: WorkerQueueClass | null;
  capacity: WorkerQueueCapacity;
}

function normalizePositiveInteger(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

export function normalizeWorkerQueueCapacity(
  capacity?: Partial<WorkerQueueCapacity>,
): WorkerQueueCapacity {
  return {
    maxActiveDemoRuns: normalizePositiveInteger(capacity?.maxActiveDemoRuns ?? 2, 2),
    maxActiveRunsPerOrg: normalizePositiveInteger(capacity?.maxActiveRunsPerOrg ?? 2, 2),
  };
}

export function getWorkerQueueClass(run: QueueSchedulingRun): WorkerQueueClass {
  if (run.queueClass) return run.queueClass;
  return run.resumeFromStage ? 'review_resume' : 'project';
}

function buildActiveRunCounts(activeRuns: QueueSchedulingRun[]) {
  const activeByOrg = new Map<string, number>();
  let activeDemoRuns = 0;

  for (const run of activeRuns) {
    const queueClass = getWorkerQueueClass(run);
    activeByOrg.set(run.orgId, (activeByOrg.get(run.orgId) ?? 0) + 1);
    if (queueClass === 'demo') {
      activeDemoRuns++;
    }
  }

  return { activeByOrg, activeDemoRuns };
}

function partitionClaimCandidates<T extends QueueSchedulingRun>(
  queuedRuns: T[],
  activeRuns: QueueSchedulingRun[],
  capacity?: Partial<WorkerQueueCapacity>,
): {
  normalizedCapacity: WorkerQueueCapacity;
  reviewResume: T[];
  project: T[];
  demo: T[];
  blockedByOrgLimitCount: number;
  blockedByDemoLimitCount: number;
  activeByOrg: Map<string, number>;
} {
  const normalizedCapacity = normalizeWorkerQueueCapacity(capacity);
  const { activeByOrg, activeDemoRuns } = buildActiveRunCounts(activeRuns);

  const reviewResume: T[] = [];
  const project: T[] = [];
  const demo: T[] = [];
  let blockedByOrgLimitCount = 0;
  let blockedByDemoLimitCount = 0;

  for (const run of queuedRuns) {
    const queueClass = getWorkerQueueClass(run);

    if (queueClass === 'review_resume') {
      reviewResume.push(run);
      continue;
    }

    const activeForOrg = activeByOrg.get(run.orgId) ?? 0;
    if (activeForOrg >= normalizedCapacity.maxActiveRunsPerOrg) {
      blockedByOrgLimitCount++;
      continue;
    }

    if (queueClass === 'demo') {
      if (activeDemoRuns >= normalizedCapacity.maxActiveDemoRuns) {
        blockedByDemoLimitCount++;
        continue;
      }
      demo.push(run);
      continue;
    }

    project.push(run);
  }

  return {
    normalizedCapacity,
    reviewResume,
    project,
    demo,
    blockedByOrgLimitCount,
    blockedByDemoLimitCount,
    activeByOrg,
  };
}

export function buildClaimCandidateOrder<T extends QueueSchedulingRun>(
  queuedRuns: T[],
  activeRuns: QueueSchedulingRun[],
  capacity?: Partial<WorkerQueueCapacity>,
): T[] {
  const { reviewResume, project, demo } = partitionClaimCandidates(queuedRuns, activeRuns, capacity);
  return [...reviewResume, ...project, ...demo];
}

export function summarizeWorkerQueue(
  queuedRuns: QueueSchedulingRun[],
  activeRuns: Array<QueueSchedulingRun & { executionState?: 'claimed' | 'running' | 'resuming' }>,
  capacity?: Partial<WorkerQueueCapacity>,
): WorkerQueueSnapshot {
  const {
    normalizedCapacity,
    reviewResume,
    project,
    demo,
    blockedByOrgLimitCount,
    blockedByDemoLimitCount,
    activeByOrg,
  } = partitionClaimCandidates(queuedRuns, activeRuns, capacity);

  const queuedByClass: Record<WorkerQueueClass, number> = {
    review_resume: 0,
    project: 0,
    demo: 0,
  };
  for (const run of queuedRuns) {
    queuedByClass[getWorkerQueueClass(run)]++;
  }

  const activeByClass: Record<'claimed' | 'running' | 'resuming', number> = {
    claimed: 0,
    running: 0,
    resuming: 0,
  };
  for (const run of activeRuns) {
    if (run.executionState === 'claimed' || run.executionState === 'running' || run.executionState === 'resuming') {
      activeByClass[run.executionState]++;
    }
  }

  const eligibleCount = reviewResume.length + project.length + demo.length;
  const nextClaimableQueueClass = reviewResume[0]
    ? 'review_resume'
    : project[0]
      ? 'project'
      : demo[0]
        ? 'demo'
        : null;

  return {
    queuedCount: queuedRuns.length,
    activeCount: activeRuns.length,
    eligibleCount,
    blockedCount: queuedRuns.length - eligibleCount,
    blockedByOrgLimitCount,
    blockedByDemoLimitCount,
    queuedByClass,
    activeByClass,
    activeByOrg: Object.fromEntries(
      [...activeByOrg.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    nextClaimableQueueClass,
    capacity: normalizedCapacity,
  };
}
