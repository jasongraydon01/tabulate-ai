import path from 'path';

import type { WorkerRecoveryBoundary, WorkerRecoveryManifest } from './recovery';

export const RECOVERY_MANIFEST_PRIORITY: WorkerRecoveryBoundary[] = [
  'compute',
  'review_checkpoint',
  'fork_join',
  'question_id',
];

export function resolveRecoveryManifestPath(params: {
  inputPath: string;
  boundary?: WorkerRecoveryBoundary;
}): string {
  const resolvedInput = path.resolve(params.inputPath);
  if (resolvedInput.endsWith('.json')) {
    return resolvedInput;
  }

  const recoveryDir = path.join(resolvedInput, 'recovery');
  if (params.boundary) {
    return path.join(recoveryDir, `${params.boundary}-manifest.json`);
  }

  return path.join(recoveryDir, `${RECOVERY_MANIFEST_PRIORITY[0]}-manifest.json`);
}

export function buildRecoveryRestoreOutputDir(params: {
  manifest: WorkerRecoveryManifest;
  explicitOutputDir?: string;
}): string {
  if (params.explicitOutputDir) {
    return path.resolve(params.explicitOutputDir);
  }

  return path.resolve(
    process.cwd(),
    'outputs',
    '_recovered',
    params.manifest.pipelineContext.pipelineId,
  );
}
