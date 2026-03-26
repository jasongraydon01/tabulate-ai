/**
 * Manages temporary directories for pipeline runs.
 * Provides create/get/cleanup lifecycle for run-scoped temp dirs.
 */
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const TEMP_BASE = join(tmpdir(), 'hawktab-ai', 'runs');

/**
 * Create a temp directory for a pipeline run.
 * Pattern: /tmp/hawktab-ai/runs/{runId}/
 */
export async function createRunTempDir(runId: string): Promise<string> {
  const dir = join(TEMP_BASE, runId);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Get the temp directory path for a run (does not create it).
 */
export function getTempDir(runId: string): string {
  return join(TEMP_BASE, runId);
}

/**
 * Check if a run's temp directory exists.
 */
export async function tempDirExists(runId: string): Promise<boolean> {
  try {
    const stat = await fs.stat(join(TEMP_BASE, runId));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Delete a run's temp directory and all contents.
 */
export async function cleanupRunTempDir(runId: string): Promise<void> {
  try {
    await fs.rm(join(TEMP_BASE, runId), { recursive: true, force: true });
  } catch (error) {
    console.warn(
      `[TempDirManager] Failed to clean up temp dir for run ${runId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Remove temp directories older than maxAgeMs (default 24 hours).
 */
export async function cleanupStaleTempDirs(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
  let cleaned = 0;
  try {
    const entries = await fs.readdir(TEMP_BASE, { withFileTypes: true });
    const now = Date.now();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const dirPath = join(TEMP_BASE, entry.name);
        const stat = await fs.stat(dirPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          const ageHours = Math.round((now - stat.mtimeMs) / (60 * 60 * 1000));
          await fs.rm(dirPath, { recursive: true, force: true });
          cleaned++;
          console.log(`[TempDirManager] Cleaned stale temp dir: ${entry.name} (${ageHours}h old)`);
        }
      } catch (error) {
        console.warn(
          `[TempDirManager] Failed to clean stale dir ${entry.name}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  } catch {
    // TEMP_BASE may not exist yet — not an error
  }
  if (cleaned > 0) {
    console.log(`[TempDirManager] Startup sweep: removed ${cleaned} stale temp dir(s)`);
  }
  return cleaned;
}
