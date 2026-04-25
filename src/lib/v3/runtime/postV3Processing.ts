/**
 * Post-V3 Processing — Shared Module
 *
 * Handles everything that happens AFTER the V3 pipeline produces its compute
 * package: R script generation, R execution, Excel export, and streamlined
 * data extraction.
 *
 * Used by both PipelineRunner (CLI) and pipelineOrchestrator (web).
 * Prevents divergence between the two code paths.
 */

import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import { generateRScriptV2WithValidation } from '@/lib/r/RScriptGeneratorV2';
import type { RScriptV2Input, ValidationReport } from '@/lib/r/RScriptGeneratorV2';
import { ExcelFormatter } from '@/lib/excel/ExcelFormatter';
import type { ExcelFormat, DisplayMode } from '@/lib/excel/ExcelFormatter';
import { extractStreamlinedData } from '@/lib/data/extractStreamlinedData';
import { ResultsTablesFinalContractSchema } from '@/lib/exportData/inputArtifactSchemas';
import { fixRHexEscapes } from '@/lib/r/fixRHexEscapes';
import { persistSystemError } from '@/lib/errors/ErrorPersistence';
import { buildFinalTablesContract, type FinalTableContractComputeInput } from './finalTableContract';

import type { ComputePackageOutput } from './compute/types';

const execFileAsync = promisify(execFile);

const DEFAULT_R_EXECUTION_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_R_EXECUTION_TIMEOUT_MS = 30 * 60 * 1000;
const PER_TABLE_R_EXECUTION_TIMEOUT_MS = 3000;
const DEFAULT_R_MAX_BUFFER_MB = 50;

// =============================================================================
// Types
// =============================================================================

export interface PostV3ProcessingInput {
  /** V3 compute result containing rScriptInput */
  compute: { rScriptInput: ComputePackageOutput['rScriptInput'] };

  /** Output directory for this pipeline run */
  outputDir: string;

  /** Path to the copied .sav file relative to outputDir (e.g., 'dataFile.sav') */
  dataFilePath: string;

  /** Pipeline run identifier */
  pipelineId: string;

  /** Dataset name (for error persistence) */
  dataset: string;

  // --- Excel options ---
  format?: ExcelFormat;
  displayMode?: DisplayMode;
  separateWorkbooks?: boolean;
  theme?: string;

  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;

  /** Optional logger function (CLI uses colored logger, orchestrator uses console.log) */
  log?: (message: string) => void;

  /** Optional hook fired when post-R final-table materialization begins. */
  onFinalTableStageStart?: () => Promise<void> | void;
}

export interface PostV3PhaseResult {
  attempted: boolean;
  success: boolean;
  durationMs: number;
  error?: string;
  skippedReason?: string;
  outputTableCount?: number;
}

export interface PostV3ProcessingResult {
  /** Path to master.R script */
  masterRPath: string;
  /** Path to R execution log */
  rLogPath?: string;
  /** Static validation report from R script generation */
  staticValidationReport?: ValidationReport;
  /** Weight variable if dual output was produced */
  weightVariable?: string;
  /** R script size in bytes */
  rScriptSizeBytes: number;
  /** R execution result */
  rExecution: PostV3PhaseResult;
  /** Post-R final-table contract materialization result */
  finalTableContract: PostV3PhaseResult;
  /** Excel export result */
  excelExport: PostV3PhaseResult;
}

export interface PostV3ProcessingAssessment {
  status: 'success' | 'partial' | 'error';
  message: string;
  finalStage: 'rExecution' | 'finalTableContract' | 'excelExport';
}

function buildSkippedPhase(skippedReason: string): PostV3PhaseResult {
  return {
    attempted: false,
    success: false,
    durationMs: 0,
    skippedReason,
  };
}

export function assessPostV3Processing(
  result: PostV3ProcessingResult,
): PostV3ProcessingAssessment {
  if (!result.rExecution.success) {
    return {
      status: 'error',
      message: 'R execution failed.',
      finalStage: 'rExecution',
    };
  }

  if (!result.finalTableContract.success) {
    return {
      status: 'partial',
      message: 'R execution succeeded but final table contract materialization failed.',
      finalStage: 'finalTableContract',
    };
  }

  if (!result.excelExport.success) {
    return {
      status: 'partial',
      message: 'Final table contract succeeded but Excel generation failed.',
      finalStage: 'excelExport',
    };
  }

  return {
    status: 'success',
    message: 'Pipeline completed successfully.',
    finalStage: 'excelExport',
  };
}

