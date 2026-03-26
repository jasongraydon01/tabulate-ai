/**
 * R Validation Script Generator
 *
 * Purpose: Generate R scripts that validate each table individually using tryCatch().
 * This allows us to identify which tables fail without crashing the entire script.
 *
 * Key features:
 * - Wraps each table's calculation in tryCatch()
 * - Outputs validation-results.json with success/failure per table
 * - Enables targeted retries for failed tables only
 */

import type { ExtendedTableRow, TableWithLoopFrame } from '../../schemas/verificationAgentSchema';
import type { CutDefinition } from '../tables/CutsSpec';
import {
  escapeRString,
  sanitizeVarName,
  generateStackingPreamble,
} from './RScriptGeneratorV2';
import { sanitizeRExpression } from './sanitizeRExpression';
import type { LoopGroupMapping } from '../validation/LoopCollapser';

// =============================================================================
// Types
// =============================================================================

export interface ValidationScriptResult {
  script: string;
  tableIds: string[];
}

export interface SingleTableValidationResult {
  script: string;
  tableId: string;
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate a validation R script that tests all tables with tryCatch().
 * Each table is tested independently, and results are written to validation-results.json.
 */
export function generateValidationScript(
  tables: TableWithLoopFrame[],
  cuts: CutDefinition[],
  dataFilePath: string = 'dataFile.sav',
  outputPath: string = 'validation-results.json',
  loopMappings: LoopGroupMapping[] = []
): ValidationScriptResult {
  const lines: string[] = [];
  const tableIds: string[] = [];

  // Validate ALL tables, including excluded ones
  // Exclusion only affects rendering, not validation - we want to catch errors everywhere
  const tablesToValidate = tables;

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------
  lines.push('# TabulateAI - R Validation Script');
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Tables to validate: ${tablesToValidate.length}`);
  lines.push('');

  // -------------------------------------------------------------------------
  // Libraries
  // -------------------------------------------------------------------------
  lines.push('# Load required libraries');
  lines.push('library(haven)');
  lines.push('library(dplyr)');
  lines.push('library(jsonlite)');
  lines.push('');

  // -------------------------------------------------------------------------
  // Load Data
  // -------------------------------------------------------------------------
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
  lines.push('print(paste("Loaded", nrow(data), "rows and", ncol(data), "columns"))');
  lines.push('');

  // -------------------------------------------------------------------------
  // Loop Stacking (if loops detected)
  // -------------------------------------------------------------------------
  if (loopMappings.length > 0) {
    generateStackingPreamble(lines, loopMappings, cuts);
  }

  // -------------------------------------------------------------------------
  // Cuts Definition
  // -------------------------------------------------------------------------
  generateCutsDefinitionMinimal(lines, cuts);

  // -------------------------------------------------------------------------
  // Helper Functions
  // -------------------------------------------------------------------------
  generateHelperFunctionsMinimal(lines);

  // -------------------------------------------------------------------------
  // Validation Results Container
  // -------------------------------------------------------------------------
  lines.push('# Initialize validation results');
  lines.push('validation_results <- list()');
  lines.push('');

  // -------------------------------------------------------------------------
  // Validate Each Table
  // -------------------------------------------------------------------------
  lines.push('# =============================================================================');
  lines.push('# Table Validation (each wrapped in tryCatch)');
  lines.push('# =============================================================================');
  lines.push('');

  for (const table of tablesToValidate) {
    tableIds.push(table.tableId);
    generateTableValidation(lines, table);
  }

  // -------------------------------------------------------------------------
  // Write Results
  // -------------------------------------------------------------------------
  lines.push('# =============================================================================');
  lines.push('# Write Validation Results');
  lines.push('# =============================================================================');
  lines.push('');
  lines.push(`write_json(validation_results, "${outputPath}", pretty = TRUE, auto_unbox = TRUE)`);
  lines.push(`print(paste("Validation results written to:", "${outputPath}"))`);
  lines.push('');
  lines.push('# Summary');
  lines.push('success_count <- sum(sapply(validation_results, function(x) x$success))');
  lines.push('fail_count <- length(validation_results) - success_count');
  lines.push('print(paste("Validation complete:", success_count, "passed,", fail_count, "failed"))');

  return {
    script: lines.join('\n'),
    tableIds,
  };
}

/**
 * Generate a validation script for a single table (used for retry validation).
 * This is a minimal script that only tests one table.
 */
export function generateSingleTableValidationScript(
  table: TableWithLoopFrame,
  cuts: CutDefinition[],
  dataFilePath: string = 'dataFile.sav',
  outputPath: string = 'single-validation-result.json',
  loopMappings: LoopGroupMapping[] = []
): SingleTableValidationResult {
  const lines: string[] = [];

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------
  lines.push('# TabulateAI - Single Table Validation');
  lines.push(`# Table: ${table.tableId}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push('');

  // -------------------------------------------------------------------------
  // Libraries
  // -------------------------------------------------------------------------
  lines.push('library(haven)');
  lines.push('library(dplyr)');
  lines.push('library(jsonlite)');
  lines.push('');

  // -------------------------------------------------------------------------
  // Load Data (with encoding fallback)
  // -------------------------------------------------------------------------
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
  lines.push('');

  // -------------------------------------------------------------------------
  // Loop Stacking (if this table uses a loop frame)
  // -------------------------------------------------------------------------
  if (table.loopDataFrame && loopMappings.length > 0) {
    // Only generate stacking for the specific loop group this table needs
    const neededMapping = loopMappings.find(m => m.stackedFrameName === table.loopDataFrame);
    if (neededMapping) {
      generateStackingPreamble(lines, [neededMapping], cuts);
    }
  }

  // -------------------------------------------------------------------------
  // Cuts Definition (minimal)
  // -------------------------------------------------------------------------
  generateCutsDefinitionMinimal(lines, cuts);

  // -------------------------------------------------------------------------
  // Helper Functions
  // -------------------------------------------------------------------------
  generateHelperFunctionsMinimal(lines);

  // -------------------------------------------------------------------------
  // Validate Single Table
  // -------------------------------------------------------------------------
  lines.push('validation_results <- list()');
  lines.push('');
  generateTableValidation(lines, table);

  // -------------------------------------------------------------------------
  // Write Result
  // -------------------------------------------------------------------------
  lines.push(`write_json(validation_results, "${outputPath}", pretty = TRUE, auto_unbox = TRUE)`);

  return {
    script: lines.join('\n'),
    tableId: table.tableId,
  };
}

// =============================================================================
// Table Validation Generator
// =============================================================================

function generateTableValidation(lines: string[], table: TableWithLoopFrame): void {
  const tableId = escapeRString(table.tableId);
  const varName = sanitizeVarName(table.tableId);
  const sanitizedFrame = table.loopDataFrame ? sanitizeVarName(table.loopDataFrame) : '';
  const frameName = sanitizedFrame || 'data';

  lines.push(`# -----------------------------------------------------------------------------`);
  lines.push(`# Table: ${table.tableId} (${table.tableType})${sanitizedFrame ? ` [loop: ${sanitizedFrame}]` : ''}`);
  lines.push(`# -----------------------------------------------------------------------------`);
  lines.push('');

  lines.push(`validation_results[["${tableId}"]] <- tryCatch({`);
  lines.push('');

  if (table.tableType === 'frequency') {
    generateFrequencyTableValidation(lines, table, varName, frameName);
  } else if (table.tableType === 'mean_rows') {
    generateMeanRowsTableValidation(lines, table, varName, frameName);
  }

  lines.push('');
  lines.push(`  list(success = TRUE, tableId = "${tableId}", rowCount = ${table.rows.length})`);
  lines.push('');
  lines.push('}, error = function(e) {');
  lines.push(`  list(success = FALSE, tableId = "${tableId}", error = conditionMessage(e))`);
  lines.push('})');
  lines.push('');
  lines.push(`print(paste("Validated:", "${tableId}", "-", if(validation_results[["${tableId}"]]$success) "PASS" else paste("FAIL:", validation_results[["${tableId}"]]$error)))`);
  lines.push('');
}

function generateFrequencyTableValidation(
  lines: string[],
  table: TableWithLoopFrame,
  _varName: string,
  frameName: string = 'data'
): void {
  // For each row, validate that the variable exists and filterValue works
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i] as ExtendedTableRow;
    const varNameEscaped = escapeRString(row.variable);
    const filterValue = row.filterValue;

