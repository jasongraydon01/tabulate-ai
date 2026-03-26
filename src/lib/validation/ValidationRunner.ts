/**
 * ValidationRunner.ts
 *
 * @deprecated V3 Migration: This module is not used in the V3 runtime path.
 * The V3 pipeline uses RDataReader directly (via step 00) for .sav metadata
 * extraction, bypassing the ValidationRunner's orchestration overhead.
 * Remains in use by the legacy production pipeline on `main`.
 * See: docs/v3-runtime-architecture-refactor-plan.md
 *
 * Orchestrates 3 validation stages that run before the pipeline.
 * The .sav file is the single source of truth — no CSV datamaps needed.
 *
 * Stages:
 * 1. Read .sav - R+Haven: extract all column metadata, detect stacking
 * 2. Enrich - Convert to RawDataMapVariable[], parent inference, context, type normalization
 * 3. Loop Detection - Detect loops, check fill rates
 */

import { constants as fsConstants } from 'fs';
import fs from 'fs/promises';
import path from 'path';
import { detectLoops } from './LoopDetector';
import { checkRAvailability, getDataFileStats, getColumnFillRates, convertToRawVariables } from './RDataReader';
import { classifyLoopFillRates } from './FillRateValidator';
import { detectWeightCandidates } from './WeightDetector';
import { DataMapProcessor } from '../processors/DataMapProcessor';
import { getPipelineEventBus } from '../events';
import type { ProcessingResult } from '../processors/DataMapProcessor';
import type {
  ValidationReport,
  ValidationError,
  ValidationWarning,
  LoopDetectionResult,
  DataFileStats,
  LoopFillRateResult,
  WeightDetectionResult,
  DataMapFormat,
} from './types';

// =============================================================================
// Stage Names
// =============================================================================

const STAGE_NAMES: Record<number, string> = {
  1: 'Read Data File',
  2: 'Enrich Variables',
  3: 'Loop Detection',
  4: 'Weight Detection',
};

// =============================================================================
// ValidationRunner
// =============================================================================

export interface ValidationRunnerOptions {
  spssPath: string;   // Required — .sav is the source of truth
  outputDir: string;
  /** Skip loop detection — V3 handles loops in enrichment chain (stages 00/10a) */
  skipLoopDetection?: boolean;
  /** Optional row cap for demo mode. */
  maxRows?: number;
}

