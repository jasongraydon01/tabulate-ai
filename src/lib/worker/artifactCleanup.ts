import { promises as fs } from 'fs';
import path from 'path';

import { mutateInternal, queryInternal } from '@/lib/convex';
import { deletePrefix } from '@/lib/r2/r2';
import { parseRunResult } from '@/schemas/runResultSchema';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

export interface PendingArtifactCleanupRun {
  _id: Id<'runs'>;
  orgId: Id<'organizations'>;
  projectId: Id<'projects'>;
  result?: unknown;
}

export interface ArtifactCleanupSummary {
  processed: number;
  purged: number;
  failed: number;
}

const OUTPUTS_BASE_DIR = path.resolve(process.cwd(), 'outputs');

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function resolveRunOutputDir(run: PendingArtifactCleanupRun): string | null {
  const runResult = parseRunResult(run.result);
  if (runResult?.outputDir) {
    return runResult.outputDir;
  }
  if (runResult?.dataset && runResult?.pipelineId) {
    return path.join(process.cwd(), 'outputs', runResult.dataset, runResult.pipelineId);
  }
  return null;
}

function resolveSafeOutputDir(outputDir: string): string | null {
  const resolved = path.resolve(outputDir);
  if (
    resolved === OUTPUTS_BASE_DIR
    || (!resolved.startsWith(`${OUTPUTS_BASE_DIR}${path.sep}`))
  ) {
    return null;
  }
  return resolved;
}

async function removeLocalArtifacts(run: PendingArtifactCleanupRun): Promise<string[]> {
  const errors: string[] = [];
  const outputDir = resolveRunOutputDir(run);

  if (outputDir) {
    const safeOutputDir = resolveSafeOutputDir(outputDir);
    if (!safeOutputDir) {
      errors.push(`Refusing to delete unsafe outputDir: ${outputDir}`);
    } else {
      await fs.rm(safeOutputDir, { recursive: true, force: true });
    }
  }

  const recoveredDir = path.join(OUTPUTS_BASE_DIR, '_recovered', String(run._id));
  await fs.rm(recoveredDir, { recursive: true, force: true });

  return errors;
}

export async function cleanupSinglePendingArtifactRun(
  run: PendingArtifactCleanupRun,
): Promise<{ purged: boolean }> {
  try {
    const prefix = `${String(run.orgId)}/${String(run.projectId)}/runs/${String(run._id)}/`;
    const r2Result = await deletePrefix(prefix);
    const localErrors = await removeLocalArtifacts(run);
    const errors = [...localErrors];

    if (r2Result.errors > 0) {
      errors.push(`R2 deletion failed for ${r2Result.errors} object(s) under ${prefix}`);
    }

    if (errors.length > 0) {
      await mutateInternal(internal.runs.recordArtifactCleanupFailure, {
        runId: run._id,
        error: errors.join(' | '),
      });
      return { purged: false };
    }

    await mutateInternal(internal.runs.markRunArtifactsPurged, {
      runId: run._id,
    });
    return { purged: true };
  } catch (error) {
    await mutateInternal(internal.runs.recordArtifactCleanupFailure, {
      runId: run._id,
      error: describeError(error),
    });
    return { purged: false };
  }
}

export async function cleanupPendingArtifactRuns(limit = 5): Promise<ArtifactCleanupSummary> {
  const runs = await queryInternal(internal.runs.getRunsPendingArtifactCleanup, { limit }) as PendingArtifactCleanupRun[];
  const summary: ArtifactCleanupSummary = {
    processed: 0,
    purged: 0,
    failed: 0,
  };

  for (const run of runs) {
    summary.processed += 1;
    const result = await cleanupSinglePendingArtifactRun(run);
    if (result.purged) {
      summary.purged += 1;
    } else {
      summary.failed += 1;
    }
  }

  return summary;
}