    // Skip category headers - they have no data to validate (visual grouping only)
    // Check for _CAT_ sentinel variable (filterValue doesn't matter - could be _HEADER_, _HEADER_CONNECTION, etc.)
    if (row.variable === '_CAT_') {
      lines.push(`  # Row ${i + 1}: Category header - ${row.label} (skip validation)`);
      continue;
    }

    // Check if this is a NET with components
    const isNetWithComponents = row.isNet && row.netComponents && row.netComponents.length > 0;

    if (isNetWithComponents) {
      // NET row: validate all component variables exist
      lines.push(`  # Row ${i + 1}: NET - ${row.label}`);
      for (const comp of row.netComponents) {
        const compEscaped = escapeRString(comp);
        lines.push(`  if (!("${compEscaped}" %in% names(${frameName}))) stop("NET component variable '${compEscaped}' not found")`);
      }
    } else {
      // Standard row: validate variable exists and filterValue is valid
      lines.push(`  # Row ${i + 1}: ${row.variable} == ${filterValue}`);
      lines.push(`  if (!("${varNameEscaped}" %in% names(${frameName}))) stop("Variable '${varNameEscaped}' not found")`);

      // Check for range pattern (e.g., "0-4", "10-35")
      const rangeMatch = filterValue.match(/^(\d+)-(\d+)$/);
      // Check for multiple values (e.g., "4,5")
      const filterValues = filterValue.split(',').map(v => v.trim()).filter(v => v);
      const hasMultipleValues = filterValues.length > 1;

      if (rangeMatch) {
        // Range validation
        const [, minVal, maxVal] = rangeMatch;
        lines.push(`  test_val <- sum(as.numeric(${frameName}[["${varNameEscaped}"]]) >= ${minVal} & as.numeric(${frameName}[["${varNameEscaped}"]]) <= ${maxVal}, na.rm = TRUE)`);
      } else if (hasMultipleValues) {
        // Multiple values validation
        lines.push(`  test_val <- sum(as.numeric(${frameName}[["${varNameEscaped}"]]) %in% c(${filterValues.join(', ')}), na.rm = TRUE)`);
      } else if (filterValue && filterValue.trim() !== '') {
        // Single value validation - try numeric conversion
        lines.push(`  test_val <- sum(as.numeric(${frameName}[["${varNameEscaped}"]]) == ${filterValue}, na.rm = TRUE)`);
      }
    }
  }
}

