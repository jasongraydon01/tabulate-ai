/**
 * Validation Orchestrator
 *
 * @deprecated Depends on VerificationAgent which is deprecated. The V3 compute chain
 * (stages 22–14) generates R scripts from canonical tables with validated structure —
 * the AI-retry loop for R failures is no longer needed. R execution errors in V3 are
 * handled by deterministic error persistence, not agent re-invocation.
 *
 * This file is retained for reference only. Do not invoke from active pipeline code.
 *
 * Original purpose: Orchestrate the validation-retry loop for R table generation.
 * When a table fails R validation, retry with VerificationAgent using error context.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

import type { TableWithLoopFrame } from '../../schemas/verificationAgentSchema';
import type { CutDefinition } from '../tables/CutsSpec';
import type { VerboseDataMapType } from '../../schemas/processingSchemas';
import type { LoopGroupMapping } from '../validation/LoopCollapser';
import { generateSingleTableValidationScript } from './RValidationGenerator';
import { verifyTable, type VerificationInput } from '../../agents/VerificationAgent';
import { persistAgentErrorAuto, persistSystemErrorAuto } from '../errors/ErrorPersistence';
import { fixRHexEscapes } from './fixRHexEscapes';

const execFileAsync = promisify(execFile);

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
// Types
// =============================================================================

export interface ValidationOptions {
  /** Output directory for validation files */
  outputDir: string;
  /** Maximum retry attempts per table (default: 8) */
  maxRetries?: number;
  /** Path to SPSS data file (default: 'dataFile.sav') */
  dataFilePath?: string;
  /** Verbose logging */
  verbose?: boolean;
  /** Loop group mappings for stacked data frame creation */
  loopMappings?: LoopGroupMapping[];
  /** AbortSignal for cancellation support */
  abortSignal?: AbortSignal;
}

export interface TableValidationResult {
  tableId: string;
  success: boolean;
  error?: string;
  rowCount?: number;
}

export interface ValidationReportEntry {
  tableId: string;
  originalError?: string;
  retryAttempts: number;
  finalStatus: 'passed' | 'fixed' | 'excluded';
  fixedOnAttempt?: number;
  excludeReason?: string;
}

export interface ValidationReport {
  totalTables: number;
  passedFirstTime: number;
  fixedAfterRetry: number;
  excluded: number;
  entries: ValidationReportEntry[];
  timestamp: string;
  durationMs: number;
}

export interface ValidateAndFixResult {
  validTables: TableWithLoopFrame[];
  excludedTables: TableWithLoopFrame[];
  validationReport: ValidationReport;
}

// =============================================================================
// Main Orchestrator
// =============================================================================

/**
 * Validate tables through R execution and retry failures with VerificationAgent.
 */
