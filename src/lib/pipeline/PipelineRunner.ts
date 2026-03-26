/**
 * Pipeline Runner
 *
 * Core pipeline execution logic shared between CLI and test scripts.
 *
 * Phase 6: V3 is the ONLY execution path. Legacy agents (BannerAgent,
 * CrosstabAgent, VerificationAgent, TableGenerator, etc.) are no longer
 * imported or called. The pipeline flow is:
 *
 *   Setup → runV3Pipeline() → postV3Processing() → Summary
 */

import fs from 'fs/promises';
import path from 'path';

// Shared V3 runtime
import { runV3Pipeline } from '../v3/runtime/runV3Pipeline';
import type { V3PipelineResult } from '../v3/runtime/runV3Pipeline';
import { runPostV3Processing } from '../v3/runtime/postV3Processing';
import { buildPipelineSummary, getCostSummaryString } from '../v3/runtime/buildPipelineSummary';
import { buildDecisionsSummary, buildPipelineDecisions } from '../v3/runtime/pipelineDecisions';
import { writeTableReport } from '../v3/runtime/tableReport';
import { resolveStatConfig } from '@/lib/v3/runtime/compute/resolveStatConfig';
import {
  buildExportArtifactRefs,
  buildPhase1Manifest,
  ensureWideSavFallback,
  generateLocalQAndWinCrossExports,
  persistPhase0Artifacts,
} from '@/lib/exportData';

// Validation (loop detection is now handled by V3 enrichment chain stages 00/10a)
import { validate as runValidation } from '../validation/ValidationRunner';

// MaxDiff
import { detectMaxDiffFamilies } from '../maxdiff/detectMaxDiffFamilies';
import { resolveAndParseMaxDiffMessages } from '../maxdiff/resolveMaxDiffMessages';
import { enrichDataMapWithMessages } from '../maxdiff/enrichDataMapWithMessages';
import { MaxDiffWarnings } from '../maxdiff/warnings';

// Pipeline infrastructure
import { CircuitBreaker, setActiveCircuitBreaker } from '../CircuitBreaker';
import { findDatasetFiles, loadDatasetIntakeConfig, DEFAULT_DATASET } from './FileDiscovery';
import type { PipelineOptions, PipelineResult, DatasetFiles } from './types';
import { DEFAULT_PIPELINE_OPTIONS } from './types';
import type { VerboseDataMapType } from '../../schemas/processingSchemas';
import { runWithPipelineContext } from './PipelineContext';
import {
  createPipelineCheckpoint,
  V3_CHECKPOINT_FILENAME,
} from '../v3/runtime/contracts';
import { V3_STAGE_NAMES, isV3StageId } from '../v3/runtime/stageOrder';

// Observability & errors
import {
  formatStatTestingConfig,
} from '../env';
import type { StatTestingConfig } from '../env';
import {
  resetMetricsCollector,
  getMetricsCollector,
  WideEvent,
  startPipelineTransaction,
} from '../observability';
import { getPipelineEventBus, STAGE_NAMES } from '../events';
import {
  readPipelineErrors,
  persistSystemError,
} from '../errors/ErrorPersistence';

// =============================================================================
// Logger
// =============================================================================

interface Logger {
  log: (message: string, color?: string) => void;
  logStep: (step: number, total: number, message: string) => void;
}

const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function getFirstRelevantStackFrame(error: unknown): string {
  const stack = error instanceof Error ? error.stack ?? '' : '';
  return stack
    .split('\n')
    .map(line => line.trim())
    .find(line => line.includes('/src/'))
    ?? '';
}

function inferFailureStage(error: unknown): { stageNumber: number; stageName: string } {
  const stack = error instanceof Error ? error.stack ?? '' : '';

  if (stack.includes('/src/lib/v3/runtime/postV3Processing.ts')) {
    return { stageNumber: 3, stageName: 'Post-V3 Processing' };
  }
  if (stack.includes('/src/lib/v3/runtime/canonical/')) {
    return { stageNumber: 2, stageName: 'V3 Canonical Pipeline' };
  }
  if (stack.includes('/src/lib/v3/runtime/planning/')) {
    return { stageNumber: 2, stageName: 'V3 Planning Pipeline' };
  }
  if (stack.includes('/src/lib/v3/runtime/compute/')) {
    return { stageNumber: 2, stageName: 'V3 Compute Pipeline' };
  }
  if (stack.includes('/src/lib/v3/runtime/')) {
    return { stageNumber: 2, stageName: 'V3 Pipeline' };
  }

  return { stageNumber: 0, stageName: 'PipelineRunner' };
}