function generateMeanRowsTableValidation(
  lines: string[],
  table: TableWithLoopFrame,
  _varName: string,
  frameName: string = 'data'
): void {
  // For mean_rows, validate that all variables exist and are numeric-like
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i] as ExtendedTableRow;
    const varNameEscaped = escapeRString(row.variable);

    // Check if this is a NET with components
    const isNetWithComponents = row.isNet && row.netComponents && row.netComponents.length > 0;

    if (isNetWithComponents) {
      // NET row: validate all component variables exist and are numeric
      lines.push(`  # Row ${i + 1}: NET - ${row.label} (sum of component means)`);
      for (const comp of row.netComponents) {
        const compEscaped = escapeRString(comp);
        lines.push(`  if (!("${compEscaped}" %in% names(${frameName}))) stop("NET component variable '${compEscaped}' not found")`);
        lines.push(`  test_vals <- ${frameName}[["${compEscaped}"]]`);
        lines.push(`  if (!is.numeric(test_vals) && !inherits(test_vals, "haven_labelled")) {`);
        lines.push(`    stop("NET component '${compEscaped}' is not numeric (type: ", class(test_vals)[1], ")")`);
        lines.push(`  }`);
      }
    } else {
      // Standard row: validate variable exists and is numeric
      lines.push(`  # Row ${i + 1}: ${row.variable} (mean)`);
      lines.push(`  if (!("${varNameEscaped}" %in% names(${frameName}))) stop("Variable '${varNameEscaped}' not found")`);
      lines.push(`  test_vals <- ${frameName}[["${varNameEscaped}"]]`);
      lines.push(`  if (!is.numeric(test_vals) && !inherits(test_vals, "haven_labelled")) {`);
      lines.push(`    stop("Variable '${varNameEscaped}' is not numeric (type: ", class(test_vals)[1], ")")`);
      lines.push(`  }`);
    }
  }
}

