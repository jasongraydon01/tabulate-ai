/**
 * V3 Pipeline Summary Builder
 *
 * Builds a pipeline-summary.json from V3 pipeline results.
 * Replaces the legacy summary builder that referenced many legacy variables.
 */

import type { V3PipelineResult } from './runV3Pipeline';
import type { PostV3ProcessingResult } from './postV3Processing';
import type { StatTestingConfig } from '@/lib/env';
import { getPromptVersions } from '@/lib/env';
import { getMetricsCollector, getPipelineCostSummary } from '@/lib/observability';
import { readPipelineErrors, summarizePipelineErrors } from '@/lib/errors/ErrorPersistence';
import type { DatasetFiles } from '@/lib/pipeline/types';

// =============================================================================
// Types
// =============================================================================

export interface PipelineSummaryInput {
  /** V3 pipeline result */
  v3Result: V3PipelineResult;
  /** Post-V3 processing result */
  postResult: PostV3ProcessingResult;
  /** Dataset files found */
  files: DatasetFiles;
  /** Total pipeline duration in ms */
  totalDurationMs: number;
  /** Output directory */
  outputDir: string;
  /** Pipeline ID */
  pipelineId: string;
  /** Stat testing config used */
  statTestingConfig: StatTestingConfig;
  /** Stage timing accumulator from setup phase */
  setupStageTiming?: Record<string, number>;
  /** Weight detection result */
  weightDetection?: {
    bestCandidate?: { column: string; score: number; mean: number } | null;
  };
}

export interface PipelineSummary {
  dataset: string;
  timestamp: string;
  duration: { ms: number; formatted: string };
  promptVersions: Record<string, string>;
  stageTiming: Record<string, number>;
  statTesting: {
    thresholds: number[];
    confidenceLevels: number[];
    proportionTest: string;
    meanTest: string;
    minBase: number;
    dualThresholdMode: boolean;
  };
  inputs: {
    datamap: string | null;
    banner: string | null;
    spss: string;
    survey: string | null;
  };
  weighting: {
    weightVariable: string | null;
    detected: string | null;
    detectedScore: number | null;
  };
  outputs: {
    variables: number;
    canonicalTables: number;
    totalTablesInR: number;
    cuts: number;
    bannerGroups: number;
  };
  v3Pipeline: {
    completedStages: string[];
    lastCompletedStage: string | null;
    questionIdEntries: number;
    canonicalTables: number;
    bannerGroups: number;
    computeCuts: number;
  };
  rExecution: {
    success: boolean;
    durationMs: number;
    scriptSizeBytes: number;
    outputTableCount: number | null;
    error?: string;
  };
  excelExport: {
    success: boolean;
    durationMs: number;
    error?: string;
  };
  costs: {
    byAgent: unknown[];
    totals: unknown;
  };
  errors: Record<string, unknown>;
}

// =============================================================================
// Builder
// =============================================================================

/**
 * Build a V3-native pipeline summary.
 */
export async function buildPipelineSummary(
  input: PipelineSummaryInput,
): Promise<PipelineSummary> {
  const {
    v3Result,
    postResult,
    files,
    totalDurationMs,
    outputDir,
    statTestingConfig,
    setupStageTiming = {},
    weightDetection,
  } = input;

  const promptVersions = getPromptVersions();
  const costMetrics = await getMetricsCollector().getSummary();

  // Error persistence summary
  const errorRead = await readPipelineErrors(outputDir);
  const errorSummary = summarizePipelineErrors(errorRead.records);

  // Build stage timing from V3 checkpoint + setup timing
  const stageTiming: Record<string, number> = { ...setupStageTiming };
  for (const stage of v3Result.checkpoint.completedStages) {
    stageTiming[`v3_stage_${stage.completedStage}`] = stage.durationMs;
  }
  stageTiming['rExecution'] = postResult.rDurationMs;
  stageTiming['excelExport'] = postResult.excelDurationMs;

  const crosstabPlan = v3Result.planning.crosstabPlan.crosstabPlan;
  const bannerGroupCount = crosstabPlan.bannerCuts?.length ?? 0;

  return {
    dataset: files.name,
    timestamp: new Date().toISOString(),
    duration: {
      ms: totalDurationMs,
      formatted: `${(totalDurationMs / 1000).toFixed(1)}s`,
    },
    promptVersions: {
      banner: promptVersions.bannerPromptVersion,
      bannerGenerate: promptVersions.bannerGeneratePromptVersion,
      crosstab: promptVersions.crosstabPromptVersion,
      verification: promptVersions.verificationPromptVersion,
      skipLogic: promptVersions.skipLogicPromptVersion,
      filterTranslator: promptVersions.filterTranslatorPromptVersion,
      loopSemantics: promptVersions.loopSemanticsPromptVersion,
    },
    stageTiming,
    statTesting: {
      thresholds: statTestingConfig.thresholds,
      confidenceLevels: statTestingConfig.thresholds.map(t => Math.round((1 - t) * 100)),
      proportionTest: statTestingConfig.proportionTest,
      meanTest: statTestingConfig.meanTest,
      minBase: statTestingConfig.minBase,
      dualThresholdMode:
        statTestingConfig.thresholds.length >= 2 &&
        statTestingConfig.thresholds[0] !== statTestingConfig.thresholds[1],
    },
    inputs: {
      datamap: files.datamap ? files.datamap.split('/').pop()! : null,
      banner: files.banner ? files.banner.split('/').pop()! : '(AI-generated)',
      spss: files.spss.split('/').pop()!,
      survey: files.survey ? files.survey.split('/').pop()! : null,
    },
    weighting: {
      weightVariable: postResult.weightVariable || null,
      detected: weightDetection?.bestCandidate?.column || null,
      detectedScore: weightDetection?.bestCandidate?.score || null,
    },
    outputs: {
      variables: v3Result.questionId.entries.length,
      canonicalTables: v3Result.canonical.tables.length,
      totalTablesInR: v3Result.compute.rScriptInput.tables.length,
      cuts: v3Result.compute.rScriptInput.cuts.length,
      bannerGroups: bannerGroupCount,
    },
    v3Pipeline: {
      completedStages: v3Result.checkpoint.completedStages.map(s => s.completedStage),
      lastCompletedStage: v3Result.checkpoint.lastCompletedStage,
      questionIdEntries: v3Result.questionId.entries.length,
      canonicalTables: v3Result.canonical.tables.length,
      bannerGroups: bannerGroupCount,
      computeCuts: v3Result.compute.rScriptInput.cuts.length,
    },
    rExecution: {
      success: postResult.rSuccess,
      durationMs: postResult.rDurationMs,
      scriptSizeBytes: postResult.rScriptSizeBytes,
      outputTableCount: postResult.rOutputTableCount ?? null,
      ...(postResult.rError ? { error: postResult.rError } : {}),
    },
    excelExport: {
      success: postResult.excelSuccess,
      durationMs: postResult.excelDurationMs,
      ...(postResult.excelError ? { error: postResult.excelError } : {}),
    },
    costs: {
      byAgent: costMetrics.byAgent,
      totals: costMetrics.totals,
    },
    errors: {
      ...errorSummary,
      invalidLines: errorRead.invalidLines.length,
    },
  };
}

/**
 * Get cost summary string for logging.
 */
export async function getCostSummaryString(): Promise<string> {
  return getPipelineCostSummary();
}
