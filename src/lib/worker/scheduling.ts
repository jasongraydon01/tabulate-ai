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

export function buildClaimCandidateOrder<T extends QueueSchedulingRun>(
  queuedRuns: T[],
  activeRuns: QueueSchedulingRun[],
  capacity?: Partial<WorkerQueueCapacity>,
): T[] {
  const normalizedCapacity = normalizeWorkerQueueCapacity(capacity);
  const activeByOrg = new Map<string, number>();
  let activeDemoRuns = 0;

  for (const run of activeRuns) {
    const queueClass = getWorkerQueueClass(run);
    activeByOrg.set(run.orgId, (activeByOrg.get(run.orgId) ?? 0) + 1);
    if (queueClass === 'demo') {
      activeDemoRuns++;
    }
  }

  const reviewResume: T[] = [];
  const project: T[] = [];
  const demo: T[] = [];

  for (const run of queuedRuns) {
    const queueClass = getWorkerQueueClass(run);

    if (queueClass === 'review_resume') {
      reviewResume.push(run);
      continue;
    }

    const activeForOrg = activeByOrg.get(run.orgId) ?? 0;
    if (activeForOrg >= normalizedCapacity.maxActiveRunsPerOrg) {
      continue;
    }

    if (queueClass === 'demo') {
      if (activeDemoRuns >= normalizedCapacity.maxActiveDemoRuns) {
        continue;
      }
      demo.push(run);
      continue;
    }

    project.push(run);
  }

  return [...reviewResume, ...project, ...demo];
}
