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
import { buildFinalTablesContract } from './finalTableContract';

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
}

export interface PostV3ProcessingResult {
  /** Whether R execution succeeded */
  rSuccess: boolean;
  /** Whether Excel export succeeded */
  excelSuccess: boolean;
  /** Path to master.R script */
  masterRPath: string;
  /** R execution duration in ms */
  rDurationMs: number;
  /** Excel export duration in ms */
  excelDurationMs: number;
  /** Path to R execution log */
  rLogPath?: string;
  /** Static validation report from R script generation */
  staticValidationReport?: ValidationReport;
  /** Weight variable if dual output was produced */
  weightVariable?: string;
  /** Number of tables in R output JSON */
  rOutputTableCount?: number;
  /** R script size in bytes */
  rScriptSizeBytes: number;
  /** Error message if R execution failed */
  rError?: string;
  /** Error message if Excel export failed */
  excelError?: string;
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

async function finalizeResultsTablesArtifact(
  jsonPath: string,
  computePackage: ComputePackageOutput,
) {
  const jsonContent = fixRHexEscapes(await fs.readFile(jsonPath, 'utf-8'));
  const rawResultsTables = JSON.parse(jsonContent);
  const finalized = buildFinalTablesContract(rawResultsTables, computePackage);
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
  let rSuccess = false;
  let rDurationMs = 0;
  let rLogPath: string | undefined;
  let rError: string | undefined;
  let rOutputTableCount: number | undefined;

  if (abortSignal?.aborted) {
    return {
      rSuccess: false,
      excelSuccess: false,
      masterRPath: masterPath,
      rDurationMs: 0,
      excelDurationMs: 0,
      rScriptSizeBytes: masterScript.length,
      staticValidationReport,
      weightVariable,
      rError: 'Aborted before R execution',
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
    const rCommand = await findRCommand();
    const { stdout, stderr } = await execFileAsync(rCommand, [masterPath], {
      cwd: outputDir,
      maxBuffer: maxBufferBytes,
      timeout: rExecutionTimeoutMs,
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });

    rDurationMs = Date.now() - rStart;
    rLogPath = await saveRLog(computeDir, stdout, stderr, true);
    rSuccess = true;

    // Process R output files
    const resultFiles = await fs.readdir(resultsDir);
    const computePackagePath = path.join(computeDir, '22-compute-package.json');
    const computePackage = JSON.parse(
      await fs.readFile(computePackagePath, 'utf-8'),
    ) as ComputePackageOutput;

    if (weightVariable) {
      // Dual output mode: weighted + unweighted
      const hasWeighted = resultFiles.includes('tables-weighted.json');
      const hasUnweighted = resultFiles.includes('tables-unweighted.json');

      if (hasWeighted && hasUnweighted) {
        const weightedData = await finalizeResultsTablesArtifact(
          path.join(resultsDir, 'tables-weighted.json'),
          computePackage,
        );
        await finalizeResultsTablesArtifact(
          path.join(resultsDir, 'tables-unweighted.json'),
          computePackage,
        );
        rOutputTableCount = Object.keys(weightedData.tables || {}).length;
        log(`[PostV3] R output: tables-weighted.json + tables-unweighted.json (${rOutputTableCount} tables each)`);

        // Streamlined data from weighted
        const streamlinedData = extractStreamlinedData(weightedData);
        await fs.writeFile(
          path.join(resultsDir, 'data-streamlined.json'),
          JSON.stringify(streamlinedData, null, 2),
          'utf-8',
        );
      } else {
        log('[PostV3] WARNING: Expected tables-weighted.json + tables-unweighted.json but not all found');
      }
    } else {
      // Standard single output
      if (resultFiles.includes('tables.json')) {
        const jsonData = await finalizeResultsTablesArtifact(
          path.join(resultsDir, 'tables.json'),
          computePackage,
        );
        rOutputTableCount = Object.keys(jsonData.tables || {}).length;

        log(`[PostV3] R output: tables.json (${rOutputTableCount} tables)`);

        const streamlinedData = extractStreamlinedData(jsonData as Parameters<typeof extractStreamlinedData>[0]);
        await fs.writeFile(
          path.join(resultsDir, 'data-streamlined.json'),
          JSON.stringify(streamlinedData, null, 2),
          'utf-8',
        );
      } else {
        log('[PostV3] WARNING: No tables.json generated');
      }
    }
    log(`[PostV3] R execution: ${rDurationMs}ms`);
  } catch (err) {
    rDurationMs = Date.now() - rStart;
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
      rError = `R output exceeded the ${currentLimitMB} MB buffer limit. Set R_MAX_BUFFER_MB to a higher value (e.g., ${currentLimitMB * 2}) and re-run.`;
    } else {
      rError = signalDescription || errorMsg.substring(0, 500);
    }

    if (errorMsg.includes('command not found') && !errorMsg.includes('Error in')) {
      log('[PostV3] R not installed — script saved for manual execution');
    } else {
      log(`[PostV3] R execution failed: ${rError}`);
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
  // Step 3: Excel Export
  // -------------------------------------------------------------------------
  let excelSuccess = false;
  let excelDurationMs = 0;
  let excelError: string | undefined;

  if (rSuccess) {
    log('[PostV3] Generating Excel workbook...');
    const excelStart = Date.now();

    try {
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

      excelDurationMs = Date.now() - excelStart;
      excelSuccess = true;
      log(`[PostV3] Excel export: ${excelDurationMs}ms`);
    } catch (err) {
      excelDurationMs = Date.now() - excelStart;
      excelError = err instanceof Error ? err.message : String(err);
      log(`[PostV3] Excel generation failed: ${excelError}`);

      try {
        await persistSystemError({
          outputDir,
          dataset,
          pipelineId,
          stageNumber: 11,
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
  }

  return {
    rSuccess,
    excelSuccess,
    masterRPath: masterPath,
    rDurationMs,
    excelDurationMs,
    rLogPath,
    staticValidationReport,
    weightVariable,
    rOutputTableCount,
    rScriptSizeBytes: masterScript.length,
    rError,
    excelError,
  };
}