export async function validateAndFixTables(
  tables: TableWithLoopFrame[],
  cuts: CutDefinition[],
  surveyMarkdown: string,
  verboseDataMap: VerboseDataMapType[],
  options: ValidationOptions
): Promise<ValidateAndFixResult> {
  const startTime = Date.now();
  const {
    outputDir,
    maxRetries = 8,
    dataFilePath = 'dataFile.sav',
    verbose = false,
    loopMappings = [],
    abortSignal,
  } = options;

  const log = (msg: string) => {
    if (verbose) console.log(`[ValidationOrchestrator] ${msg}`);
  };

  // Create validation subdirectory
  const validationDir = path.join(outputDir, 'validation');
  await fs.mkdir(validationDir, { recursive: true });

  // Validate ALL tables, including excluded ones
  // Exclusion only affects rendering, not validation - we want to catch errors everywhere
  const tablesToValidate = tables;
  const preExcludedCount = tables.filter(t => t.exclude).length;

  log(`Starting validation: ${tablesToValidate.length} tables (${preExcludedCount} pre-excluded but still validating)`);

  // Build datamap lookup
  const datamapByColumn = new Map<string, VerboseDataMapType>();
  for (const entry of verboseDataMap) {
    datamapByColumn.set(entry.column, entry);
  }

  // Determine paths - validation scripts go in validation/ but R runs from outputDir
  // so dataFile.sav is accessible
  const rWorkingDir = outputDir;  // R runs from here where dataFile.sav is

  // Track results
  const reportEntries: ValidationReportEntry[] = [];
  let passedFirstTime = 0;
  let fixedAfterRetry = 0;

  // Maps to track tables through the process
  const tableMap = new Map<string, TableWithLoopFrame>();
  for (const table of tablesToValidate) {
    tableMap.set(table.tableId, table);
  }

  // -------------------------------------------------------------------------
  // Step 1: Initial Validation (Separate R Script Per Table)
  // -------------------------------------------------------------------------
  log('Running initial validation (separate R scripts per table for resilience)...');

  // Validate each table with its own R script to prevent cascade failures
  const initialResults: Record<string, TableValidationResult> = {};

  for (const table of tablesToValidate) {
    // Check for cancellation before each table
    if (abortSignal?.aborted) {
      log('Validation cancelled before completing all tables');
      break;
    }

    try {
      // Generate individual R script for this table
      const { script, tableId } = generateSingleTableValidationScript(
        table,
        cuts,
        dataFilePath,
        `validation/result-${table.tableId}.json`,
        loopMappings
      );

      const scriptPath = path.join(validationDir, `validation-${table.tableId}.R`);
      await fs.writeFile(scriptPath, script, 'utf-8');

      // Execute this table's validation script
      const result = await executeValidationScript(
        scriptPath,
        rWorkingDir,
        `validation/result-${tableId}.json`,
        log
      );

      // Store result (should have one key: the tableId)
      if (result[tableId]) {
        initialResults[tableId] = result[tableId];
      } else {
        // Fallback if result structure is unexpected
        initialResults[tableId] = {
          tableId,
          success: false,
          error: 'Unexpected validation result structure',
        };
      }
    } catch (error) {
      // Individual table R script failed (syntax error or runtime error)
      const errorMsg = error instanceof Error ? error.message : String(error);
      log(`  Table ${table.tableId} validation failed: ${errorMsg}`);
      initialResults[table.tableId] = {
        tableId: table.tableId,
        success: false,
        error: errorMsg,
      };
    }
  }

  // Parse initial results - no orphans possible with separate scripts
  const failedTables: Array<{ tableId: string; error: string }> = [];

  for (const [tableId, result] of Object.entries(initialResults)) {
    const validationResult = result as TableValidationResult;
    if (validationResult.success) {
      passedFirstTime++;
      reportEntries.push({
        tableId,
        retryAttempts: 0,
        finalStatus: 'passed',
      });
    } else {
      failedTables.push({
        tableId,
        error: validationResult.error || 'Unknown error',
      });
    }
  }

  log(`Initial validation: ${passedFirstTime} passed, ${failedTables.length} failed`);

  // -------------------------------------------------------------------------
  // Step 2: Retry Failed Tables
  // -------------------------------------------------------------------------
  for (const { tableId, error } of failedTables) {
    // Check for cancellation before each table retry
    if (abortSignal?.aborted) {
      log('Validation cancelled - stopping retry loop');
      break;
    }

    const originalTable = tableMap.get(tableId);
    if (!originalTable) {
      log(`Table ${tableId} not found in map, skipping`);
      continue;
    }

    log(`Retrying table ${tableId}: ${error}`);

    let fixed = false;
    let fixedTable: TableWithLoopFrame | null = null;
    let lastError = error;

    for (let attempt = 1; attempt <= maxRetries && !fixed; attempt++) {
      log(`  Attempt ${attempt}/${maxRetries} for ${tableId}...`);

      try {
        // Get datamap context for this table
        const datamapContext = getDatamapContextForTable(originalTable, datamapByColumn);

        // Convert ExtendedTableDefinition back to TableDefinition for VerificationAgent
        // IMPORTANT: Preserve isNet and netComponents so agent knows which rows are NETs
        const tableDefForAgent = {
          tableId: originalTable.tableId,
          questionText: originalTable.questionText,
          tableType: originalTable.tableType,
          rows: originalTable.rows.map(r => ({
            variable: r.variable,
            label: r.label,
            filterValue: r.filterValue,
            // Preserve NET metadata so agent can fix component variables
            isNet: r.isNet,
            netComponents: r.netComponents,
          })),
          hints: [],
        };

        // Call VerificationAgent with error context
        const input: VerificationInput = {
          table: tableDefForAgent,
          existingTable: originalTable,
          questionId: originalTable.questionId,
          questionText: originalTable.questionText,
          surveyMarkdown,
          datamapContext,
          filterContext: {
            additionalFilter: originalTable.additionalFilter,
            baseText: originalTable.baseText,
            splitFromTableId: originalTable.splitFromTableId,
            filterReviewRequired: originalTable.filterReviewRequired,
            tableSubtitle: originalTable.tableSubtitle,
          },
          rValidationError: {
            errorMessage: lastError,
            failedAttempt: attempt,
            maxAttempts: maxRetries,
          },
        };

        const result = await verifyTable(input, abortSignal);

        // Get the first table from the result (assuming no splits for retry)
        if (result.tables.length > 0) {
          // Re-attach loopDataFrame from original table (agent doesn't see this field)
          const candidateTable: TableWithLoopFrame = {
            ...result.tables[0],
            loopDataFrame: originalTable.loopDataFrame,
          };

          // Validate just this table
          const singleValidationResult = await validateSingleTable(
            candidateTable,
            cuts,
            dataFilePath,
            validationDir,
            rWorkingDir,  // R runs from outputDir
            log,
            loopMappings
          );

          if (singleValidationResult.success) {
            log(`  Table ${tableId} fixed on attempt ${attempt}`);
            fixed = true;
            // Preserve FilterApplicator's work (not affected by VerificationAgent retry)
            // These fields were set before retry and should persist
            fixedTable = {
              ...candidateTable,
              additionalFilter: originalTable.additionalFilter,
              filterReviewRequired: originalTable.filterReviewRequired,
              splitFromTableId: originalTable.splitFromTableId,
              sourceTableId: originalTable.sourceTableId,
              isDerived: originalTable.isDerived,
              ...(originalTable.baseText ? { baseText: originalTable.baseText } : {}),
              ...(originalTable.tableSubtitle ? { tableSubtitle: originalTable.tableSubtitle } : {}),
            };
            fixedAfterRetry++;
            reportEntries.push({
              tableId,
              originalError: error,
              retryAttempts: attempt,
              finalStatus: 'fixed',
              fixedOnAttempt: attempt,
            });
          } else {
            lastError = singleValidationResult.error || 'Validation still failing';
            log(`  Attempt ${attempt} still failing: ${lastError}`);
          }
        }
      } catch (retryError) {
        log(`  Attempt ${attempt} error: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
        lastError = retryError instanceof Error ? retryError.message : String(retryError);
        try {
          await persistAgentErrorAuto({
            outputDir,
            agentName: 'VerificationAgent',
            severity: 'error',
            actionTaken: 'continued',
            itemId: tableId,
            error: retryError,
            meta: {
              tableId,
              attempt,
              maxRetries,
              phase: 'r_validation_retry',
            },
          });
        } catch {
          // ignore
        }
      }
    }

    // Update table map with result
    if (fixed && fixedTable) {
      tableMap.set(tableId, fixedTable);
    } else {
      // Mark as excluded
      const excludedTable: TableWithLoopFrame = {
        ...originalTable,
        exclude: true,
        excludeReason: `R validation failed after ${maxRetries} retries: ${lastError}`,
      };
      tableMap.set(tableId, excludedTable);
      reportEntries.push({
        tableId,
        originalError: error,
        retryAttempts: maxRetries,
        finalStatus: 'excluded',
        excludeReason: lastError,
      });
      log(`  Table ${tableId} excluded after ${maxRetries} failed retries`);
    }
  }

  // -------------------------------------------------------------------------
  // Step 3: Build Final Results
  // -------------------------------------------------------------------------
  const validTables: TableWithLoopFrame[] = [];
  const excludedTables: TableWithLoopFrame[] = [];

  for (const table of tableMap.values()) {
    if (table.exclude) {
      excludedTables.push(table);
    } else {
      validTables.push(table);
    }
  }

  const durationMs = Date.now() - startTime;

  const validationReport: ValidationReport = {
    totalTables: tables.length,
    passedFirstTime,
    fixedAfterRetry,
    excluded: excludedTables.length,
    entries: reportEntries,
    timestamp: new Date().toISOString(),
    durationMs,
  };

  // Save validation report
  const reportPath = path.join(validationDir, 'validation-report.json');
  await fs.writeFile(reportPath, JSON.stringify(validationReport, null, 2), 'utf-8');

  log(`Validation complete: ${validTables.length} valid, ${excludedTables.length} excluded`);
  log(`Duration: ${durationMs}ms`);

  return {
    validTables,
    excludedTables,
    validationReport,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Execute a validation R script and return parsed results.
 */
async function executeValidationScript(
  scriptPath: string,
  workingDir: string,
  resultsFileName: string,
  log: (msg: string) => void
): Promise<Record<string, TableValidationResult>> {
  // Find R
  let rCommand = 'Rscript';
  const rPaths = ['/opt/homebrew/bin/Rscript', '/usr/local/bin/Rscript', '/usr/bin/Rscript', 'Rscript'];
  for (const rPath of rPaths) {
    try {
      await execFileAsync(rPath, ['--version'], { timeout: 1000 });
      rCommand = rPath;
      break;
    } catch {
      // Try next
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(
      rCommand,
      [scriptPath],
      {
        cwd: workingDir,
        maxBuffer: 10 * 1024 * 1024,
        timeout: 300000,
        env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
      }  // 5 minute timeout
    );

    // Save logs
    const logPath = path.join(workingDir, 'validation-execution.log');
    await fs.writeFile(logPath, `STDOUT:\n${stdout}\n\nSTDERR:\n${stderr}`, 'utf-8');

    // Parse results
    const resultsPath = path.join(workingDir, resultsFileName);
    const resultsContent = fixRHexEscapes(await fs.readFile(resultsPath, 'utf-8'));
    return JSON.parse(resultsContent) as Record<string, TableValidationResult>;

  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const { signal, signalDescription } = describeProcessSignal(error);
    const errorDescription = signalDescription
      ? `R execution error (${signalDescription}): ${execError.message}`
      : `R execution error: ${execError.message}`;
    log(errorDescription);

    // Save error log
    const errorLogPath = path.join(workingDir, 'validation-error.log');
    await fs.writeFile(
      errorLogPath,
      `ERROR:\n${execError.message}\n\nSIGNAL: ${signal || 'none'}\nDESCRIPTION: ${signalDescription || 'none'}\n\nSTDOUT:\n${execError.stdout || ''}\n\nSTDERR:\n${execError.stderr || ''}`,
      'utf-8'
    );

    // Return empty results - all tables considered failed
    try {
      await persistSystemErrorAuto({
        outputDir: workingDir,
        stageNumber: 8,
        stageName: 'RValidation',
        severity: 'error',
        actionTaken: 'continued',
        error,
        meta: {
          scriptPath: path.relative(workingDir, scriptPath),
          resultsFileName,
          errorLogPath: path.relative(workingDir, errorLogPath),
          signal,
          signalDescription,
        },
      });
    } catch {
      // ignore
    }
    return {};
  }
}

/**
 * Validate a single table after retry.
 */
async function validateSingleTable(
  table: TableWithLoopFrame,
  cuts: CutDefinition[],
  dataFilePath: string,
  validationDir: string,
  rWorkingDir: string,  // R runs from here (outputDir where dataFile.sav is)
  log: (msg: string) => void,
  loopMappings: LoopGroupMapping[] = []
): Promise<TableValidationResult> {
  const tableIdForFile = table.tableId;
  // Results path relative to rWorkingDir
  const resultsRelativePath = `validation/single-${tableIdForFile}-result.json`;

  const { script, tableId } = generateSingleTableValidationScript(
    table,
    cuts,
    dataFilePath,
    resultsRelativePath,
    loopMappings
  );

  const scriptPath = path.join(validationDir, `single-${tableIdForFile}.R`);
  await fs.writeFile(scriptPath, script, 'utf-8');

  // Run R from rWorkingDir (outputDir)
  const results = await executeValidationScript(
    scriptPath,
    rWorkingDir,
    resultsRelativePath,
    log
  );

  // Get result for this table
  const result = results[tableId];
  if (!result) {
    return {
      tableId,
      success: false,
      error: 'No validation result returned',
    };
  }

  return result;
}

/**
 * Get formatted datamap context for variables in a table.
 */
function getDatamapContextForTable(
  table: TableWithLoopFrame,
  datamapByColumn: Map<string, VerboseDataMapType>
): string {
  const variables = new Set<string>();
  for (const row of table.rows) {
    variables.add(row.variable);
    // Also add NET components if present
    if (row.isNet && row.netComponents) {
      for (const comp of row.netComponents) {
        variables.add(comp);
      }
    }
  }

  const entries: string[] = [];
  for (const variable of variables) {
    const entry = datamapByColumn.get(variable);
    if (entry) {
      entries.push(
        `${variable}:
  Description: ${entry.description}
  Type: ${entry.normalizedType || 'unknown'}
  Values: ${entry.valueType}
  ${entry.scaleLabels ? `Scale Labels: ${JSON.stringify(entry.scaleLabels)}` : ''}
  ${entry.allowedValues ? `Allowed Values: ${entry.allowedValues.join(', ')}` : ''}`
      );
    }
  }

  return entries.length > 0 ? entries.join('\n\n') : 'No datamap context available';
}
