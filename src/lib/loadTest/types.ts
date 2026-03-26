/**
 * Shared types for the load test feature.
 * Used by the upload script, API routes, and UI page.
 */

/**
 * Separator between namePrefix and dataset name in project names.
 * e.g. "Load Test 2/13 — my-dataset"
 */
export const LOAD_TEST_SEPARATOR = ' \u2014 '; // " — " (em-dash)

// ---------------------------------------------------------------------------
// R2 Manifest Types
// ---------------------------------------------------------------------------

export interface TestDatasetFile {
  filename: string;
  role: 'sav' | 'survey' | 'banner';
  r2Key: string;
  sizeBytes: number;
}

export interface TestDatasetEntry {
  name: string;
  files: TestDatasetFile[];
  ready: boolean;
  hasBanner: boolean;
}

export interface TestDatasetManifest {
  version: 1;
  generatedAt: string;
  datasets: TestDatasetEntry[];
}

// ---------------------------------------------------------------------------
// Launch Request / Response
// ---------------------------------------------------------------------------

export interface LoadTestLaunchRequest {
  datasets: string[];
  concurrency: 1 | 3 | 5 | 10 | 15;
  namePrefix: string;
  config?: {
    format?: 'standard' | 'stacked';
    displayMode?: 'frequency' | 'counts' | 'both';
    theme?: string;
  };
}

export interface LoadTestLaunchedProject {
  dataset: string;
  projectId: string;
  runId: string;
  projectName: string;
}

export interface LoadTestLaunchError {
  dataset: string;
  error: string;
}

export interface LoadTestLaunchResult {
  launched: LoadTestLaunchedProject[];
  errors: LoadTestLaunchError[];
  totalLaunched: number;
  totalErrors: number;
  rateLimitRejections: number;
}

// ---------------------------------------------------------------------------
// Cleanup Request / Response
// ---------------------------------------------------------------------------

export interface LoadTestCleanupRequest {
  namePrefix: string;
}

export interface LoadTestCleanupResult {
  projectsDeleted: number;
  projectNames: string[];
}