// =============================================================================
// Minimal Cuts Definition (for validation only)
// =============================================================================

function generateCutsDefinitionMinimal(lines: string[], cuts: CutDefinition[]): void {
  // Wrap each cut in tryCatch so a bad cut expression (e.g., quantile on haven_labelled)
  // doesn't crash the entire validation script. Failed cuts become all-FALSE (empty columns)
  // and the table can still validate with other cuts.
  lines.push('# Cuts Definition (each wrapped in tryCatch for resilience)');
  lines.push('if (!exists(".hawktab_cut_errors", inherits = FALSE)) .hawktab_cut_errors <- c()');
  lines.push('if (!exists("safe_quantile", mode = "function")) safe_quantile <- function(x, ...) quantile(as.numeric(x), ...)');
  lines.push('cuts <- list(');
  lines.push('  Total = rep(TRUE, nrow(data))');

  for (const cut of cuts) {
    let expr = cut.rExpression.replace(/^\s*#.*$/gm, '').trim();
    if (expr && !expr.startsWith('#')) {
      // Validate expression against dangerous R functions before interpolation
      const sanitizeResult = sanitizeRExpression(expr);
      if (!sanitizeResult.safe) {
        console.warn(`[RValidationGen] Blocked unsafe cut expression "${cut.name}": ${sanitizeResult.error}`);
        continue;
      }
      // Replace quantile() with safe_quantile() to handle haven_labelled vectors
      expr = expr.replace(/\bquantile\s*\(/g, 'safe_quantile(');
      const safeName = cut.name.replace(/`/g, "'");
      lines.push(`,  \`${safeName}\` = tryCatch(with(data, ${expr}), error = function(e) {`);
      lines.push(`    .hawktab_cut_errors <<- c(.hawktab_cut_errors, paste0("Cut '${safeName}': ", e$message))`);
      lines.push(`    rep(FALSE, nrow(data))`);
      lines.push(`  })`);
    }
  }

  lines.push(')');
  lines.push('if (length(.hawktab_cut_errors) > 0) {');
  lines.push('  cat("\\nWARNING: Cut expression errors (columns will be empty):\\n")');
  lines.push('  for (err in .hawktab_cut_errors) cat("  -", err, "\\n")');
  lines.push('}');
  lines.push('');
}

// =============================================================================
// Minimal Helper Functions
// =============================================================================

function generateHelperFunctionsMinimal(lines: string[]): void {
  lines.push('# Apply cut mask safely');
  lines.push('apply_cut <- function(data, cut_mask) {');
  lines.push('  safe_mask <- cut_mask');
  lines.push('  safe_mask[is.na(safe_mask)] <- FALSE');
  lines.push('  data[safe_mask, ]');
  lines.push('}');
  lines.push('');

  lines.push('# Safely get variable column');
  lines.push('safe_get_var <- function(data, var_name) {');
  lines.push('  if (var_name %in% names(data)) return(data[[var_name]])');
  lines.push('  return(NULL)');
  lines.push('}');
  lines.push('');

  // Safe quantile for haven-labelled vectors
  lines.push('# Safe quantile that handles haven_labelled vectors');
  lines.push('safe_quantile <- function(x, ...) {');
  lines.push('  quantile(as.numeric(x), ...)');
  lines.push('}');
  lines.push('');
}
