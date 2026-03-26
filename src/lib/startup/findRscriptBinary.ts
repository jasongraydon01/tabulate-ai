/**
 * Centralized Rscript path discovery.
 *
 * Currently duplicated in 6+ locations across the codebase. This module
 * provides a single source of truth. Existing consumers can migrate to
 * import from here in a separate cleanup pass.
 */

import { existsSync } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const R_PATHS = [
  '/opt/homebrew/bin/Rscript',   // macOS Apple Silicon
  '/usr/local/bin/Rscript',      // macOS Intel / Linux custom
  '/usr/bin/Rscript',            // Linux standard
  'Rscript',                     // PATH fallback
];

/**
 * Synchronous check: find the first Rscript binary that exists on disk.
 * Fast (no process spawn), but does not verify the binary actually works.
 * The PATH fallback ('Rscript') is skipped since existsSync cannot resolve it.
 */
export function findRscriptSync(): string | null {
  for (const rPath of R_PATHS) {
    // Skip bare 'Rscript' — existsSync cannot resolve PATH lookups
    if (rPath === 'Rscript') continue;
    if (existsSync(rPath)) return rPath;
  }
  return null;
}

/**
 * Async check: find a working Rscript binary by executing `--version`.
 * Slower than sync (spawns a process), but proves the binary is functional.
 */
export async function findRscriptAsync(): Promise<{ path: string; version: string } | null> {
  for (const rPath of R_PATHS) {
    try {
      const { stdout, stderr } = await execFileAsync(rPath, ['--version'], {
        timeout: 5000,
      });
      // Rscript --version writes to stderr on some systems, stdout on others
      const versionOutput = (stdout || stderr).trim();
      return { path: rPath, version: versionOutput };
    } catch {
      // Binary not found or not executable at this path — try next
      continue;
    }
  }
  return null;
}