async function readCheckpointFailureContext(outputDir: string): Promise<Record<string, unknown>> {
  try {
    const checkpointPath = path.join(outputDir, V3_CHECKPOINT_FILENAME);
    const raw = await fs.readFile(checkpointPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      lastCompletedStage?: string;
      nextStage?: string;
    };

    const meta: Record<string, unknown> = {};

    if (parsed.lastCompletedStage) {
      meta.v3LastCompletedStage = parsed.lastCompletedStage;
      if (isV3StageId(parsed.lastCompletedStage)) {
        meta.v3LastCompletedStageName = V3_STAGE_NAMES[parsed.lastCompletedStage];
      }
    }

    if (parsed.nextStage) {
      meta.v3NextStage = parsed.nextStage;
      if (isV3StageId(parsed.nextStage)) {
        meta.v3NextStageName = V3_STAGE_NAMES[parsed.nextStage];
      }
    }

    return meta;
  } catch {
    return {};
  }
}

function createLogger(quiet: boolean): Logger {
  if (quiet) {
    return {
      log: () => {},
      logStep: () => {},
    };
  }

  return {
    log: (message: string, color: string = 'reset') => {
      const colorCode = COLORS[color as keyof typeof COLORS] || COLORS.reset;
      console.log(`${colorCode}${message}${COLORS.reset}`);
    },
    logStep: (step: number, total: number, message: string) => {
      console.log(`${COLORS.cyan}[${step}/${total}] ${message}${COLORS.reset}`);
    },
  };
}

// =============================================================================
// Pipeline Runner
// =============================================================================

