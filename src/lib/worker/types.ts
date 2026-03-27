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
  fileNames: WorkerFileNames;
  inputRefs: WorkerInputRefs;
  loopStatTestingMode?: 'suppress' | 'complement';
}

export interface ClaimedWorkerRun {
  runId: string;
  orgId: string;
  projectId: string;
  launchedBy?: string;
  attemptCount: number;
  config: Record<string, unknown>;
  executionPayload: WorkerExecutionPayload;
  resumeFromStage?: string;
}