export async function validate(options: ValidationRunnerOptions): Promise<ValidationReport> {
  const startTime = Date.now();
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];
  const eventBus = getPipelineEventBus();

  const format: DataMapFormat = 'sav';
  let processingResult: ProcessingResult | null = null;
  let loopDetection: LoopDetectionResult | null = null;
  let dataFileStats: DataFileStats | null = null;
  const fillRateResults: LoopFillRateResult[] = [];
  let weightDetection: WeightDetectionResult | null = null;

  // =========================================================================
  // Stage 1: Read Data File (.sav via R + haven)
  // Truly unrecoverable errors (corrupted files, unsupported formats) are
  // caught here in the first 30 seconds, not 40 minutes into a run.
  // =========================================================================
  const stage1Start = Date.now();
  eventBus.emitValidationStageStart(1, STAGE_NAMES[1]);

  // Pre-flight: verify .sav exists, is readable, and has content (fail fast)
  try {
    await fs.access(options.spssPath, fsConstants.R_OK);
    const stat = await fs.stat(options.spssPath);
    if (stat.size === 0) {
      throw new Error('File is empty');
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : '';
    const isNotFound = code === 'ENOENT' || msg.includes('ENOENT') || msg.includes('no such file');
    const isEmpty = msg.includes('empty');
    errors.push({
      stage: 1,
      stageName: STAGE_NAMES[1],
      severity: 'error',
      message: isNotFound
        ? 'Data file not found or not readable'
        : isEmpty
          ? 'Data file is empty'
          : `Cannot read data file: ${msg}`,
      details: 'Ensure the .sav file exists, is readable, and contains valid SPSS data.',
    });
    eventBus.emitValidationStageComplete(1, STAGE_NAMES[1], Date.now() - stage1Start);
    eventBus.emitValidationComplete(false, format, errors.length, warnings.length, Date.now() - startTime);
    return buildReport(false, format, errors, warnings, null, null, null, [], null, startTime);
  }

  // R is a hard gate — no fallback
  const rAvailable = await checkRAvailability(options.outputDir);

  if (!rAvailable) {
    errors.push({
      stage: 1,
      stageName: STAGE_NAMES[1],
      severity: 'error',
      message: 'R is not available — cannot read .sav data file',
      details: 'Install R and the haven package: install.packages("haven")',
    });
    eventBus.emitValidationStageComplete(1, STAGE_NAMES[1], Date.now() - stage1Start);
    eventBus.emitValidationComplete(false, format, errors.length, warnings.length, Date.now() - startTime);
    return buildReport(false, format, errors, warnings, null, null, null, [], null, startTime);
  }

  try {
    dataFileStats = await getDataFileStats(options.spssPath, options.outputDir, {
      maxRows: options.maxRows,
    });
    console.log(`[Validation] Data file: ${dataFileStats.rowCount} rows, ${dataFileStats.columns.length} columns`);

    // Check for stacking indicator columns
    if (dataFileStats.stackingColumns.length > 0) {
      warnings.push({
        stage: 1,
        stageName: STAGE_NAMES[1],
        message: `Found stacking indicator columns: ${dataFileStats.stackingColumns.join(', ')}`,
        details: 'Data may be stacked. Pipeline expects wide format.',
      });
      eventBus.emitValidationWarning(
        1,
        `Stacking columns found: ${dataFileStats.stackingColumns.join(', ')}`
      );
    }
  } catch (err) {
    const rErr = err instanceof Error ? err.message : String(err);
    errors.push({
      stage: 1,
      stageName: STAGE_NAMES[1],
      severity: 'error',
      message: rErr.includes('R script failed') || rErr.toLowerCase().includes('parse') || rErr.toLowerCase().includes('format')
        ? `Data file appears corrupted or in an unsupported format: ${rErr}`
        : `Failed to read data file: ${rErr}`,
      details: 'Ensure the file is a valid SPSS .sav format. Corrupted or renamed files (e.g. .dta, .csv) will fail here.',
    });
    eventBus.emitValidationStageComplete(1, STAGE_NAMES[1], Date.now() - stage1Start);
    eventBus.emitValidationComplete(false, format, errors.length, warnings.length, Date.now() - startTime);
    return buildReport(false, format, errors, warnings, null, null, null, [], null, startTime);
  }

  eventBus.emitValidationStageComplete(1, STAGE_NAMES[1], Date.now() - stage1Start);

  // =========================================================================
  // Stage 2: Enrich Variables
  // =========================================================================
  const stage2Start = Date.now();
  eventBus.emitValidationStageStart(2, STAGE_NAMES[2]);

  try {
    // Convert .sav metadata → RawDataMapVariable[]
    const rawVariables = convertToRawVariables(dataFileStats);
    console.log(`[Validation] Converted ${rawVariables.length} variables from .sav`);

    // Enrich: parent inference → parent context → type normalization
    const processor = new DataMapProcessor();
    const enriched = processor.enrichVariables(rawVariables);

    const surveyVarCount = enriched.verbose.filter(
      (v) =>
        v.column !== 'record' &&
        v.column !== 'uuid' &&
        v.column !== 'date' &&
        v.column !== 'status'
    ).length;

    if (surveyVarCount === 0) {
      errors.push({
        stage: 2,
        stageName: STAGE_NAMES[2],
        severity: 'error',
        message: 'No survey variables found in data file',
      });
    } else {
      console.log(`[Validation] Enriched ${enriched.verbose.length} variables (${surveyVarCount} survey vars)`);
    }

    processingResult = {
      success: true,
      verbose: enriched.verbose,
      agent: enriched.agent,
      validationPassed: true,
      confidence: 1.0,
      errors: [],
      warnings: [],
    };

    // Save development outputs (verbose, crosstab-agent, table-agent JSONs)
    const savFilename = path.basename(options.spssPath, '.sav');
    await processor.saveDevelopmentOutputs(enriched, savFilename, options.outputDir);
  } catch (err) {
    errors.push({
      stage: 2,
      stageName: STAGE_NAMES[2],
      severity: 'error',
      message: `Variable enrichment failed: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  eventBus.emitValidationStageComplete(2, STAGE_NAMES[2], Date.now() - stage2Start);

  // If Stage 2 has blocking errors, stop
  if (errors.some((e) => e.stage === 2 && e.severity === 'error')) {
    eventBus.emitValidationComplete(false, format, errors.length, warnings.length, Date.now() - startTime);
    return buildReport(false, format, errors, warnings, processingResult, null, null, [], null, startTime);
  }

  // =========================================================================
  // Stage 3: Loop Detection (skipped when V3 handles loops)
  // =========================================================================
  const stage3Start = Date.now();
  eventBus.emitValidationStageStart(3, STAGE_NAMES[3]);

  if (options.skipLoopDetection) {
    console.log('[Validation] Loop detection skipped (V3 handles loops in enrichment chain)');
    eventBus.emitValidationStageComplete(3, STAGE_NAMES[3], 0);
  } else if (processingResult) {
    const variableNames = processingResult.verbose.map((v) => v.column);
    loopDetection = detectLoops(variableNames);

    if (loopDetection.hasLoops) {
      console.log(`[Validation] Detected ${loopDetection.loops.length} loop group(s)`);

      for (const loop of loopDetection.loops) {
        console.log(`  Loop: ${loop.skeleton}, ${loop.iterations.length} iterations, ${loop.diversity} unique bases`);

        warnings.push({
          stage: 3,
          stageName: STAGE_NAMES[3],
          message: `Loop detected: ${loop.iterations.length} iterations of ${loop.diversity} questions (pattern: ${loop.skeleton})`,
        });
        eventBus.emitValidationWarning(
          3,
          `Loop: ${loop.iterations.length} iterations x ${loop.diversity} questions`
        );
      }

      // Check fill rates
      try {
        for (const loop of loopDetection.loops) {
          const fillRates = await getColumnFillRates(
            options.spssPath,
            loop.variables,
            options.outputDir
          );
          const fillResult = classifyLoopFillRates(loop, fillRates);
          fillRateResults.push(fillResult);

          console.log(`  Fill pattern (${loop.skeleton}): ${fillResult.pattern} — ${fillResult.explanation}`);

          if (fillResult.pattern === 'likely_stacked') {
            warnings.push({
              stage: 3,
              stageName: STAGE_NAMES[3],
              message: `Loop data appears stacked: ${fillResult.explanation}`,
              details: 'Pipeline expects wide format. You may need to restructure the data.',
            });
            eventBus.emitValidationWarning(3, `Stacked data detected: ${fillResult.explanation}`);
          } else if (fillResult.pattern === 'fixed_grid') {
            // Replace the generic "Loop detected" warning with a more specific one
            const loopWarningIdx = warnings.findIndex(
              (w) => w.stage === 3 && w.message.includes(loop.skeleton)
            );
            const gridMessage = `Fixed grid detected (not stacking): ${loop.iterations.length} iterations of ${loop.diversity} questions (pattern: ${loop.skeleton})`;
            if (loopWarningIdx >= 0) {
              warnings[loopWarningIdx] = {
                stage: 3,
                stageName: STAGE_NAMES[3],
                message: gridMessage,
              };
            } else {
              warnings.push({
                stage: 3,
                stageName: STAGE_NAMES[3],
                message: gridMessage,
              });
            }
            eventBus.emitValidationWarning(3, gridMessage);
          }
        }
      } catch (err) {
        warnings.push({
          stage: 3,
          stageName: STAGE_NAMES[3],
          message: `Fill rate analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    } else {
      console.log('[Validation] No loop patterns detected');
    }
  }

  eventBus.emitValidationStageComplete(3, STAGE_NAMES[3], Date.now() - stage3Start);

  // =========================================================================
  // Stage 4: Weight Detection
  // =========================================================================
  const stage4Start = Date.now();
  eventBus.emitValidationStageStart(4, STAGE_NAMES[4]);

  if (dataFileStats) {
    weightDetection = detectWeightCandidates(dataFileStats);

    if (weightDetection.bestCandidate) {
      const best = weightDetection.bestCandidate;
      console.log(`[Validation] Weight candidate detected: "${best.column}" (score: ${best.score.toFixed(2)}, mean: ${best.mean.toFixed(3)})`);
      for (const signal of best.signals) {
        console.log(`  - ${signal}`);
      }

      warnings.push({
        stage: 4,
        stageName: STAGE_NAMES[4],
        message: `Weight variable candidate: "${best.column}" (score: ${best.score.toFixed(2)}, mean: ${best.mean.toFixed(3)})`,
        details: `Use --weight=${best.column} to apply weighting. Use --no-weight to suppress this warning.`,
      });
      eventBus.emitValidationWarning(
        4,
        `Weight candidate: ${best.column} (score: ${best.score.toFixed(2)})`
      );
    } else {
      console.log('[Validation] No weight variable candidates detected');
    }
  }

  eventBus.emitValidationStageComplete(4, STAGE_NAMES[4], Date.now() - stage4Start);

  // =========================================================================
  // Final Report
  // =========================================================================
  const hasBlockingErrors = errors.some((e) => e.severity === 'error');
  const canProceed = !hasBlockingErrors;

  eventBus.emitValidationComplete(canProceed, format, errors.length, warnings.length, Date.now() - startTime);

  return buildReport(
    canProceed,
    format,
    errors,
    warnings,
    processingResult,
    loopDetection,
    dataFileStats,
    fillRateResults,
    weightDetection,
    startTime
  );
}

// =============================================================================
// Helpers
// =============================================================================

function buildReport(
  canProceed: boolean,
  format: DataMapFormat,
  errors: ValidationError[],
  warnings: ValidationWarning[],
  processingResult: ProcessingResult | null,
  loopDetection: LoopDetectionResult | null,
  dataFileStats: DataFileStats | null,
  fillRateResults: LoopFillRateResult[],
  weightDetection: WeightDetectionResult | null,
  startTime: number
): ValidationReport {
  return {
    canProceed,
    format,
    errors,
    warnings,
    processingResult,
    loopDetection,
    dataFileStats,
    fillRateResults,
    weightDetection,
    durationMs: Date.now() - startTime,
  };
}
