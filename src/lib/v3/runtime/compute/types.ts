/**
 * V3 Runtime — Compute Chain Types (Stages 22 + 14)
 *
 * Types for the compute handoff pipeline that bridges the table/banner chains
 * into the R script generation layer.
 *
 * Stage 22: builds cutsSpec from crosstab plan, resolves stat config, assembles
 *           RScriptV2Input-compatible payload.
 * Stage 14: post-R validation QC hook (no artifact).
 */

import type { V3PipelineCheckpoint } from '../contracts';
import type { CutsSpec } from '@/lib/tables/CutsSpec';
import type { StatTestingConfig } from '@/lib/env';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import type { LoopSemanticsPolicy } from '@/schemas/loopSemanticsPolicySchema';
import type { CompiledLoopContract } from '@/schemas/compiledLoopContractSchema';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';
import type { RScriptV2Input } from '@/lib/r/RScriptGeneratorV2';

// =============================================================================
// Wizard Config Override Shape
// =============================================================================

/**
 * Stat testing overrides from the wizard UI.
 * Thresholds are confidence percentages (e.g., [95, 90]) — NOT raw p-values.
 * The resolveStatConfig function converts them to raw thresholds.
 */
export interface WizardStatTestingOverrides {
  thresholds: number[];
  minBase: number;
}

// =============================================================================
// Compute Chain Input
// =============================================================================

/**
 * Input for the compute chain pipeline (stages 22-14).
 *
 * Two input modes:
 *   1. Runtime mode: provide `crosstabPlan` and tables will be typed generically.
 *   2. Legacy mode: provide pre-built `cutsSpec` and `tables` as TableWithLoopFrame[].
 *
 * Both modes produce the same output shape.
 */
export interface ComputeChainInput {
  /** Canonical tables from stage 13d (or legacy pipeline). */
  tables: TableWithLoopFrame[];

  /** Crosstab plan from stage 21. Used to derive cutsSpec. */
  crosstabPlan: ValidationResultType;

  /**
   * Pre-resolved stat testing config. If not provided, resolveStatConfig()
   * is called with wizardStatTesting overrides (if any) or env defaults.
   */
  statTestingConfig?: StatTestingConfig;

  /** Wizard UI stat testing overrides (confidence percentages). */
  wizardStatTesting?: WizardStatTestingOverrides | null;

  /** Loop stacking mappings from LoopCollapser. */
  loopMappings?: LoopGroupMapping[];

  /** Per-banner-group loop semantics classification. */
  loopSemanticsPolicy?: LoopSemanticsPolicy;

  /** Compiled loop contract (preferred over raw loopSemanticsPolicy when present). */
  compiledLoopContract?: CompiledLoopContract;

  /** Loop stat testing mode override. */
  loopStatTestingMode?: 'suppress' | 'complement';

  /** Weight variable column name (e.g., "wt"). */
  weightVariable?: string;

  /** Demo mode: truncate data to first N respondents in R script. */
  maxRespondents?: number;

  // --- Pipeline context ---

  /** Output directory for artifact persistence. */
  outputDir: string;

  /** Pipeline run identifier. */
  pipelineId: string;

  /** Dataset name. */
  dataset: string;

  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal;

  /** Optional checkpoint to resume from. */
  checkpoint?: V3PipelineCheckpoint;
}

// =============================================================================
// Build Compute Package Types (Stage 22 Core)
// =============================================================================

/**
 * Input for the core buildComputePackage function.
 * Accepts pre-built cutsSpec for production call sites that need it earlier.
 */
export interface BuildComputePackageInput {
  /** Tables to include in the R script input. */
  tables: TableWithLoopFrame[];

  /** Pre-built CutsSpec (from buildCutsSpec). */
  cutsSpec: CutsSpec;

  /** Resolved stat testing config. */
  statTestingConfig: StatTestingConfig;

  /** Loop stacking mappings. */
  loopMappings?: LoopGroupMapping[];

  /** Per-banner-group loop semantics. */
  loopSemanticsPolicy?: LoopSemanticsPolicy;

  /** Compiled loop contract (preferred over raw loopSemanticsPolicy when present). */
  compiledLoopContract?: CompiledLoopContract;

  /** Loop stat testing mode. */
  loopStatTestingMode?: 'suppress' | 'complement';

  /** Weight variable column name. */
  weightVariable?: string;

  /** Demo mode: truncate data to first N respondents in R script. */
  maxRespondents?: number;
}

/**
 * Output from buildComputePackage — the assembled R script input payload
 * plus derived metadata.
 */
export interface ComputePackageOutput {
  /** Direct input shape for RScriptGeneratorV2. */
  rScriptInput: Pick<
    RScriptV2Input,
    | 'tables'
    | 'cuts'
    | 'cutGroups'
    | 'totalStatLetter'
    | 'statTestingConfig'
    | 'significanceThresholds'
    | 'loopMappings'
    | 'loopSemanticsPolicy'
    | 'compiledLoopContract'
    | 'loopStatTestingMode'
    | 'weightVariable'
    | 'maxRespondents'
  >;

  /** Derived CutsSpec (convenience — same as input.cutsSpec). */
  cutsSpec: CutsSpec;

  /** Route/provenance metadata for the compute handoff. */
  routeMetadata: ComputeRouteMetadata;
}

/**
 * Provenance metadata for the compute package.
 */
export interface ComputeRouteMetadata {
  generatedAt: string;
  tableCount: number;
  cutCount: number;
  cutGroupCount: number;
  totalStatLetter: string | null;
}

// =============================================================================
// Compute Chain Result
// =============================================================================

/**
 * Result from runComputePipeline — stage 22 output + checkpoint.
 */
export interface ComputeChainResult {
  /** Assembled R script input (stage 22 artifact). */
  rScriptInput: ComputePackageOutput['rScriptInput'];

  /** Derived CutsSpec. */
  cutsSpec: CutsSpec;

  /** Resolved stat testing config used. */
  statTestingConfig: StatTestingConfig;

  /** Route/provenance metadata. */
  routeMetadata: ComputeRouteMetadata;

  /** Updated pipeline checkpoint. */
  checkpoint: V3PipelineCheckpoint;
}

// =============================================================================
// Post-R QC Types (Stage 14)
// =============================================================================

/**
 * Input for the post-R QC validation hook (stage 14).
 * This stage validates the compute output but produces no chained artifact.
 */
export interface PostRQcInput {
  /** The compute package from stage 22. */
  rScriptInput: ComputePackageOutput['rScriptInput'];

  /** CutsSpec for validation. */
  cutsSpec: CutsSpec;

  /** Output directory (for writing validation report if needed). */
  outputDir: string;
}

/**
 * Result from the post-R QC hook.
 */
export interface PostRQcResult {
  /** Whether the compute output passed validation. */
  valid: boolean;

  /** Validation warnings (non-fatal). */
  warnings: string[];

  /** Validation errors (if valid is false). */
  errors: string[];
}
