/**
 * Cut Expression Validator
 *
 * Purpose: Validate CrosstabAgent R expressions against the actual .sav data BEFORE
 * generating the full R script. Catches bad expressions early (wrong variable types,
 * quantile on categorical vars, haven_labelled issues) and enables targeted retries.
 *
 * Pattern: Same R subprocess approach as RDataReader.executeRScript.
 * Runs in <10 seconds — just loads data once and evaluates boolean masks.
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync, readFileSync } from 'fs';
import { mkdirSync } from 'fs';
import path from 'path';
import type { ValidationResultType } from '../../schemas/agentOutputSchema';
import { sanitizeRExpression } from './sanitizeRExpression';

// =============================================================================
// Types
// =============================================================================

export interface CutValidationResult {
  cutName: string;
  groupName: string;
  rExpression: string;
  success: boolean;
  error?: string;         // R error message
  trueCount?: number;     // How many rows matched (sanity check)
}

export interface CutValidationReport {
  totalCuts: number;
  passed: number;
  failed: number;
  results: CutValidationResult[];
  failedByGroup: Map<string, CutValidationResult[]>;
  durationMs: number;
}

// =============================================================================
// R Command Discovery (same as RDataReader)
// =============================================================================

const R_PATHS = [
  '/opt/homebrew/bin/Rscript',
  '/usr/local/bin/Rscript',
  '/usr/bin/Rscript',
  'Rscript',
];

function findRCommand(): string {
  for (const rPath of R_PATHS) {
    if (rPath === 'Rscript' || existsSync(rPath)) {
      return rPath;
    }
  }
  return 'Rscript';
}

// =============================================================================
// R Script Generation
// =============================================================================

/**
 * Escape a string for safe embedding in R code (single-quoted context).
 */
function escapeForR(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Generate a lightweight R script that tests each cut expression with tryCatch().
 * Returns the script content as a string.
 */
export function generateCutValidationScript(
  validation: ValidationResultType,
  dataFilePath: string = 'dataFile.sav',
  outputPath: string = 'validation/cut-validation-results.json'
): string {
  const lines: string[] = [];

  // Header
  lines.push('# TabulateAI - Cut Expression Validation Script');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');

  // Libraries
  lines.push('library(haven)');
  lines.push('library(jsonlite)');
  lines.push('');

  // Load data with encoding fallback
  lines.push('# Load SPSS data file (with encoding fallback)');
  lines.push(`data <- tryCatch(`);
  lines.push(`  read_sav("${dataFilePath}"),`);
  lines.push('  error = function(e) {');
  lines.push('    if (grepl("iconv|encoding|translat", e$message, ignore.case = TRUE)) {');
  lines.push('      cat("WARNING: Encoding error, retrying with encoding=\'latin1\'\\n")');
  lines.push(`      read_sav("${dataFilePath}", encoding = "latin1")`);
  lines.push('    } else {');
  lines.push('      stop(e)');
  lines.push('    }');
  lines.push('  }');
  lines.push(')');
  lines.push('cat(paste("Loaded", nrow(data), "rows and", ncol(data), "columns\\n"))');
  lines.push('');

  // safe_quantile helper
  lines.push('# Helper: safe quantile that coerces haven_labelled');
  lines.push('safe_quantile <- function(x, ...) quantile(as.numeric(x), ...)');
  lines.push('');

  // Results list
  lines.push('results <- list()');
  lines.push('');

  // Generate a tryCatch block for each cut expression
  let cutIndex = 0;
  for (const group of validation.bannerCuts) {
    for (const col of group.columns) {
      // Skip zero-confidence columns (already known to be broken)
      if (col.confidence === 0) continue;

      // Skip Total columns
      if (col.name === 'Total' || group.groupName === 'Total') continue;

      // Skip error/comment fallbacks
      if (col.adjusted.trim().startsWith('#')) continue;

      const key = `cut_${cutIndex}`;
      const cutName = escapeForR(col.name);
      const groupName = escapeForR(group.groupName);
      const rExpr = col.adjusted;

      // Validate expression against dangerous R functions before interpolation
      const sanitizeResult = sanitizeRExpression(rExpr);
      if (!sanitizeResult.safe) {
        console.warn(`[CutValidator] Blocked unsafe expression for [${group.groupName}] ${col.name}: ${sanitizeResult.error}`);
        lines.push(`# [${group.groupName}] ${col.name} — BLOCKED: ${sanitizeResult.error}`);
        lines.push(`results[["${key}"]] <- list(success = FALSE, cutName = '${cutName}', groupName = '${groupName}',`);
        lines.push(`     rExpression = 'BLOCKED', error = '${escapeForR(sanitizeResult.error || 'unsafe expression')}')`);
        lines.push('');
        cutIndex++;
        continue;
      }

      lines.push(`# [${group.groupName}] ${col.name}`);
      lines.push(`results[["${key}"]] <- tryCatch({`);
      lines.push(`  mask <- with(data, ${rExpr})`);
      lines.push(`  if (!is.logical(mask) && !is.numeric(mask)) {`);
      lines.push(`    stop(paste0("Expression returned ", class(mask)[1], ", expected logical or numeric"))`);
      lines.push(`  }`);
      lines.push(`  if (length(mask) != nrow(data)) {`);
      lines.push(`    stop(paste0("Expression returned length ", length(mask), ", expected ", nrow(data)))`);
      lines.push(`  }`);
      lines.push(`  list(success = TRUE, cutName = '${cutName}', groupName = '${groupName}',`);
      lines.push(`       rExpression = '${escapeForR(rExpr)}', trueCount = sum(mask, na.rm = TRUE))`);
      lines.push(`}, error = function(e) {`);
      lines.push(`  list(success = FALSE, cutName = '${cutName}', groupName = '${groupName}',`);
      lines.push(`       rExpression = '${escapeForR(rExpr)}', error = conditionMessage(e))`);
      lines.push(`})`);
      lines.push('');

      cutIndex++;
    }
  }

  // Write results to JSON
  lines.push(`# Ensure output directory exists`);
  lines.push(`output_dir <- dirname("${outputPath}")`);
  lines.push(`if (!dir.exists(output_dir)) dir.create(output_dir, recursive = TRUE)`);
  lines.push('');
  lines.push(`write_json(results, "${outputPath}", pretty = TRUE, auto_unbox = TRUE)`);
  lines.push(`cat(paste("Validated", length(results), "cut expressions\\n"))`);

  return lines.join('\n');
}

// =============================================================================
// R Script Execution
// =============================================================================

/**
 * Execute an R script and return stdout.
 * Same pattern as RDataReader.executeRScript with timeout + cleanup.
 */
function executeRScript(
  scriptContent: string,
  scriptPath: string,
  cwd: string
): Promise<string> {
  writeFileSync(scriptPath, scriptContent);
  const rCommand = findRCommand();

  const TIMEOUT_MS = 60_000;
  const GRACE_MS = 5_000;

  return new Promise((resolve, reject) => {
    const proc = spawn(rCommand, [scriptPath], { cwd });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let graceTimer: ReturnType<typeof setTimeout> | null = null;

    const killTimer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
      graceTimer = setTimeout(() => {
        proc.kill('SIGKILL');
      }, GRACE_MS);
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d: Buffer) => (stdout += d));
    proc.stderr.on('data', (d: Buffer) => (stderr += d));

    proc.on('close', (code) => {
      clearTimeout(killTimer);
      if (graceTimer) clearTimeout(graceTimer);

      if (timedOut) {
        reject(new Error(`Cut validation R script timed out after ${TIMEOUT_MS / 1000}s`));
      } else if (code !== 0) {
        reject(new Error(`Cut validation R script failed (code ${code}): ${stderr}`));
      } else {
        resolve(stdout);
      }
    });

    proc.on('error', (err) => {
      clearTimeout(killTimer);
      if (graceTimer) clearTimeout(graceTimer);
      reject(new Error(`Failed to spawn R process: ${err.message}`));
    });
  });
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Validate all cut expressions from CrosstabAgent output by running them against
 * the actual .sav data. Returns a report with per-cut pass/fail and R error messages.
 *
 * @param validation - CrosstabAgent output (bannerCuts with R expressions)
 * @param outputDir  - Pipeline output directory (CWD for R script, writes artifacts here)
 * @param dataFilePath - Path to .sav file relative to outputDir (default: 'dataFile.sav')
 */
