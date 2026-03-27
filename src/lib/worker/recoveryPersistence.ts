import { promises as fs } from 'fs';
import path from 'path';

import { mutateInternal } from '@/lib/convex';
import { uploadRunOutputArtifact, downloadToTemp } from '@/lib/r2/R2FileManager';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

import {
  buildWorkerRecoveryManifest,
  type WorkerRecoveryArtifactField,
  type WorkerRecoveryArtifactRefs,
  type WorkerRecoveryBoundary,
  type WorkerRecoveryManifest,
  type WorkerPipelineContext,
  RECOVERY_ARTIFACT_TARGET_PATHS,
  getRecoveryFailureReason,
} from './recovery';

function getBoundaryArtifactFields(
  boundary: WorkerRecoveryBoundary,
): WorkerRecoveryArtifactField[] {
  switch (boundary) {
    case 'question_id':
      return ['checkpoint', 'questionIdFinal', 'pipelineSummary'];
    case 'fork_join':
      return [
        'checkpoint',
        'questionIdFinal',
        'tableEnriched',
        'tableCanonical',
        'crosstabPlan',
        'pipelineSummary',
      ];
    case 'review_checkpoint':
      return [
        'checkpoint',
        'questionIdFinal',
        'tableEnriched',
        'tableCanonical',
        'crosstabPlan',
        'reviewState',
        'pipelineSummary',
        'dataFileSav',
      ];
    case 'compute':
      return [
        'checkpoint',
        'questionIdFinal',
        'tableEnriched',
        'tableCanonical',
        'crosstabPlan',
        'computePackage',
        'pipelineSummary',
      ];
  }
}

async function readArtifactBuffer(localPath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(localPath);
  } catch (error) {
    if (
      error
      && typeof error === 'object'
      && 'code' in error
      && (error as NodeJS.ErrnoException).code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

function getManifestRelativePath(boundary: WorkerRecoveryBoundary): string {
  return `recovery/${boundary}-manifest.json`;
}

function getOutputArtifactLocalPath(
  outputDir: string,
  field: WorkerRecoveryArtifactField,
): string {
  return path.join(outputDir, RECOVERY_ARTIFACT_TARGET_PATHS[field]);
}

export async function persistDurableRecoveryBoundary(params: {
  runId: string;
  orgId: string;
  projectId: string;
  outputDir: string;
  pipelineContext: WorkerPipelineContext;
  boundary: WorkerRecoveryBoundary;
  artifactRefOverrides?: WorkerRecoveryArtifactRefs;
}): Promise<WorkerRecoveryManifest> {
  const artifactRefs: WorkerRecoveryArtifactRefs = {
    ...(params.artifactRefOverrides ?? {}),
  };

  for (const field of getBoundaryArtifactFields(params.boundary)) {
    if (artifactRefs[field]) continue;

    const localPath = getOutputArtifactLocalPath(params.outputDir, field);
    const body = await readArtifactBuffer(localPath);
    if (!body) continue;

    try {
      artifactRefs[field] = await uploadRunOutputArtifact({
        orgId: params.orgId,
        projectId: params.projectId,
        runId: params.runId,
        relativePath: RECOVERY_ARTIFACT_TARGET_PATHS[field],
        body,
      });
    } catch (error) {
      console.warn(
        `[WorkerRecovery] Failed to upload durable artifact ${field}:`,
        error,
      );
    }
  }

  let manifest = buildWorkerRecoveryManifest({
    boundary: params.boundary,
    pipelineContext: params.pipelineContext,
    artifactRefs,
  });

  try {
    const manifestKey = await uploadRunOutputArtifact({
      orgId: params.orgId,
      projectId: params.projectId,
      runId: params.runId,
      relativePath: getManifestRelativePath(params.boundary),
      body: JSON.stringify(manifest, null, 2),
      contentType: 'application/json',
    });
    manifest = {
      ...manifest,
      manifestKey,
    };
  } catch (error) {
    console.warn(
      `[WorkerRecovery] Failed to upload durable manifest for ${params.boundary}:`,
      error,
    );
  }

  await mutateInternal(internal.runs.updateRecoveryManifest, {
    runId: params.runId as Id<'runs'>,
    recoveryManifest: manifest,
  });

  return manifest;
}

function ensureOutputDirIsSafe(outputDir: string): void {
  const resolvedOutputDir = path.resolve(outputDir);
  const allowedBase = path.resolve(process.cwd(), 'outputs');

  if (
    !resolvedOutputDir.startsWith(`${allowedBase}${path.sep}`)
    && resolvedOutputDir !== allowedBase
  ) {
    throw new Error(`Invalid recovery output path: ${outputDir}`);
  }
}

export async function restoreDurableRecoveryWorkspace(
  manifest: WorkerRecoveryManifest,
): Promise<void> {
  const recoveryFailure = getRecoveryFailureReason(manifest);
  if (recoveryFailure) {
    throw new Error(recoveryFailure);
  }

  const outputDir = manifest.pipelineContext.outputDir;
  ensureOutputDirIsSafe(outputDir);
  await fs.mkdir(outputDir, { recursive: true });

  const downloads = Object.entries(manifest.artifactRefs).map(async ([field, key]) => {
    if (!key) return;

    const artifactField = field as WorkerRecoveryArtifactField;
    const localPath = getOutputArtifactLocalPath(outputDir, artifactField);
    await downloadToTemp(key, localPath);
  });

  await Promise.all(downloads);

  if (manifest.manifestKey) {
    try {
      await downloadToTemp(
        manifest.manifestKey,
        path.join(outputDir, getManifestRelativePath(manifest.boundary)),
      );
    } catch (error) {
      console.warn(
        `[WorkerRecovery] Failed to restore manifest for ${manifest.boundary}:`,
        error,
      );
    }
  }
}