export async function runPipeline(
  datasetFolder: string = DEFAULT_DATASET,
  options: Partial<PipelineOptions> = {}
): Promise<PipelineResult> {
  const opts: PipelineOptions = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
  const {
    format,
    displayMode,
    separateWorkbooks,
    theme,
    quiet,
    statTesting,
    weightVariable: weightOpt,
    noWeight,
    loopStatTestingMode,
    projectSubType,
    messageListPath,
  } = opts;

  // -------------------------------------------------------------------------
  // Pipeline-level abort + timeout
  // -------------------------------------------------------------------------
  const timeoutMs = opts.timeoutMs ?? 5_400_000; // 90 min default
  const pipelineAbortController = new AbortController();
  const pipelineSignal = pipelineAbortController.signal;

  // Link external signal if provided
  if (opts.abortSignal) {
    if (opts.abortSignal.aborted) {
      pipelineAbortController.abort(opts.abortSignal.reason);
    } else {
      opts.abortSignal.addEventListener('abort', () => {
        pipelineAbortController.abort(opts.abortSignal!.reason);
      }, { once: true });
    }
  }

  // Set pipeline timeout
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  if (timeoutMs > 0) {
    timeoutHandle = setTimeout(() => {
      pipelineAbortController.abort(new Error(`Pipeline timeout: exceeded ${Math.round(timeoutMs / 60000)} minutes`));
    }, timeoutMs);
  }
  const clearPipelineTimeout = () => { if (timeoutHandle) clearTimeout(timeoutHandle); };

  // Circuit breaker
  const circuitBreaker = new CircuitBreaker({
    threshold: 3,
    classifications: ['transient'],
    onTrip: (info) => {
      log(`CIRCUIT BREAKER: ${info.consecutiveCount} consecutive ${info.classification} failures — aborting pipeline`, 'red');
      pipelineAbortController.abort(
        new Error(`Circuit breaker: ${info.consecutiveCount} consecutive ${info.classification} errors. Last: ${info.lastError}`)
      );
    },
  });

  // Build effective stat testing config
  const effectiveStatConfig: StatTestingConfig = resolveStatConfig({ cli: statTesting });

  const logger = createLogger(quiet);
  const { log, logStep } = logger;

  const startTime = Date.now();
  const totalSteps = 4; // Validation, V3 Pipeline, R+Excel, Summary

  // Stage timing accumulator
  const stageTiming: Record<string, number> = {};

  // Reset metrics collector
  resetMetricsCollector();

  // Get event bus for CLI events
  const eventBus = getPipelineEventBus();

  log('', 'reset');
  log('='.repeat(70), 'magenta');
  log('  TabulateAI - Pipeline (V3)', 'bright');
  log('='.repeat(70), 'magenta');
  log('', 'reset');

  // Create output folder early
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outputFolder = `pipeline-${timestamp}`;
  const pipelineId = outputFolder;

  return runWithPipelineContext(
    {
      pipelineId,
      runId: pipelineId,
      source: 'pipelineRunner',
    },
    async () => {
      setActiveCircuitBreaker(circuitBreaker);
      return runPipelineInner();
    },
  ) as Promise<PipelineResult>;

  async function runPipelineInner(): Promise<PipelineResult> {
  const datasetNameGuess = path.basename(
    path.isAbsolute(datasetFolder) ? datasetFolder : path.join(process.cwd(), datasetFolder)
  );
  const outputDir = path.join(process.cwd(), 'outputs', datasetNameGuess, outputFolder);
  await fs.mkdir(outputDir, { recursive: true });

  // Initialize V3 pipeline checkpoint (at outputDir root)
  const v3Checkpoint = createPipelineCheckpoint(pipelineId, datasetNameGuess);
  await fs.writeFile(
    path.join(outputDir, V3_CHECKPOINT_FILENAME),
    JSON.stringify(v3Checkpoint, null, 2),
  );

  // Observability
  const wideEvent = new WideEvent({ pipelineId, dataset: datasetNameGuess });
  const metricsCollector = getMetricsCollector();
  metricsCollector.bindWideEvent(wideEvent);
  const pipelineTransaction = startPipelineTransaction({ pipelineId, dataset: datasetNameGuess });

  const finishObservability = (outcome: 'success' | 'error' | 'partial' | 'cancelled', error?: string) => {
    metricsCollector.unbindWideEvent();
    wideEvent.finish(outcome, error);
    pipelineTransaction.finish(outcome === 'success' || outcome === 'partial' ? 'ok' : 'error');
  };

  // Pre-flight health check
  if (process.env.SKIP_HEALTH_CHECK !== 'true') {
    const providerLabel = (process.env.AI_PROVIDER || 'azure').toLowerCase() === 'openai' ? 'OpenAI' : 'Azure';
    log(`Pre-flight: checking ${providerLabel} deployments...`, 'cyan');
    const { runHealthCheck } = await import('./HealthCheck');
    const health = await runHealthCheck(pipelineSignal);
    if (health.success) {
      log(`  ${health.deployments.length} deployment(s) healthy (${health.durationMs}ms)`, 'green');
    } else {
      const failed = health.deployments.filter(d => !d.ok);
      for (const d of failed) {
        log(`  FAILED: ${d.name} (${d.agents.join(', ')}): ${d.error}`, 'red');
      }
      try {
        await persistSystemError({
          outputDir, dataset: datasetNameGuess, pipelineId,
          stageNumber: 0, stageName: 'HealthCheck',
          severity: 'fatal', actionTaken: 'failed_pipeline',
          error: new Error('Azure health check failed'),
          meta: { deployments: health.deployments },
        });
      } catch { /* ignore */ }
      eventBus.emitPipelineFailed(datasetNameGuess, 'Azure health check failed');
      finishObservability('error', 'Azure health check failed');
      setActiveCircuitBreaker(null);
      clearPipelineTimeout();
      return {
        success: false, dataset: datasetNameGuess, outputDir,
        durationMs: Date.now() - startTime, tableCount: 0, totalCostUsd: 0,
        error: `Azure health check failed: ${failed.map(d => `${d.name}: ${d.error}`).join('; ')}`,
      };
    }
    log('', 'reset');
  }

  // Discover files
  log(`Dataset folder: ${datasetFolder}`, 'blue');
  log(`Output folder: outputs/${datasetNameGuess}/${outputFolder}`, 'blue');
  if (projectSubType && projectSubType !== 'standard') {
    log(`Project sub-type: ${projectSubType}`, 'blue');
  }
  log('', 'reset');

  let files: DatasetFiles;
  try {
    files = await findDatasetFiles(datasetFolder);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    try {
      await persistSystemError({
        outputDir, dataset: datasetNameGuess, pipelineId,
        stageNumber: 0, stageName: 'FileDiscovery',
        severity: 'fatal', actionTaken: 'failed_pipeline',
        error, meta: { datasetFolder },
      });
    } catch { /* ignore */ }
    eventBus.emitPipelineFailed(datasetNameGuess, errorMsg);
    finishObservability('error', errorMsg);
    setActiveCircuitBreaker(null);
    clearPipelineTimeout();
    return {
      success: false, dataset: datasetNameGuess, outputDir,
      durationMs: Date.now() - startTime, tableCount: 0, totalCostUsd: 0,
      error: errorMsg,
    };
  }

  log(`  Datamap: ${files.datamap ? path.basename(files.datamap) : '(not used — .sav is source of truth)'}`, 'dim');
  log(`  Banner:  ${files.banner ? path.basename(files.banner) : '(not found — AI will generate cuts)'}`, 'dim');
  log(`  SPSS:    ${path.basename(files.spss)}`, 'dim');
  log(`  Survey:  ${files.survey ? path.basename(files.survey) : '(not found)'}`, 'dim');

  // Load dataset intake config (mirrors UI intake form)
  const intakeConfig = await loadDatasetIntakeConfig(datasetFolder);
  if (intakeConfig) {
    log(`  Intake:  intake.json loaded`, 'dim');
    if (intakeConfig.isMessageTesting) log(`    Message testing: true (template: ${intakeConfig.messageTemplatePath})`, 'dim');
    if (intakeConfig.isDemandSurvey) log(`    Demand survey: true`, 'dim');
    if (intakeConfig.hasMaxDiff) log(`    MaxDiff: true`, 'dim');
  }
  log('', 'reset');

  // Log config
  log('Stat Testing Configuration:', 'blue');
  log(`  ${formatStatTestingConfig(effectiveStatConfig).split('\n').join('\n  ')}`, 'dim');
  log('', 'reset');

  // Copy SPSS file to output folder
  const spssDestPath = path.join(outputDir, 'dataFile.sav');
  await fs.copyFile(files.spss, spssDestPath);

  eventBus.emitPipelineStart(files.name, totalSteps, outputDir);

  try {
    // -----------------------------------------------------------------------
    // Step 1: Validation + Loop Detection + Weight Detection
    // -----------------------------------------------------------------------
    logStep(1, totalSteps, 'Running validation...');
    const validationStart = Date.now();

    const validationResult = await runValidation({
      spssPath: files.spss,
      outputDir,
      skipLoopDetection: true, // V3 handles loops in enrichment chain (stages 00/10a)
    });

    const validationDuration = Date.now() - validationStart;
    stageTiming['validation'] = validationDuration;
    wideEvent.recordStage('validation', 'ok', validationDuration);
    log(`  Format: ${validationResult.format}`, 'dim');
    log(`  Errors: ${validationResult.errors.length}, Warnings: ${validationResult.warnings.length}`, 'dim');

    for (const w of validationResult.warnings) {
      if (!w.message.startsWith('Loop detected:')) {
        log(`  Warning: ${w.message}`, 'yellow');
      }
    }

    if (!validationResult.canProceed) {
      log('Validation FAILED — pipeline cannot proceed:', 'red');
      for (const e of validationResult.errors) {
        log(`  [Stage ${e.stage}] ${e.message}`, 'red');
      }
      try {
        await persistSystemError({
          outputDir, dataset: files.name, pipelineId,
          stageNumber: 0, stageName: 'Validation',
          severity: 'fatal', actionTaken: 'failed_pipeline',
          error: new Error('Validation failed'),
          meta: {
            errors: validationResult.errors.map(e => ({ stage: e.stage, message: e.message, details: e.details || '' })),
            warnings: validationResult.warnings.map(w => ({ stage: w.stage, message: w.message })),
            format: validationResult.format,
          },
        });
      } catch { /* ignore */ }
      eventBus.emitPipelineFailed(files.name, 'Validation failed: ' + validationResult.errors.map(e => e.message).join('; '));
      finishObservability('error', 'Validation failed');
      setActiveCircuitBreaker(null);
      clearPipelineTimeout();
      return {
        success: false, dataset: files.name, outputDir,
        durationMs: Date.now() - startTime, tableCount: 0, totalCostUsd: 0,
        error: 'Validation failed: ' + validationResult.errors.map(e => e.message).join('; '),
      };
    }

    log(`  Validation passed in ${validationDuration}ms`, 'green');

    // Weight detection
    let weightVariable: string | undefined = weightOpt;
    if (weightOpt) {
      const allCols = validationResult.dataFileStats?.columns || [];
      if (!allCols.includes(weightOpt)) {
        log(`  WARNING: Weight variable "${weightOpt}" not found in data columns`, 'red');
        weightVariable = undefined;
      } else {
        log(`  Weight variable: ${weightOpt}`, 'green');
      }
    } else if (!noWeight && validationResult.weightDetection?.bestCandidate) {
      const best = validationResult.weightDetection.bestCandidate;
      log(`  Weight candidate detected: "${best.column}" (score: ${best.score.toFixed(2)}, mean: ${best.mean.toFixed(3)})`, 'yellow');
      log(`  Use --weight=${best.column} to apply weighting, or --no-weight to suppress`, 'yellow');
    }

    // Variable data
    const dataMapResult = validationResult.processingResult!;
    let verboseDataMap = dataMapResult.verbose as VerboseDataMapType[];

    // Mark weight variable type
    if (weightVariable) {
      verboseDataMap = verboseDataMap.map(v =>
        v.column === weightVariable ? { ...v, normalizedType: 'weight' as const } : v
      );
    }

    log(`  ${verboseDataMap.length} variables from .sav`, 'green');

    // MaxDiff enrichment
    if (projectSubType === 'maxdiff') {
      const maxdiffWarnings = new MaxDiffWarnings();
      const messageResolution = await resolveAndParseMaxDiffMessages(undefined, messageListPath, maxdiffWarnings);
      if (messageResolution.entries && messageResolution.entries.length > 0) {
        const maxdiffDetectionForEnrich = detectMaxDiffFamilies(verboseDataMap);
        if (maxdiffDetectionForEnrich.detected) {
          const enrichResult = enrichDataMapWithMessages(verboseDataMap, messageResolution.entries, maxdiffDetectionForEnrich);
          verboseDataMap = enrichResult.enriched;
          log(`  MaxDiff message enrichment: ${enrichResult.stats.variableLabelsEnriched} variable labels`, 'green');
        }
      }
    }

    // Stacked data detection: uses .sav-level stacking columns (from RDataReader)
    // This is a pre-flight safety gate, independent of loop detection.
    const stackingColumns = validationResult.dataFileStats?.stackingColumns ?? [];
    if (stackingColumns.length >= 2) {
      const msg = 'Data appears to be already stacked. Please upload the original wide-format data.';
      log(`  ${msg}`, 'red');
      eventBus.emitPipelineFailed(files.name, msg);
      finishObservability('error', msg);
      setActiveCircuitBreaker(null);
      clearPipelineTimeout();
      return {
        success: false, dataset: files.name, outputDir,
        durationMs: Date.now() - startTime, tableCount: 0, totalCostUsd: 0,
        error: msg,
      };
    }

    // Loop detection, classification, and mapping derivation are handled by
    // V3 enrichment chain (stages 00/10a) and runV3Pipeline join point.

    log(`  Effective datamap: ${verboseDataMap.length} variables`, 'green');
    stageTiming['setup'] = Date.now() - validationStart;
    wideEvent.recordStage('setup', 'ok', stageTiming['setup']);
    eventBus.emitStageComplete(1, STAGE_NAMES[1], stageTiming['setup']);
    log('', 'reset');

    // -----------------------------------------------------------------------
    // Step 2: V3 Pipeline (stages 00-12 → FORK(13b-13d || 20-21) → JOIN → 22-14)
    // -----------------------------------------------------------------------
    logStep(2, totalSteps, 'Running V3 pipeline...');
    const v3Start = Date.now();

    const v3Result = await runV3Pipeline({
      savPath: files.spss,
      datasetPath: datasetFolder,
      outputDir,
      pipelineId,
      dataset: datasetNameGuess,
      abortSignal: pipelineSignal,
      intakeConfig: intakeConfig ?? undefined,
      statTestingConfig: effectiveStatConfig,
      wizardStatTesting: null,
      // Loop mappings derived from V3 entries at join point (no legacy LoopCollapser)
      loopStatTestingMode,
      weightVariable,
      researchObjectives: opts.researchObjectives,
      cutSuggestions: opts.cutSuggestions,
      projectType: opts.projectType,
    });

    const v3Duration = Date.now() - v3Start;
    stageTiming['v3Pipeline'] = v3Duration;
    wideEvent.recordStage('v3Pipeline', 'ok', v3Duration);
    log(`  V3 pipeline complete: ${v3Result.canonical.tables.length} tables, ${v3Result.compute.rScriptInput.cuts.length} cuts (${v3Duration}ms)`, 'green');
    eventBus.emitStageComplete(2, 'V3 Pipeline', v3Duration);
    log('', 'reset');

    // -----------------------------------------------------------------------
    // Step 3: Post-V3 Processing (R script → R execution → Excel)
    // -----------------------------------------------------------------------
    logStep(3, totalSteps, 'Running R script and generating Excel...');

    const postResult = await runPostV3Processing({
      compute: v3Result.compute,
      outputDir,
      dataFilePath: 'dataFile.sav',
      pipelineId,
      dataset: files.name,
      format,
      displayMode,
      separateWorkbooks,
      theme,
      abortSignal: pipelineSignal,
      log: (msg: string) => log(msg, 'dim'),
    });

    stageTiming['rExecution'] = postResult.rDurationMs;
    stageTiming['excelExport'] = postResult.excelDurationMs;
    if (postResult.rSuccess) {
      wideEvent.recordStage('rExecution', 'ok', postResult.rDurationMs);
    }
    if (postResult.excelSuccess) {
      wideEvent.recordStage('excelExport', 'ok', postResult.excelDurationMs);
    }
    eventBus.emitStageComplete(3, 'R + Excel', postResult.rDurationMs + postResult.excelDurationMs);
    log('', 'reset');

    const exportErrors: Array<{
      format: 'shared' | 'q' | 'wincross';
      stage: string;
      message: string;
      retryable: boolean;
      timestamp: string;
    }> = [];
    let exportArtifacts: ReturnType<typeof buildExportArtifactRefs> | undefined;
    let exportReadiness: ReturnType<typeof buildExportArtifactRefs>['readiness'] | undefined;
    let localExports = {
      q: { success: false as boolean },
      wincross: { success: false as boolean },
    };

    try {
      const copiedWideSav = await ensureWideSavFallback(outputDir, 'dataFile.sav');
      if (copiedWideSav) {
        log('  [ExportData] Copied export/data/wide.sav fallback from runtime dataFile.sav', 'dim');
      }
      const resultFiles: string[] = await fs.readdir(path.join(outputDir, 'results')).catch((): string[] => []);
      const hasDualWeightOutputs =
        resultFiles.includes('tables-weighted.json') &&
        resultFiles.includes('tables-unweighted.json');

      await persistPhase0Artifacts({
        outputDir,
        tablesWithLoopFrame: v3Result.compute.rScriptInput.tables as unknown as import('../../schemas/verificationAgentSchema').TableWithLoopFrame[],
        loopMappings: v3Result.compute.rScriptInput.loopMappings ?? [],
        loopSemanticsPolicy: v3Result.compute.rScriptInput.loopSemanticsPolicy,
        weightVariable: weightVariable ?? null,
        hasDualWeightOutputs,
        sourceSavUploadedName: path.basename(files.spss),
        sourceSavRuntimeName: 'dataFile.sav',
        convexRefs: { pipelineId },
      });
      const phase1Manifest = await buildPhase1Manifest(outputDir);
      exportArtifacts = buildExportArtifactRefs(phase1Manifest.metadata);
      exportReadiness = phase1Manifest.metadata.readiness;
    } catch (error) {
      exportErrors.push({
        format: 'shared',
        stage: 'contract_build',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        timestamp: new Date().toISOString(),
      });
    }

    try {
      const generated = await generateLocalQAndWinCrossExports(outputDir);
      localExports = {
        q: { success: generated.q.success },
        wincross: { success: generated.wincross.success },
      };
      exportErrors.push(...generated.errors);
    } catch (error) {
      exportErrors.push({
        format: 'q',
        stage: 'serialize',
        message: error instanceof Error ? error.message : String(error),
        retryable: true,
        timestamp: new Date().toISOString(),
      });
      exportErrors.push({
        format: 'wincross',
        stage: 'serialize',
        message: 'WinCross export skipped because local export generation failed.',
        retryable: true,
        timestamp: new Date().toISOString(),
      });
    }

    // -----------------------------------------------------------------------
    // Step 4: Summary
    // -----------------------------------------------------------------------
    const totalDuration = Date.now() - startTime;
    const terminalStatus: 'success' | 'partial' | 'error' = (
      postResult.excelSuccess && localExports.q.success && localExports.wincross.success
    )
      ? 'success'
      : (postResult.excelSuccess || postResult.rSuccess || localExports.q.success || localExports.wincross.success)
        ? 'partial'
        : 'error';

    const costSummary = await getCostSummaryString();
    log(costSummary, 'magenta');

    log('', 'reset');
    log('='.repeat(70), 'magenta');
    log('  Pipeline Complete', 'bright');
    log('='.repeat(70), 'magenta');
    log(`  Dataset:     ${files.name}`, 'reset');
    log(`  Variables:   ${v3Result.questionId.entries.length}`, 'reset');
    log(`  Tables:      ${v3Result.compute.rScriptInput.tables.length}`, 'reset');
    log(`  Cuts:        ${v3Result.compute.rScriptInput.cuts.length}`, 'reset');
    log(`  Duration:    ${(totalDuration / 1000).toFixed(1)}s`, 'reset');
    log(`  Output:      outputs/${files.name}/${outputFolder}/`, 'reset');
    log('', 'reset');

    // Build and write pipeline summary
    const summary = await buildPipelineSummary({
      v3Result: v3Result as V3PipelineResult,
      postResult,
      files,
      totalDurationMs: totalDuration,
      outputDir,
      pipelineId,
      statTestingConfig: effectiveStatConfig,
      setupStageTiming: stageTiming,
      weightDetection: validationResult.weightDetection ?? undefined,
    });
    const errorRead = await readPipelineErrors(outputDir);
    const pipelineDecisions = buildPipelineDecisions({
      questionId: {
        entries: v3Result.questionId.entries,
        metadata: v3Result.questionId.metadata,
      },
      fallbackStudyFlags: {
        isDemandSurvey: v3Result.questionId.metadata.isDemandSurvey,
        hasChoiceModelExercise: v3Result.questionId.metadata.hasChoiceModelExercise,
        hasMaxDiff: v3Result.questionId.metadata.hasMaxDiff ?? false,
      },
      checkpoint: v3Result.checkpoint,
      tables: {
        canonicalTablesPlanned: v3Result.canonical.tablePlan.summary.plannedTables,
        canonicalTables: v3Result.canonical.tables,
        finalTableCount: v3Result.compute.rScriptInput.tables.length,
      },
      banners: {
        source: v3Result.planning.bannerPlan.routeMetadata.routeUsed === 'banner_agent' ? 'uploaded' : 'auto_generated',
        bannerGroupCount: v3Result.planning.crosstabPlan.crosstabPlan.bannerCuts.length,
        totalCuts: v3Result.compute.rScriptInput.cuts.length,
        flaggedForReview: 0,
      },
      weights: {
        detection: validationResult.weightDetection,
        variableUsed: weightVariable ?? null,
      },
      errors: {
        records: errorRead.records,
        validationWarningCount: validationResult.warnings.length,
      },
      timing: {
        postRMs: postResult.rDurationMs,
        excelMs: postResult.excelDurationMs,
        totalMs: totalDuration,
      },
    });
    const decisionsSummary = buildDecisionsSummary(pipelineDecisions);
    const summaryWithExports = {
      ...summary,
      status: terminalStatus,
      pipelineDecisions,
      decisionsSummary,
      exports: {
        q: localExports.q.success,
        wincross: localExports.wincross.success,
        ...(exportArtifacts ? { artifactRefs: exportArtifacts } : {}),
        ...(exportReadiness ? { readiness: exportReadiness } : {}),
        ...(exportErrors.length > 0 ? { errors: exportErrors } : {}),
      },
    };
    await fs.writeFile(
      path.join(outputDir, 'pipeline-summary.json'),
      JSON.stringify(summaryWithExports, null, 2),
    );

    // Generate human-readable table report
    await writeTableReport({
      dataset: files.name,
      outputDir,
      canonical: v3Result.canonical,
      pipelineTimingMs: totalDuration,
    });

    // Emit pipeline:complete event
    const costMetrics = await getMetricsCollector().getSummary();
    eventBus.emitPipelineComplete(
      files.name,
      totalDuration,
      costMetrics.totals.estimatedCostUsd,
      v3Result.compute.rScriptInput.tables.length,
      outputDir,
    );

    // -----------------------------------------------------------------------
    // Cleanup temporary files
    // -----------------------------------------------------------------------
    log('Cleaning up temporary files...', 'dim');
    const filesToCleanup: string[] = [];

    try {
      await fs.unlink(path.join(outputDir, 'dataFile.sav'));
      filesToCleanup.push('dataFile.sav');
    } catch { /* File may not exist */ }

    try {
      await fs.rm(path.join(outputDir, 'banner-images'), { recursive: true });
      filesToCleanup.push('banner-images/');
    } catch { /* Folder may not exist */ }

    try {
      const allFiles = await fs.readdir(outputDir);
      for (const file of allFiles) {
        if (file.endsWith('.html')) {
          await fs.unlink(path.join(outputDir, file));
          filesToCleanup.push(file);
        }
        if (file.endsWith('.png') && file.includes('_html_')) {
          await fs.unlink(path.join(outputDir, file));
          filesToCleanup.push(file);
        }
      }
    } catch { /* Ignore cleanup errors */ }

    if (filesToCleanup.length > 0) {
      log(`  Removed: ${filesToCleanup.join(', ')}`, 'dim');
    }

    wideEvent.set('tableCount', v3Result.compute.rScriptInput.tables.length);
    finishObservability(terminalStatus);
    setActiveCircuitBreaker(null);
    clearPipelineTimeout();
    const terminalError = terminalStatus === 'partial'
      ? [
        !postResult.excelSuccess ? 'Excel export failed' : null,
        !localExports.q.success ? 'Q export failed' : null,
        !localExports.wincross.success ? 'WinCross export failed' : null,
      ].filter((value): value is string => !!value).join('; ')
      : undefined;
    return {
      success: terminalStatus === 'success',
      status: terminalStatus,
      dataset: files.name,
      outputDir,
      durationMs: totalDuration,
      tableCount: v3Result.compute.rScriptInput.tables.length,
      totalCostUsd: costMetrics.totals.estimatedCostUsd,
      ...(terminalError ? { error: terminalError } : {}),
      ...(exportErrors.length > 0 ? { exportErrors } : {}),
    };

  } catch (error) {
    setActiveCircuitBreaker(null);
    clearPipelineTimeout();
    const isTimeout = pipelineSignal.aborted && !opts.abortSignal?.aborted;
    const isCancelled = !!opts.abortSignal?.aborted;
    const errorMsg = isTimeout
      ? `Pipeline timed out after ${Math.round(timeoutMs / 60000)} minutes`
      : error instanceof Error ? error.message : String(error);
    finishObservability(isCancelled ? 'cancelled' : 'error', errorMsg);
    log(`ERROR: ${errorMsg}`, 'red');
    try {
      const inferredStage = inferFailureStage(error);
      const checkpointMeta = await readCheckpointFailureContext(outputDir);
      await persistSystemError({
        outputDir, dataset: files.name, pipelineId,
        stageNumber: inferredStage.stageNumber,
        stageName: inferredStage.stageName,
        severity: 'fatal', actionTaken: 'failed_pipeline',
        error,
        meta: {
          message: errorMsg.substring(0, 500),
          isTimeout,
          isCancelled: !!opts.abortSignal?.aborted,
          originFrame: getFirstRelevantStackFrame(error),
          ...checkpointMeta,
        },
      });
    } catch { /* ignore */ }
    eventBus.emitPipelineFailed(files.name, errorMsg);

    return {
      success: false,
      dataset: files.name,
      outputDir,
      durationMs: Date.now() - startTime,
      tableCount: 0,
      totalCostUsd: 0,
      error: errorMsg,
    };
  }
  } // end runPipelineInner
}