// =============================================================================
// Signal Descriptions
// =============================================================================

function describeProcessSignal(error: unknown): { signal?: string; signalDescription?: string } {
  const execError = error as { signal?: string; killed?: boolean };
  const signal = execError.signal;
  if (!signal) return {};

  const descriptions: Record<string, string> = {
    SIGKILL: 'Process killed by OS (likely out of memory)',
    SIGSEGV: 'Process crashed (segfault — possibly corrupted .sav or haven bug)',
    SIGTERM: 'Process terminated (likely hit timeout)',
    SIGABRT: 'Process aborted',
  };

  return {
    signal,
    signalDescription: descriptions[signal] || `Process received signal ${signal}`,
  };
}

// =============================================================================
// R Discovery
// =============================================================================

const R_PATHS = [
  '/opt/homebrew/bin/Rscript',
  '/usr/local/bin/Rscript',
  '/usr/bin/Rscript',
  'Rscript',
];

function parseRExecutionTimeoutOverride(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.warn(`[PostV3] Invalid R_EXECUTION_TIMEOUT_MS "${value}" — ignoring override`);
    return null;
  }
  return parsed;
}

/**
 * Get the R execution maxBuffer in bytes.
 * Configurable via R_MAX_BUFFER_MB env var (default: 50 MB).
 */
export function getRMaxBufferBytes(): number {
  const envValue = process.env.R_MAX_BUFFER_MB;
  if (envValue) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed * 1024 * 1024;
    }
    console.warn(`[PostV3] Invalid R_MAX_BUFFER_MB "${envValue}" — using default ${DEFAULT_R_MAX_BUFFER_MB} MB`);
  }
  return DEFAULT_R_MAX_BUFFER_MB * 1024 * 1024;
}

export function getRExecutionTimeoutMs(tableCount: number): number {
  const override = parseRExecutionTimeoutOverride(process.env.R_EXECUTION_TIMEOUT_MS);
  if (override !== null) return override;

  const scaledTimeout = tableCount * PER_TABLE_R_EXECUTION_TIMEOUT_MS;
  return Math.min(
    MAX_R_EXECUTION_TIMEOUT_MS,
    Math.max(DEFAULT_R_EXECUTION_TIMEOUT_MS, scaledTimeout),
  );
}

async function findRCommand(): Promise<string> {
  for (const rPath of R_PATHS) {
    try {
      await execFileAsync(rPath, ['--version'], { timeout: 1000 });
      return rPath;
    } catch {
      // Try next
    }
  }
  return 'Rscript'; // fallback
}

// =============================================================================
// R Log Writer
// =============================================================================

async function saveRLog(
  rDir: string,
  stdout: string,
  stderr: string,
  success: boolean,
): Promise<string> {
  const rLogPath = path.join(rDir, 'execution.log');
  const logContent = [
    `R Execution Log`,
    `===============`,
    `Timestamp: ${new Date().toISOString()}`,
    `Status: ${success ? 'SUCCESS' : 'FAILED'}`,
    ``,
    `--- STDOUT ---`,
    stdout || '(empty)',
    ``,
    `--- STDERR ---`,
    stderr || '(empty)',
  ].join('\n');
  await fs.writeFile(rLogPath, logContent, 'utf-8');
  return rLogPath;
}

