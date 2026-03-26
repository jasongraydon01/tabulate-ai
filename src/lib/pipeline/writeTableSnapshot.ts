/**
 * Shared helper for persisting table snapshots at each pipeline stage.
 * Used by PipelineRunner, pipelineOrchestrator, and reviewCompletion.
 *
 * Each snapshot is written to `tables/{stageNumber}-{stageName}.json`
 * with a `_metadata` header for quick inspection.
 */
import { promises as fs } from 'fs';
import * as path from 'path';

export interface TableSnapshotMetadata {
  stage: string;
  stageNumber: number;
  stageSuffix?: string;
  tableCount: number;
  timestamp: string;
  previousStage?: string;
  previousTableCount?: number;
  notes?: string;
}

export interface TableSnapshot {
  _metadata: TableSnapshotMetadata;
  tables: unknown[];
}

/**
 * Write a numbered table snapshot to `tables/` inside the pipeline output directory.
 *
 * Non-fatal: wraps in try/catch and logs a warning on failure — never blocks the pipeline.
 */
export async function writeTableSnapshot(
  outputDir: string,
  stageNumber: number,
  stageName: string,
  tables: unknown[],
  opts?: {
    stageSuffix?: string;
    previousStage?: string;
    previousTableCount?: number;
    notes?: string;
  },
): Promise<void> {
  try {
    const tablesDir = path.join(outputDir, 'tables');
    await fs.mkdir(tablesDir, { recursive: true });

    const paddedNumber = String(stageNumber).padStart(2, '0');
    const rawSuffix = opts?.stageSuffix?.trim() || '';
    const stageSuffix = rawSuffix.replace(/[^a-zA-Z0-9]/g, '');
    const stagePrefix = `${paddedNumber}${stageSuffix}`;
    const filename = `${stagePrefix}-${stageName}.json`;

    const snapshot: TableSnapshot = {
      _metadata: {
        stage: stageName,
        stageNumber,
        ...(stageSuffix ? { stageSuffix } : {}),
        tableCount: tables.length,
        timestamp: new Date().toISOString(),
        ...(opts?.previousStage !== undefined && { previousStage: opts.previousStage }),
        ...(opts?.previousTableCount !== undefined && { previousTableCount: opts.previousTableCount }),
        ...(opts?.notes !== undefined && { notes: opts.notes }),
      },
      tables,
    };

    await fs.writeFile(
      path.join(tablesDir, filename),
      JSON.stringify(snapshot, null, 2),
      'utf-8',
    );
  } catch (err) {
    console.warn(
      `[writeTableSnapshot] Failed to write stage ${stageNumber} (${stageName}):`,
      err instanceof Error ? err.message : String(err),
    );
  }
}
