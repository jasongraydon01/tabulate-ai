export type CheckpointRetryBoundary =
  | 'question_id'
  | 'fork_join'
  | 'review_checkpoint'
  | 'compute';

export interface CheckpointRetryManifestLike {
  boundary?: CheckpointRetryBoundary;
  resumeStage?: string;
  isComplete?: boolean;
}

export interface CheckpointRetryRunLike {
  status?: string;
  expiredAt?: number;
  executionState?: string;
  executionPayload?: unknown;
  recoveryManifest?: CheckpointRetryManifestLike | null;
}

function parseBooleanFlag(value: string | undefined): boolean | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

export function isCheckpointRetryEnabled(): boolean {
  const explicit = parseBooleanFlag(process.env.NEXT_PUBLIC_ENABLE_RUN_CHECKPOINT_RETRY);
  if (explicit !== null) return explicit;
  return process.env.NODE_ENV !== 'production';
}

export function formatCheckpointBoundary(boundary: CheckpointRetryBoundary): string {
  switch (boundary) {
    case 'question_id':
      return 'question ID';
    case 'fork_join':
      return 'fork/join';
    case 'review_checkpoint':
      return 'review checkpoint';
    case 'compute':
      return 'compute';
    default: {
      const exhaustiveCheck: never = boundary;
      return exhaustiveCheck;
    }
  }
}

export function getCheckpointRetryLabel(
  manifest: CheckpointRetryManifestLike | null | undefined,
): string {
  if (!manifest?.boundary) return 'Retry from checkpoint';
  const boundaryLabel = formatCheckpointBoundary(manifest.boundary);
  return boundaryLabel.endsWith('checkpoint')
    ? `Retry from ${boundaryLabel}`
    : `Retry from ${boundaryLabel} checkpoint`;
}

export function getCheckpointRetryAvailability(
  run: CheckpointRetryRunLike | null | undefined,
): { eligible: boolean; reason?: string } {
  if (!run) {
    return { eligible: false, reason: 'Run not found.' };
  }

  if (run.status !== 'error') {
    return { eligible: false, reason: 'Only failed runs can retry from a checkpoint.' };
  }

  if (run.expiredAt) {
    return { eligible: false, reason: 'Run artifacts have expired.' };
  }

  if (!run.executionPayload) {
    return { eligible: false, reason: 'Run is missing execution payload.' };
  }

  if (!run.recoveryManifest) {
    return { eligible: false, reason: 'No durable recovery checkpoint is available.' };
  }

  if (!run.recoveryManifest.isComplete) {
    return { eligible: false, reason: 'Durable recovery checkpoint is incomplete.' };
  }

  if (!run.recoveryManifest.resumeStage) {
    return { eligible: false, reason: 'Recovery checkpoint is missing a resume stage.' };
  }

  if (run.executionState === 'queued' || run.executionState === 'claimed' || run.executionState === 'running' || run.executionState === 'resuming') {
    return { eligible: false, reason: 'Run is already queued or active.' };
  }

  return { eligible: true };
}
