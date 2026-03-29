export const RUN_ARTIFACT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export const RUN_ARTIFACTS_EXPIRED_MESSAGE =
  'Run artifacts have been removed after the 30-day retention period.';

export function getRunArtifactsExpireAt(creationTime: number): number {
  return creationTime + RUN_ARTIFACT_RETENTION_MS;
}

export function areRunArtifactsExpired(run: {
  expiredAt?: number | undefined;
  artifactsPurgedAt?: number | undefined;
}): boolean {
  return typeof run.expiredAt === 'number' || typeof run.artifactsPurgedAt === 'number';
}
