/**
 * Pipeline Types
 *
 * Shared type definitions for the pipeline runner.
 */

import type { ExcelFormat, DisplayMode } from '../excel/ExcelFormatter';
import type { StatTestingConfig } from '../env';
import type { RegroupConfigOverride } from '../tables/regroupConfig';
import type { MaxDiffPolicy } from '../maxdiff/policy';

// =============================================================================
// File Discovery
// =============================================================================

export interface DatasetFiles {
  datamap: string | null;  // Optional — .sav is the source of truth
  banner: string | null;   // Optional — AI generates banner cuts when missing
  spss: string;
  survey: string | null;  // Optional - needed for VerificationAgent
  name: string;
}

// =============================================================================
// Pipeline Options
// =============================================================================

export interface PipelineOptions {
  /** Excel output format */
  format: ExcelFormat;
  /** Display mode (frequency, counts, both) */
  displayMode: DisplayMode;
  /** When displayMode='both', output two separate .xlsx files instead of two sheets in one */
  separateWorkbooks: boolean;
  /** Stop after VerificationAgent (skip R/Excel) */
  stopAfterVerification: boolean;
  /** Stop after TableEnhancer output (pre-VerificationAgent) */
  stopAfterEnhancer: boolean;
  /** Concurrency level for parallel agents */
  concurrency: number;
  /** Excel color theme */
  theme: string;
  /** Suppress console output (for UI mode) */
  quiet: boolean;
  /** Statistical testing configuration (overrides env defaults) */
  statTesting?: Partial<StatTestingConfig>;
  /** Research objectives for AI-generated banner (when no banner document) */
  researchObjectives?: string;
  /** Suggested cuts for AI-generated banner (treated as near-requirements) */
  cutSuggestions?: string;
  /** Project type hint for AI-generated banner */
  projectType?: 'atu' | 'segmentation' | 'demand' | 'concept_test' | 'tracking' | 'general';
  /** Weight variable column name (e.g., "wt") — enables weighted output */
  weightVariable?: string;
  /** Suppress weight detection warnings */
  noWeight?: boolean;
  /** Override loop stat testing mode for entity-anchored groups */
  loopStatTestingMode?: 'suppress' | 'complement';
  /** External abort signal (caller can cancel the pipeline) */
  abortSignal?: AbortSignal;
  /** Pipeline-level timeout in ms. Default: 5_400_000 (90 min). 0 = no timeout. */
  timeoutMs?: number;
  /** Run-level regrouping override (highest precedence) */
  regrouping?: RegroupConfigOverride;
  /** Project sub-type (e.g., 'maxdiff') — enables conditional pipeline behavior */
  projectSubType?: 'standard' | 'segmentation' | 'maxdiff';
  /** MaxDiff policy override (family-level controls, split caps, placeholder behavior) */
  maxdiffPolicy?: Partial<MaxDiffPolicy>;
  /** Path to uploaded message list file (MaxDiff only) */
  messageListPath?: string;
}

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  format: 'standard',
  displayMode: 'frequency',
  separateWorkbooks: false,
  stopAfterVerification: false,
  stopAfterEnhancer: false,
  concurrency: 3,
  theme: 'classic',
  quiet: false,
};

// =============================================================================
// Pipeline Results
// =============================================================================

export interface PipelineResult {
  success: boolean;
  status?: 'success' | 'partial' | 'error' | 'cancelled';
  dataset: string;
  outputDir: string;
  durationMs: number;
  tableCount: number;
  totalCostUsd: number;
  error?: string;
  exportErrors?: Array<{
    format: 'shared' | 'q' | 'wincross';
    stage: string;
    message: string;
    retryable: boolean;
    timestamp: string;
  }>;
}
