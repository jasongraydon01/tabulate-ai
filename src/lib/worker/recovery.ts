import type { V3PipelineStage } from '../../schemas/pipelineStageSchema';

export const WORKER_RECOVERY_SCHEMA_VERSION = 1;

export const WORKER_RECOVERY_BOUNDARIES = [
  'question_id',
  'fork_join',
  'review_checkpoint',
  'compute',
] as const;

export type WorkerRecoveryBoundary = (typeof WORKER_RECOVERY_BOUNDARIES)[number];

export const WORKER_RECOVERY_ARTIFACT_FIELDS = [
  'checkpoint',
  'questionIdFinal',
  'tableCanonical',
  'tableEnriched',
  'crosstabPlan',
  'computePackage',
  'reviewState',
  'pipelineSummary',
  'dataFileSav',
] as const;

export type WorkerRecoveryArtifactField =
  (typeof WORKER_RECOVERY_ARTIFACT_FIELDS)[number];

export interface WorkerPipelineContext {
  pipelineId: string;
  datasetName: string;
  outputDir: string;
}

export type WorkerRecoveryArtifactRefs =
  Partial<Record<WorkerRecoveryArtifactField, string>>;

export interface WorkerRecoveryManifest {
  schemaVersion: number;
  boundary: WorkerRecoveryBoundary;
  resumeStage: V3PipelineStage;
  pipelineContext: WorkerPipelineContext;
  artifactRefs: WorkerRecoveryArtifactRefs;
  requiredArtifacts: WorkerRecoveryArtifactField[];
  missingArtifacts: WorkerRecoveryArtifactField[];
  isComplete: boolean;
  createdAt: number;
  manifestKey?: string;
}

export interface StaleWorkerRecoveryRunLike {
  cancelRequested: boolean;
  claimedAt?: number;
  heartbeatAt?: number;
  lastHeartbeat?: number;
  _creationTime: number;
  recoveryManifest?: WorkerRecoveryManifest;
}

export const RECOVERY_ARTIFACT_TARGET_PATHS: Record<
  WorkerRecoveryArtifactField,
  string
> = {
  checkpoint: 'checkpoint.json',
  questionIdFinal: 'enrichment/12-questionid-final.json',
  tableCanonical: 'tables/13d-table-canonical.json',
  tableEnriched: 'tables/13e-table-enriched.json',
  crosstabPlan: 'planning/21-crosstab-plan.json',
  computePackage: 'compute/22-compute-package.json',
  reviewState: 'crosstab-review-state.json',
  pipelineSummary: 'pipeline-summary.json',
  dataFileSav: 'dataFile.sav',
};

export const REQUIRED_RECOVERY_ARTIFACTS: Record<
  WorkerRecoveryBoundary,
  WorkerRecoveryArtifactField[]
> = {
  question_id: ['checkpoint', 'questionIdFinal'],
  fork_join: ['checkpoint', 'questionIdFinal', 'tableEnriched', 'crosstabPlan'],
  review_checkpoint: [
    'checkpoint',
    'questionIdFinal',
    'tableEnriched',
    'crosstabPlan',
    'reviewState',
    'pipelineSummary',
    'dataFileSav',
  ],
  compute: [
    'checkpoint',
    'questionIdFinal',
    'tableEnriched',
    'crosstabPlan',
    'computePackage',
  ],
};

export function getResumeStageForRecoveryBoundary(
  boundary: WorkerRecoveryBoundary,
): V3PipelineStage {
  switch (boundary) {
    case 'question_id':
      return 'v3_fork_join';
    case 'fork_join':
      return 'v3_compute';
    case 'review_checkpoint':
      return 'v3_compute';
    case 'compute':
      return 'executing_r';
  }
}

export function buildWorkerRecoveryManifest(params: {
  boundary: WorkerRecoveryBoundary;
  pipelineContext: WorkerPipelineContext;
  artifactRefs: WorkerRecoveryArtifactRefs;
  createdAt?: number;
  manifestKey?: string;
}): WorkerRecoveryManifest {
  const requiredArtifacts = REQUIRED_RECOVERY_ARTIFACTS[params.boundary];
  const missingArtifacts = requiredArtifacts.filter(
    (field) => !params.artifactRefs[field],
  );

  return {
    schemaVersion: WORKER_RECOVERY_SCHEMA_VERSION,
    boundary: params.boundary,
    resumeStage: getResumeStageForRecoveryBoundary(params.boundary),
    pipelineContext: params.pipelineContext,
    artifactRefs: params.artifactRefs,
    requiredArtifacts,
    missingArtifacts,
    isComplete: missingArtifacts.length === 0,
    createdAt: params.createdAt ?? Date.now(),
    ...(params.manifestKey ? { manifestKey: params.manifestKey } : {}),
  };
}

export function getRecoveryFailureReason(
  manifest: WorkerRecoveryManifest | null | undefined,
): string | null {
  if (!manifest) return null;
  if (manifest.isComplete) return null;

  const missing = manifest.missingArtifacts.join(', ');
  return (
    `Durable recovery checkpoint "${manifest.boundary}" is incomplete. ` +
    `Missing required artifacts: ${missing || 'unknown'}.`
  );
}

export function getStaleWorkerRecoveryAction(params: {
  run: StaleWorkerRecoveryRunLike;
  staleBeforeMs: number;
  now?: number;
}):
  | { action: 'skip' }
  | { action: 'cancel' }
  | { action: 'requeue'; resumeFromStage?: V3PipelineStage; message: string }
  | { action: 'fail'; message: string } {
  const now = params.now ?? Date.now();
  const { run, staleBeforeMs } = params;
  const lastAlive =
    run.heartbeatAt ?? run.lastHeartbeat ?? run.claimedAt ?? run._creationTime;

  if (now - lastAlive <= staleBeforeMs) {
    return { action: 'skip' };
  }

  if (run.cancelRequested) {
    return { action: 'cancel' };
  }

  const recoveryFailure = getRecoveryFailureReason(run.recoveryManifest);
  if (recoveryFailure) {
    return { action: 'fail', message: recoveryFailure };
  }

  if (run.recoveryManifest?.isComplete) {
    return {
      action: 'requeue',
      resumeFromStage: run.recoveryManifest.resumeStage,
      message:
        `Run requeued for worker recovery from durable ` +
        `${run.recoveryManifest.boundary} checkpoint.`,
    };
  }

  return {
    action: 'requeue',
    message: 'Run requeued after stale worker lease.',
  };
}
