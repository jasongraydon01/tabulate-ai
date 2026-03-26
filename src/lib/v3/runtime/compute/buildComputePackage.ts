/**
 * V3 Runtime — Compute Package Builder (Stage 22)
 *
 * Assembles a deterministic compute-ready payload from:
 *   - Canonical tables (from 13d canonical assembly or legacy pipeline)
 *   - Crosstab plan (from stage 21) — used to derive CutsSpec
 *   - Stat testing config (resolved via resolveStatConfig)
 *   - Optional loop/weight context
 *
 * This is the runtime equivalent of scripts/v3-enrichment/22-r-compute-input.ts.
 * It replaces duplicated R script input assembly in:
 *   - PipelineRunner.ts
 *   - pipelineOrchestrator.ts
 *   - reviewCompletion.ts
 *
 * Output is RScriptV2Input-compatible — ready to pass to
 * generateRScriptV2WithValidation().
 */

import { buildCutsSpec } from '@/lib/tables/CutsSpec';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { StatTestingConfig } from '@/lib/env';
import type {
  BuildComputePackageInput,
  ComputePackageOutput,
  ComputeRouteMetadata,
} from './types';

/**
 * Build a compute package from a pre-built CutsSpec and resolved stat config.
 *
 * This is the core assembly function used by both the V3 runtime orchestrator
 * and production pipeline call sites. Production call sites that need cutsSpec
 * earlier (for R validation, loop semantics) should call buildCutsSpec()
 * separately, then pass the result here.
 *
 * @param input Pre-built cutsSpec, tables, stat config, and optional loop/weight info.
 * @returns ComputePackageOutput with rScriptInput, cutsSpec, and routeMetadata.
 */
export function buildComputePackage(input: BuildComputePackageInput): ComputePackageOutput {
  const { cutsSpec, tables, statTestingConfig } = input;

  const rScriptInput: ComputePackageOutput['rScriptInput'] = {
    tables,
    cuts: cutsSpec.cuts,
    cutGroups: cutsSpec.groups,
    totalStatLetter: cutsSpec.totalCut?.statLetter ?? 'T',
    statTestingConfig,
    significanceThresholds: statTestingConfig.thresholds,
    ...(input.loopMappings && input.loopMappings.length > 0 && { loopMappings: input.loopMappings }),
    ...(input.loopSemanticsPolicy && { loopSemanticsPolicy: input.loopSemanticsPolicy }),
    ...(input.compiledLoopContract && { compiledLoopContract: input.compiledLoopContract }),
    ...(input.loopStatTestingMode && { loopStatTestingMode: input.loopStatTestingMode }),
    ...(input.weightVariable && { weightVariable: input.weightVariable }),
    ...(input.maxRespondents && { maxRespondents: input.maxRespondents }),
  };

  const routeMetadata: ComputeRouteMetadata = {
    generatedAt: new Date().toISOString(),
    tableCount: tables.length,
    cutCount: cutsSpec.cuts.length,
    cutGroupCount: cutsSpec.groups.length,
    totalStatLetter: cutsSpec.totalCut?.statLetter ?? null,
  };

  return {
    rScriptInput,
    cutsSpec,
    routeMetadata,
  };
}

/**
 * Build a compute package from a crosstab plan (derives cutsSpec internally).
 *
 * Convenience wrapper for the V3 runtime orchestrator which receives the
 * crosstab plan directly from stage 21. Production call sites that need
 * cutsSpec earlier should use buildComputePackage() directly.
 *
 * @param crosstabPlan Validated crosstab plan from stage 21.
 * @param tables Canonical tables from stage 13d (or legacy pipeline).
 * @param statTestingConfig Resolved stat testing config.
 * @param options Optional loop/weight context.
 * @returns ComputePackageOutput with rScriptInput, cutsSpec, and routeMetadata.
 */
export function buildComputePackageFromPlan(
  crosstabPlan: ValidationResultType,
  tables: BuildComputePackageInput['tables'],
  statTestingConfig: StatTestingConfig,
  options?: {
    loopMappings?: BuildComputePackageInput['loopMappings'];
    loopSemanticsPolicy?: BuildComputePackageInput['loopSemanticsPolicy'];
    compiledLoopContract?: BuildComputePackageInput['compiledLoopContract'];
    loopStatTestingMode?: BuildComputePackageInput['loopStatTestingMode'];
    weightVariable?: BuildComputePackageInput['weightVariable'];
  },
): ComputePackageOutput {
  const cutsSpec = buildCutsSpec(crosstabPlan);
  return buildComputePackage({
    tables,
    cutsSpec,
    statTestingConfig,
    ...options,
  });
}