export async function finalizeResultsTablesArtifact(
  jsonPath: string,
  computeInput: FinalTableContractComputeInput,
) {
  const jsonContent = fixRHexEscapes(await fs.readFile(jsonPath, 'utf-8'));
  const rawResultsTables = JSON.parse(jsonContent);
  const finalized = buildFinalTablesContract(rawResultsTables, computeInput);
  const validated = ResultsTablesFinalContractSchema.parse(finalized);
  await fs.writeFile(jsonPath, JSON.stringify(validated, null, 2), 'utf-8');
  return validated;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Run post-V3 processing: R script generation → R execution → Excel export.
 *
 * This is the shared downstream processing that both PipelineRunner and
 * pipelineOrchestrator call after runV3Pipeline() completes.
 */
export async function runPostV3Processing(
  input: PostV3ProcessingInput,
): Promise<PostV3ProcessingResult> {
  const {
    compute,
    outputDir,
    dataFilePath,
    pipelineId,
    dataset,
    format = 'standard',
    displayMode = 'frequency',
    separateWorkbooks = false,
    theme = 'classic',
    abortSignal,
    log = console.log,
    onFinalTableStageStart,
  } = input;

  const computeDir = path.join(outputDir, 'compute');
  const resultsDir = path.join(outputDir, 'results');
  await fs.mkdir(computeDir, { recursive: true });
  await fs.mkdir(resultsDir, { recursive: true });

  const weightVariable = compute.rScriptInput.weightVariable;

  // -------------------------------------------------------------------------
  // Step 1: R Script Generation
  // -------------------------------------------------------------------------
  log('[PostV3] Generating R script...');

  const rScriptInput: RScriptV2Input = {
    ...compute.rScriptInput,
    dataFilePath,
  };

  const { script: masterScript, validation: staticValidationReport } =
    generateRScriptV2WithValidation(rScriptInput, {
      sessionId: path.basename(outputDir),
      outputDir: 'results',
    });

  const masterPath = path.join(computeDir, 'master.R');
  await fs.writeFile(masterPath, masterScript, 'utf-8');

  if (staticValidationReport.invalidTables > 0 || staticValidationReport.warnings.length > 0) {
    const validationPath = path.join(computeDir, 'static-validation-report.json');
    await fs.writeFile(validationPath, JSON.stringify(staticValidationReport, null, 2), 'utf-8');
    log(`[PostV3] Static validation: ${staticValidationReport.invalidTables} invalid, ${staticValidationReport.warnings.length} warnings`);
  }

  log(`[PostV3] R script generated (${Math.round(masterScript.length / 1024)} KB)`);

  // -------------------------------------------------------------------------
  // Step 2: R Execution
  // -------------------------------------------------------------------------
  let rLogPath: string | undefined;
  const rExecution: PostV3PhaseResult = {
    attempted: false,
    success: false,
    durationMs: 0,
  };

  if (abortSignal?.aborted) {
    return {
      masterRPath: masterPath,
      rScriptSizeBytes: masterScript.length,
      staticValidationReport,
      weightVariable,
      rExecution: {
        attempted: false,
        success: false,
        durationMs: 0,
        error: 'Aborted before R execution',
      },
      finalTableContract: buildSkippedPhase('Skipped because R execution did not run.'),
      excelExport: buildSkippedPhase('Skipped because R execution did not run.'),
    };
  }

  const rTableCount = compute.rScriptInput.tables.length;
  const rExecutionTimeoutMs = getRExecutionTimeoutMs(rTableCount);
  const maxBufferBytes = getRMaxBufferBytes();
  log(
    `[PostV3] Executing R script (timeout ${(rExecutionTimeoutMs / 60000).toFixed(1)}m for ${rTableCount} tables)...`,
  );
  const rStart = Date.now();

  try {
    rExecution.attempted = true;
    const rCommand = await findRCommand();
    const { stdout, stderr } = await execFileAsync(rCommand, [masterPath], {
      cwd: outputDir,
      maxBuffer: maxBufferBytes,
      timeout: rExecutionTimeoutMs,
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });

    rExecution.durationMs = Date.now() - rStart;
    rLogPath = await saveRLog(computeDir, stdout, stderr, true);
    rExecution.success = true;
    log(`[PostV3] R execution: ${rExecution.durationMs}ms`);
  } catch (err) {
    rExecution.durationMs = Date.now() - rStart;
    rExecution.attempted = true;
    const execError = err as { stdout?: string; stderr?: string; message?: string };
    const stdout = execError.stdout || '';
    const stderr = execError.stderr || '';
    const errorMsg = execError.message || String(err);
    const { signalDescription } = describeProcessSignal(err);

    try {
      rLogPath = await saveRLog(computeDir, stdout, stderr, false);
    } catch {
      // Ignore log save errors
    }

    // Detect buffer overflow and produce a clear, actionable error message
    const isBufferOverflow = errorMsg.includes('maxBuffer') || errorMsg.includes('ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
    if (isBufferOverflow) {
      const currentLimitMB = Math.round(maxBufferBytes / (1024 * 1024));
      rExecution.error = `R output exceeded the ${currentLimitMB} MB buffer limit. Set R_MAX_BUFFER_MB to a higher value (e.g., ${currentLimitMB * 2}) and re-run.`;
    } else {
      rExecution.error = signalDescription || errorMsg.substring(0, 500);
    }

    if (errorMsg.includes('command not found') && !errorMsg.includes('Error in')) {
      log('[PostV3] R not installed — script saved for manual execution');
    } else {
      log(`[PostV3] R execution failed: ${rExecution.error}`);
    }

    try {
      await persistSystemError({
        outputDir,
        dataset,
        pipelineId,
        stageNumber: 10,
        stageName: 'R Execution',
        severity: errorMsg.includes('command not found') ? 'warning' : 'error',
        actionTaken: 'continued',
        error: err,
        meta: {
          action: 'r_execution_failed',
          message: errorMsg.substring(0, 500),
          signalDescription,
          timeoutMs: rExecutionTimeoutMs,
          tableCount: rTableCount,
          stdoutTail: stdout.length > 500 ? stdout.slice(-500) : stdout,
          stderrTail: stderr.length > 500 ? stderr.slice(-500) : stderr,
        },
      });
    } catch {
      // ignore
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Final Table Contract Materialization
  // -------------------------------------------------------------------------
  const finalTableContract: PostV3PhaseResult = rExecution.success
    ? { attempted: false, success: false, durationMs: 0 }
    : buildSkippedPhase('Skipped because R execution failed.');

  if (rExecution.success) {
    await onFinalTableStageStart?.();
    log('[PostV3] Finalizing results tables...');
    const finalizationStart = Date.now();

    try {
      finalTableContract.attempted = true;
      const resultFiles = await fs.readdir(resultsDir);
      const finalTableComputeInput: FinalTableContractComputeInput = {
        tables: compute.rScriptInput.tables,
        cuts: compute.rScriptInput.cuts,
      };

      if (weightVariable) {
        const hasWeighted = resultFiles.includes('tables-weighted.json');
        const hasUnweighted = resultFiles.includes('tables-unweighted.json');
        if (!hasWeighted || !hasUnweighted) {
          throw new Error('R completed but did not generate both weighted and unweighted tables artifacts.');
        }

        const weightedData = await finalizeResultsTablesArtifact(
          path.join(resultsDir, 'tables-weighted.json'),
          finalTableComputeInput,
        );
        await finalizeResultsTablesArtifact(
          path.join(resultsDir, 'tables-unweighted.json'),
          finalTableComputeInput,
        );
        finalTableContract.outputTableCount = Object.keys(weightedData.tables || {}).length;
        log(
          `[PostV3] Final tables: tables-weighted.json + tables-unweighted.json (${finalTableContract.outputTableCount} tables each)`,
        );

        const streamlinedData = extractStreamlinedData(weightedData);
        await fs.writeFile(
          path.join(resultsDir, 'data-streamlined.json'),
          JSON.stringify(streamlinedData, null, 2),
          'utf-8',
        );
      } else {
        if (!resultFiles.includes('tables.json')) {
          throw new Error('R completed but did not generate results/tables.json.');
        }

        const jsonData = await finalizeResultsTablesArtifact(
          path.join(resultsDir, 'tables.json'),
          finalTableComputeInput,
        );
        finalTableContract.outputTableCount = Object.keys(jsonData.tables || {}).length;
        log(`[PostV3] Final tables: tables.json (${finalTableContract.outputTableCount} tables)`);

        const streamlinedData = extractStreamlinedData(jsonData as Parameters<typeof extractStreamlinedData>[0]);
        await fs.writeFile(
          path.join(resultsDir, 'data-streamlined.json'),
          JSON.stringify(streamlinedData, null, 2),
          'utf-8',
        );
      }

      finalTableContract.durationMs = Date.now() - finalizationStart;
      finalTableContract.success = true;
      log(`[PostV3] Final table contract: ${finalTableContract.durationMs}ms`);
    } catch (err) {
      finalTableContract.durationMs = Date.now() - finalizationStart;
      finalTableContract.error = err instanceof Error ? err.message : String(err);
      log(`[PostV3] Final table contract failed: ${finalTableContract.error}`);

      try {
        await persistSystemError({
          outputDir,
          dataset,
          pipelineId,
          stageNumber: 11,
          stageName: 'Final Table Contract',
          severity: 'error',
          actionTaken: 'continued',
          error: err,
          meta: {
            action: 'final_table_contract_failed',
            message: finalTableContract.error,
            weightVariable: weightVariable ?? null,
          },
        });
      } catch {
        // ignore
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Excel Export
  // -------------------------------------------------------------------------
  const excelExport: PostV3PhaseResult = finalTableContract.success
    ? { attempted: false, success: false, durationMs: 0 }
    : buildSkippedPhase(
      rExecution.success
        ? 'Skipped because final table contract materialization failed.'
        : 'Skipped because R execution failed.',
    );

  if (finalTableContract.success) {
    log('[PostV3] Generating Excel workbook...');
    const excelStart = Date.now();

    try {
      excelExport.attempted = true;
      if (weightVariable) {
        // Dual workbook: weighted + unweighted
        const weightedJsonPath = path.join(resultsDir, 'tables-weighted.json');
        const unweightedJsonPath = path.join(resultsDir, 'tables-unweighted.json');

        const weightedFormatter = new ExcelFormatter({ format, displayMode, separateWorkbooks, theme });
        await weightedFormatter.formatFromFile(weightedJsonPath);
        await weightedFormatter.saveToFile(path.join(resultsDir, 'crosstabs-weighted.xlsx'));
        if (weightedFormatter.hasSecondWorkbook()) {
          await weightedFormatter.saveSecondWorkbook(path.join(resultsDir, 'crosstabs-weighted-counts.xlsx'));
        }

        const unweightedFormatter = new ExcelFormatter({ format, displayMode, separateWorkbooks, theme });
        await unweightedFormatter.formatFromFile(unweightedJsonPath);
        await unweightedFormatter.saveToFile(path.join(resultsDir, 'crosstabs-unweighted.xlsx'));
        if (unweightedFormatter.hasSecondWorkbook()) {
          await unweightedFormatter.saveSecondWorkbook(path.join(resultsDir, 'crosstabs-unweighted-counts.xlsx'));
        }

        log(`[PostV3] Excel: crosstabs-weighted.xlsx + crosstabs-unweighted.xlsx`);
      } else {
        // Standard single workbook
        const tablesJsonPath = path.join(resultsDir, 'tables.json');
        const excelPath = path.join(resultsDir, 'crosstabs.xlsx');

        const formatter = new ExcelFormatter({ format, displayMode, separateWorkbooks, theme });
        await formatter.formatFromFile(tablesJsonPath);
        await formatter.saveToFile(excelPath);

        if (formatter.hasSecondWorkbook()) {
          await formatter.saveSecondWorkbook(path.join(resultsDir, 'crosstabs-counts.xlsx'));
          log(`[PostV3] Excel: crosstabs.xlsx + crosstabs-counts.xlsx`);
        } else {
          log(`[PostV3] Excel: crosstabs.xlsx (format: ${format}, display: ${displayMode})`);
        }
      }

      excelExport.durationMs = Date.now() - excelStart;
      excelExport.success = true;
      log(`[PostV3] Excel export: ${excelExport.durationMs}ms`);
    } catch (err) {
      excelExport.durationMs = Date.now() - excelStart;
      excelExport.error = err instanceof Error ? err.message : String(err);
      log(`[PostV3] Excel generation failed: ${excelExport.error}`);

      try {
        await persistSystemError({
          outputDir,
          dataset,
          pipelineId,
          stageNumber: 12,
          stageName: 'Excel Export',
          severity: 'error',
          actionTaken: 'continued',
          error: err,
          meta: { action: 'excel_generation_failed' },
        });
      } catch {
        // ignore
      }
    }
  } else if (excelExport.skippedReason) {
    log(`[PostV3] ${excelExport.skippedReason}`);
  }

  return {
    masterRPath: masterPath,
    rLogPath,
    staticValidationReport,
    weightVariable,
    rScriptSizeBytes: masterScript.length,
    rExecution,
    finalTableContract,
    excelExport,
  };
}