export async function validateCutExpressions(
  validation: ValidationResultType,
  outputDir: string,
  dataFilePath: string = 'dataFile.sav'
): Promise<CutValidationReport> {
  const startTime = Date.now();

  // Ensure validation subdirectory exists
  const validationDir = path.join(outputDir, 'validation');
  mkdirSync(validationDir, { recursive: true });

  const scriptPath = path.join(outputDir, 'validation', '_cut-validation.R');
  const resultsRelPath = 'validation/cut-validation-results.json';
  const resultsAbsPath = path.join(outputDir, resultsRelPath);

  // Generate and execute the R script
  const script = generateCutValidationScript(validation, dataFilePath, resultsRelPath);
  await executeRScript(script, scriptPath, outputDir);

  // Parse results
  if (!existsSync(resultsAbsPath)) {
    throw new Error(`Cut validation results not found at ${resultsAbsPath}`);
  }

  const rawJson = readFileSync(resultsAbsPath, 'utf-8');
  const rawResults: Record<string, {
    success: boolean;
    cutName: string;
    groupName: string;
    rExpression: string;
    error?: string;
    trueCount?: number;
  }> = JSON.parse(rawJson);

  // Build structured results
  const results: CutValidationResult[] = [];
  const failedByGroup = new Map<string, CutValidationResult[]>();

  for (const [, entry] of Object.entries(rawResults)) {
    const result: CutValidationResult = {
      cutName: entry.cutName,
      groupName: entry.groupName,
      rExpression: entry.rExpression,
      success: entry.success,
      error: entry.error,
      trueCount: entry.trueCount,
    };
    results.push(result);

    if (!result.success) {
      const existing = failedByGroup.get(result.groupName) || [];
      existing.push(result);
      failedByGroup.set(result.groupName, existing);
    }
  }

  const passed = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  // Clean up the script file (keep results JSON for debugging)
  try { unlinkSync(scriptPath); } catch { /* ignore */ }

  return {
    totalCuts: results.length,
    passed,
    failed,
    results,
    failedByGroup,
    durationMs: Date.now() - startTime,
  };
}
