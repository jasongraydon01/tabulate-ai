/**
 * History Utility
 *
 * Scans the outputs/ directory to discover previous pipeline runs.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { PipelineRun, HistoryArtifact } from '../state/types';

// =============================================================================
// Types
// =============================================================================

interface PipelineSummary {
  dataset: string;
  timestamp: string;
  duration: {
    ms: number;
    formatted: string;
  };
  outputs: {
    totalTablesInR?: number;
    validatedTables?: number;
    cuts?: number;
    tableCount?: number;
  };
  costs: {
    totals: {
      estimatedCostUsd: number;
    };
  };
}

// =============================================================================
// Discovery Functions
// =============================================================================

/**
 * Discover all datasets in the outputs directory
 */
export function discoverDatasets(outputsDir: string): string[] {
  const datasets: string[] = [];

  try {
    if (!fs.existsSync(outputsDir)) {
      return datasets;
    }

    const entries = fs.readdirSync(outputsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        datasets.push(entry.name);
      }
    }

    datasets.sort();
  } catch (error) {
    console.error('Failed to discover datasets:', error);
  }

  return datasets;
}

/**
 * Discover all pipeline runs for a dataset
 */
export function discoverRuns(outputsDir: string, dataset: string): PipelineRun[] {
  const runs: PipelineRun[] = [];
  const datasetDir = path.join(outputsDir, dataset);

  try {
    if (!fs.existsSync(datasetDir)) {
      return runs;
    }

    const entries = fs.readdirSync(datasetDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith('pipeline-')) {
        continue;
      }

      const runPath = path.join(datasetDir, entry.name);
      const summaryPath = path.join(runPath, 'pipeline-summary.json');

      // Extract timestamp from directory name: pipeline-2026-02-01T05-49-17-899Z
      const timestampMatch = entry.name.match(/^pipeline-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
      let timestamp: Date;

      if (timestampMatch) {
        // Convert format: 2026-02-01T05-49-17 -> 2026-02-01T05:49:17
        const isoString = timestampMatch[1].replace(/-(\d{2})-(\d{2})$/, ':$1:$2');
        timestamp = new Date(isoString);
      } else {
        // Fallback to directory mtime
        const stat = fs.statSync(runPath);
        timestamp = stat.mtime;
      }

      // Read summary if it exists
      let run: PipelineRun = {
        dataset,
        timestamp,
        path: runPath,
        durationMs: 0,
        costUsd: 0,
        tableCount: 0,
        status: 'completed',
      };

      if (fs.existsSync(summaryPath)) {
        try {
          const summary: PipelineSummary = JSON.parse(fs.readFileSync(summaryPath, 'utf-8'));
          run = {
            ...run,
            durationMs: summary.duration?.ms || 0,
            costUsd: summary.costs?.totals?.estimatedCostUsd || 0,
            tableCount: summary.outputs?.totalTablesInR || summary.outputs?.validatedTables || 0,
          };
        } catch {
          // Ignore parse errors
        }
      }

      // Check for failure indicators
      const resultsDir = path.join(runPath, 'results');
      if (!fs.existsSync(resultsDir) || !fs.existsSync(path.join(resultsDir, 'crosstabs.xlsx'))) {
        run.status = 'failed';
      }

      runs.push(run);
    }

    // Sort by timestamp, newest first
    runs.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  } catch (error) {
    console.error('Failed to discover runs:', error);
  }

  return runs;
}

/**
 * Discover artifacts in a pipeline run directory
 */
export function discoverArtifacts(runPath: string): HistoryArtifact[] {
  const artifacts: HistoryArtifact[] = [];

  // Artifact descriptions
  const ARTIFACT_DESCRIPTIONS: Record<string, string> = {
    'results': 'crosstabs.xlsx, tables.json',
    'verification': 'scratchpad (verified tables)',
    'basefilter': 'scratchpad (filtered tables)',
    'banner': 'scratchpad (banner groups)',
    'crosstab': 'scratchpad (cuts)',
    'r': 'master.R, execution.log',
    'validation': 'R validation output',
    'pipeline-summary.json': 'Run summary and costs',
    'feedback.md': 'User feedback notes',
  };

  try {
    if (!fs.existsSync(runPath)) {
      return artifacts;
    }

    const entries = fs.readdirSync(runPath, { withFileTypes: true });

    for (const entry of entries) {
      // Skip hidden files and system files
      if (entry.name.startsWith('.')) continue;

      const fullPath = path.join(runPath, entry.name);
      const isDirectory = entry.isDirectory();

      // Skip large datamap files
      if (entry.name.includes('datamap') && entry.name.endsWith('.json')) {
        continue;
      }

      artifacts.push({
        name: entry.name,
        path: fullPath,
        isDirectory,
        description: ARTIFACT_DESCRIPTIONS[entry.name] || (isDirectory ? 'Directory' : 'File'),
      });
    }

    // Sort: directories first, then by name
    artifacts.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) {
        return a.isDirectory ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error('Failed to discover artifacts:', error);
  }

  return artifacts;
}

/**
 * Read artifact content for viewing
 * Limits file size to prevent memory issues
 */
export function readArtifactContent(artifactPath: string): string {
  const MAX_SIZE = 100 * 1024; // 100KB limit

  try {
    const stat = fs.statSync(artifactPath);

    if (stat.isDirectory()) {
      // List directory contents
      const entries = fs.readdirSync(artifactPath);
      return `Directory contents:\n\n${entries.map(e => `  ${e}`).join('\n')}`;
    }

    if (stat.size > MAX_SIZE) {
      // Read first part of large file
      const fd = fs.openSync(artifactPath, 'r');
      const buffer = Buffer.alloc(MAX_SIZE);
      fs.readSync(fd, buffer, 0, MAX_SIZE, 0);
      fs.closeSync(fd);
      return buffer.toString('utf-8') + '\n\n[... file truncated, too large to display ...]';
    }

    return fs.readFileSync(artifactPath, 'utf-8');
  } catch (error) {
    return `Error reading file: ${error instanceof Error ? error.message : 'Unknown error'}`;
  }
}

/**
 * Get the most recent run for a dataset (for last run info)
 */
export function getMostRecentRun(outputsDir: string, dataset: string): PipelineRun | null {
  const runs = discoverRuns(outputsDir, dataset);
  return runs.length > 0 ? runs[0] : null;
}

/**
 * Format a pipeline run for display
 */
export function formatRunSummary(run: PipelineRun): string {
  const date = formatDate(run.timestamp);
  const duration = formatDuration(run.durationMs);
  const cost = formatCost(run.costUsd);
  const status = run.status === 'completed' ? '\u2713' : '\u2717';

  return `${date}   ${duration.padEnd(10)}   ${cost.padEnd(8)}   ${run.tableCount} tables  ${status} ${run.status}`;
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatDuration(ms: number): string {
  if (ms === 0) return '-';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return '-';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}
