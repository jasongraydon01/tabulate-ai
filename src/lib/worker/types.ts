import type { V3PipelineStage } from '../../schemas/pipelineStageSchema';

import type {
  WorkerPipelineContext,
  WorkerRecoveryManifest,
} from './recovery';
import type { AnalysisBannerExtensionPayload } from '../analysis/computeLane/types';

export type WorkerExecutionState =
  | 'queued'
  | 'claimed'
  | 'running'
  | 'pending_review'
  | 'resuming'
  | 'success'
  | 'partial'
  | 'error'
  | 'cancelled';

export type WorkerQueueClass =
  | 'review_resume'
  | 'project'
  | 'demo';

export interface WorkerQueueRunDiagnostics {
  runId: string;
  projectId: string;
  orgId: string;
  status:
    | 'in_progress'
    | 'pending_review'
    | 'resuming'
    | 'success'
    | 'partial'
    | 'error'
    | 'cancelled';
  executionState: WorkerExecutionState;
  queueClass?: WorkerQueueClass;
  workerId?: string;
  stage?: V3PipelineStage;
  progress?: number;
  message?: string;
  attemptCount?: number;
  resumeFromStage?: V3PipelineStage;
  claimedAt?: number;
  heartbeatAt?: number;
  lastHeartbeat?: number;
  createdAt?: number;
}

export interface WorkerQueueDiagnosticsSnapshot {
  queuedCount: number;
  activeCount: number;
  pendingReviewCount: number;
  eligibleCount: number;
  blockedCount: number;
  blockedByOrgLimitCount: number;
  blockedByDemoLimitCount: number;
  queuedByClass: Record<WorkerQueueClass, number>;
  activeByClass: Record<'claimed' | 'running' | 'resuming', number>;
  activeByOrg: Record<string, number>;
  nextClaimableQueueClass: WorkerQueueClass | null;
  capacity: {
    maxActiveDemoRuns: number;
    maxActiveRunsPerOrg: number;
  };
  queuedRuns: WorkerQueueRunDiagnostics[];
  activeRuns: WorkerQueueRunDiagnostics[];
  pendingReviewRuns: WorkerQueueRunDiagnostics[];
}

export interface WorkerFileNames {
  dataMap: string;
  bannerPlan: string;
  dataFile: string;
  survey: string | null;
  messageList: string | null;
}

export interface WorkerInputRefs {
  dataMap: string | null;
  bannerPlan: string | null;
  spss: string;
  survey: string | null;
  messageList: string | null;
}

export interface WorkerExecutionPayload {
  sessionId: string;
  pipelineContext: WorkerPipelineContext;
  fileNames: WorkerFileNames;
  inputRefs: WorkerInputRefs;
  loopStatTestingMode?: 'suppress' | 'complement';
  analysisExtension?: AnalysisBannerExtensionPayload;
}

export interface ClaimedWorkerRun {
  runId: string;
  orgId: string;
  projectId: string;
  launchedBy?: string;
  attemptCount: number;
  config: Record<string, unknown>;
  executionPayload: WorkerExecutionPayload;
  recoveryManifest?: WorkerRecoveryManifest;
  resumeFromStage?: V3PipelineStage;
}
