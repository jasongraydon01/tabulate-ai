/**
 * V3 Runtime — Centralized Stat Testing Config Resolution
 *
 * Resolves statistical testing configuration from multiple input sources
 * into a single canonical StatTestingConfig. Priority order:
 *
 *   1. Explicit StatTestingConfig (already resolved — pass through)
 *   2. Wizard UI overrides (confidence percentages → raw thresholds)
 *   3. CLI overrides (partial StatTestingConfig fields)
 *   4. Environment defaults (STAT_THRESHOLDS, STAT_PROPORTION_TEST, etc.)
 *
 * This replaces duplicated inline transforms in:
 *   - PipelineRunner.ts (CLI overrides → effectiveStatConfig)
 *   - pipelineOrchestrator.ts (wizardConfig.statTesting → inline StatTestingConfig)
 *   - reviewCompletion.ts (wizardConfig.statTesting → inline StatTestingConfig)
 */

import { getStatTestingConfig, type StatTestingConfig } from '@/lib/env';
import type { WizardStatTestingOverrides } from './types';

/**
 * CLI-level stat testing overrides. Same shape as StatTestingConfig but all
 * fields are optional — missing fields fall through to env defaults.
 */
export interface CliStatTestingOverrides {
  thresholds?: number[];
  proportionTest?: 'unpooled_z' | 'pooled_z';
  meanTest?: 'welch_t' | 'student_t';
  minBase?: number;
}

/**
 * Resolve stat testing configuration from available override sources.
 *
 * @param options.explicit   — Already-resolved config (highest priority, pass-through).
 * @param options.wizard     — Wizard UI overrides (thresholds as confidence %, e.g., [95, 90]).
 * @param options.cli        — CLI overrides (partial StatTestingConfig fields).
 *
 * If no overrides are provided, falls back to environment defaults.
 */
export function resolveStatConfig(options?: {
  explicit?: StatTestingConfig;
  wizard?: WizardStatTestingOverrides | null;
  cli?: CliStatTestingOverrides | null;
}): StatTestingConfig {
  // Priority 1: explicit pre-resolved config
  if (options?.explicit) {
    return options.explicit;
  }

  // Priority 2: wizard UI overrides (convert confidence % → raw p-value thresholds)
  if (options?.wizard) {
    return {
      thresholds: options.wizard.thresholds.map(t => (100 - t) / 100),
      proportionTest: 'unpooled_z',
      meanTest: 'welch_t',
      minBase: options.wizard.minBase,
    };
  }

  // Priority 3: CLI overrides (merge with env defaults)
  const envConfig = getStatTestingConfig();
  if (options?.cli) {
    return {
      thresholds: options.cli.thresholds ?? envConfig.thresholds,
      proportionTest: options.cli.proportionTest ?? envConfig.proportionTest,
      meanTest: options.cli.meanTest ?? envConfig.meanTest,
      minBase: options.cli.minBase ?? envConfig.minBase,
    };
  }

  // Priority 4: env defaults
  return envConfig;
}
