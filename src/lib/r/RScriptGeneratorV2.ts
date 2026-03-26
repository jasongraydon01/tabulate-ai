/**
 * R Script Generator V2
 *
 * Purpose: Generate R script that consumes VerificationAgent output and produces JSON
 *
 * Key features:
 * - Input: ExtendedTableDefinition[] (from VerificationAgent) + CutDefinition[] with stat testing info
 * - Output: JSON file with calculations and significance testing
 * - Two table types: frequency and mean_rows
 * - Correct base sizing: always rebase on who answered the question
 * - Significance testing: z-test for proportions, t-test for means
 * - Within-group comparisons + comparison to Total column
 * - Handles ExtendedTableRow fields: isNet, netComponents, indent, comma-separated filterValues
 *
 * Note: Derived tables (T2B, Top 3) are now created by VerificationAgent, not here.
 */

import type { ExtendedTableDefinition, ExtendedTableRow, TableWithLoopFrame } from '../../schemas/verificationAgentSchema';
import type { CutDefinition, CutGroup } from '../tables/CutsSpec';
import type { StatTestingConfig } from '../env';
import { sanitizeRExpression } from './sanitizeRExpression';
import type { LoopGroupMapping } from '../validation/LoopCollapser';
import type { LoopSemanticsPolicy, BannerGroupPolicy } from '../../schemas/loopSemanticsPolicySchema';
import type { CompiledLoopContract, CompiledGroupEntry } from '../../schemas/compiledLoopContractSchema';
import { transformCutForAlias, validateTransformedCuts } from './transformStackedCuts';
import { sortTables } from '../tables/sortTables';

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get target frames from a compiled group entry, with backward compatibility
 * for persisted contracts that only have the deprecated `targetFrame` field.
 */
function getTargetFrames(g: CompiledGroupEntry): string[] {
  if (g.targetFrames && g.targetFrames.length > 0) return g.targetFrames;
  return g.targetFrame ? [g.targetFrame] : [];
}

// =============================================================================
// Types
// =============================================================================

/**
 * Banner group structure for Excel formatter metadata
 */
export interface BannerGroupColumn {
  name: string;
  statLetter: string;
}

export interface BannerGroup {
  groupName: string;
  columns: BannerGroupColumn[];
}

export interface RScriptV2Input {
  tables: TableWithLoopFrame[];  // Tables with loopDataFrame attached by PipelineRunner
  cuts: CutDefinition[];
  cutGroups?: CutGroup[];           // Group structure for within-group stat testing
  totalStatLetter?: string | null;  // Letter for Total column (usually "T")
  dataFilePath?: string;            // Default: "dataFile.sav"
  significanceLevel?: number;       // Default: 0.10 (90% confidence) - kept for backward compat
  significanceThresholds?: number[];  // NEW: [0.05, 0.10] for 95%/90% dual thresholds
  totalRespondents?: number;        // Total qualified respondents (for base description)
  bannerGroups?: BannerGroup[];     // Banner structure for Excel formatter
  statTestingConfig?: StatTestingConfig;  // Full stat testing configuration
  loopMappings?: LoopGroupMapping[];     // Loop stacking mappings (from LoopCollapser)
  loopSemanticsPolicy?: LoopSemanticsPolicy;  // Per-banner-group loop classification
  compiledLoopContract?: CompiledLoopContract;  // Compiled loop contract (preferred over raw policy)
  loopStatTestingMode?: 'suppress' | 'complement';  // Override for entity-anchored group comparisons
  weightVariable?: string;  // Weight variable column name (e.g., "wt") for weighted output
  maxRespondents?: number;  // Demo mode: truncate data to first N respondents
}

export interface RScriptV2Options {
  sessionId?: string;
  outputDir?: string;  // Default: "results"
}

// =============================================================================
// Table Validation Types
// =============================================================================

/**
 * Result of validating a single table
 */
export interface TableValidationResult {
  tableId: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Summary of all table validations
 */
export interface ValidationReport {
  totalTables: number;
  validTables: number;
  invalidTables: number;
  skippedTables: TableValidationResult[];
  warnings: TableValidationResult[];
}

/**
 * Extended return type that includes validation info
 */
export interface RScriptV2Result {
  script: string;
  validation: ValidationReport;
}

// =============================================================================
// Table Validation Functions
// =============================================================================

/**
 * Valid table types that the R script generator can handle
 */
const VALID_TABLE_TYPES = ['frequency', 'mean_rows'] as const;

/**
 * Validate a single table definition before R code generation.
 * Returns errors that would cause R script failure and warnings for potential issues.
 */
export function validateTable(table: ExtendedTableDefinition): TableValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  function isSingleValueNet(row: ExtendedTableDefinition['rows'][number]): boolean {
    if (!row.isNet && row.rowKind !== 'net') return false;
    if (!row.filterValue || row.filterValue.includes(',')) return false;
    return true;
  }

  function isBenignSingletonNetDuplicate(
    current: ExtendedTableDefinition['rows'][number],
    previous: ExtendedTableDefinition['rows'][number] | undefined,
  ): boolean {
    if (!previous) return false;
    if (`${previous.variable}:${previous.filterValue}` !== `${current.variable}:${current.filterValue}`) {
      return false;
    }

    const currentIsSingletonNet = isSingleValueNet(current);
    const previousIsSingletonNet = isSingleValueNet(previous);
    const currentIsValue = current.rowKind !== 'stat' && current.rowKind !== 'not_answered' && !current.isNet;
    const previousIsValue = previous.rowKind !== 'stat' && previous.rowKind !== 'not_answered' && !previous.isNet;

    return (
      (currentIsSingletonNet && previousIsValue)
      || (previousIsSingletonNet && currentIsValue)
    );
  }

  // Check tableType is valid
  if (!VALID_TABLE_TYPES.includes(table.tableType as typeof VALID_TABLE_TYPES[number])) {
    errors.push(`Invalid tableType "${table.tableType}". Must be "frequency" or "mean_rows".`);
  }

  // Check rows exist
  if (!table.rows || table.rows.length === 0) {
    errors.push('Table has no rows.');
  }

  // Validate rows based on tableType
  if (table.tableType === 'frequency') {
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];

      // For frequency tables, filterValue must not be empty (unless it's a NET with netComponents or a category header)
      const isNetWithComponents = row.isNet && row.netComponents && row.netComponents.length > 0;
      const isCategoryHeader = row.variable === '_CAT_';
      // Stat rows (Mean, Median, etc.) and not_answered rows (Not Ranked) are
      // handled by separate R code paths — filterValue is not required.
      const isStatRow = row.rowKind === 'stat';
      const isNotAnsweredRow = row.rowKind === 'not_answered';
      if (!row.filterValue && !isNetWithComponents && !isCategoryHeader && !isStatRow && !isNotAnsweredRow) {
        errors.push(`Row ${i + 1} (${row.variable}): Empty filterValue on frequency table. This will generate invalid R code.`);
      }

      // Check variable name exists
      if (!row.variable) {
        errors.push(`Row ${i + 1}: Missing variable name.`);
      }
    }
  } else if (table.tableType === 'mean_rows') {
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];

      // For mean_rows, filterValue should be empty
      if (row.filterValue && row.filterValue.trim() !== '') {
        warnings.push(`Row ${i + 1} (${row.variable}): Non-empty filterValue "${row.filterValue}" on mean_rows table. Will be ignored.`);
      }

      // Check variable name exists
      if (!row.variable) {
        errors.push(`Row ${i + 1}: Missing variable name.`);
      }
    }
  }

  // Check for duplicate row keys (variable + filterValue combination for frequency)
  // Note: Category headers, stat rows, and not_answered rows are exempt from uniqueness checks
  if (table.tableType === 'frequency') {
    const seen = new Map<string, ExtendedTableDefinition['rows'][number]>();
    for (let i = 0; i < table.rows.length; i++) {
      const row = table.rows[i];
      // Skip rows that don't participate in frequency counting
      const isCategoryHeader = row.variable === '_CAT_';
      const isStatRow = row.rowKind === 'stat';
      const isNotAnsweredRow = row.rowKind === 'not_answered';
      if (isCategoryHeader || isStatRow || isNotAnsweredRow) {
        continue;
      }
      const key = `${row.variable}:${row.filterValue}`;
      const previous = seen.get(key);
      if (previous && !isBenignSingletonNetDuplicate(row, previous)) {
        warnings.push(`Row ${i + 1}: Duplicate variable/filterValue combination "${key}".`);
      }
      if (!previous) {
        seen.set(key, row);
      }
    }
  }

  return {
    tableId: table.tableId,
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Validate all tables and return a validation report.
 * Invalid tables will be filtered out with logged warnings.
 */
export function validateAllTables<T extends ExtendedTableDefinition>(
  tables: T[]
): { validTables: T[]; report: ValidationReport } {
  const validTables: T[] = [];
  const skippedTables: TableValidationResult[] = [];
  const tablesWithWarnings: TableValidationResult[] = [];

  for (const table of tables) {
    // Validate ALL tables, including excluded ones
    // Exclusion only affects rendering, not validation - we want to catch errors everywhere
    const validation = validateTable(table);

    if (validation.valid) {
      validTables.push(table);
      if (validation.warnings.length > 0) {
        tablesWithWarnings.push(validation);
      }
    } else {
      // Log validation errors
      console.error(`[RScriptGeneratorV2] Skipping invalid table "${table.tableId}":`);
      for (const error of validation.errors) {
        console.error(`  - ${error}`);
      }
      skippedTables.push(validation);
    }

    // Log warnings even for valid tables
    if (validation.warnings.length > 0) {
      console.warn(`[RScriptGeneratorV2] Warnings for table "${table.tableId}":`);
      for (const warning of validation.warnings) {
        console.warn(`  - ${warning}`);
      }
    }
  }

  const report: ValidationReport = {
    totalTables: tables.length,
    validTables: validTables.filter(t => !t.exclude).length,
    invalidTables: skippedTables.length,
    skippedTables,
    warnings: tablesWithWarnings,
  };

  return { validTables, report };
}

/**
 * Validate entity-anchored groups for duplicate transformed expressions.
 * If a group would produce identical cuts after transformation, fall back to respondent-anchored.
 *
 * CRITICAL SAFETY CHECK: When different source variables (e.g., hLOCATIONr1, hLOCATIONr2)
 * check the same value (both == 1), transformation produces identical expressions
 * (.hawktab_location_flag == 1). This indicates the cuts are respondent-anchored in nature,
 * not entity-anchored, and should use original cuts without transformation.
 *
 * @param policy - Loop semantics policy from LoopSemanticsPolicyAgent
 * @param cuts - All cut definitions
 * @returns Modified policy with duplicate groups marked as respondent-anchored
 */
function validateAndFixLoopSemanticsPolicy(
  policy: LoopSemanticsPolicy,
  cuts: CutDefinition[],
): LoopSemanticsPolicy {
  // Clone the policy to avoid mutation
  const validatedPolicy: LoopSemanticsPolicy = {
    ...policy,
    bannerGroups: policy.bannerGroups.map(bg => ({ ...bg })),
  };

  // For each entity-anchored group, check for duplicate transformed expressions
  for (let i = 0; i < validatedPolicy.bannerGroups.length; i++) {
    const group = validatedPolicy.bannerGroups[i];

    if (group.anchorType !== 'entity' || group.implementation.strategy !== 'alias_column') {
      continue; // Skip respondent-anchored groups
    }

    // Find all cuts for this group
    const groupCuts = cuts.filter(c => c.groupName === group.groupName);

    if (groupCuts.length === 0) {
      continue; // No cuts to validate
    }

    // Transform all cuts using this group's sourcesByIteration and aliasName
    const sourceVars = group.implementation.sourcesByIteration.map(s => s.variable);
    const transformedExpressions = groupCuts.map(cut =>
      transformCutForAlias(cut.rExpression, sourceVars, group.implementation.aliasName)
    );

    // Check for duplicates
    const validation = validateTransformedCuts(transformedExpressions, group.groupName);

    if (validation.hasDuplicates) {
      // Fall back to respondent-anchored for this group
      console.warn(
        `[RScriptGeneratorV2] Group "${group.groupName}" has duplicate transformed expressions. ` +
        `Falling back to respondent-anchored classification.`
      );

      validatedPolicy.bannerGroups[i] = {
        ...group,
        anchorType: 'respondent',
        implementation: {
          strategy: 'none',
          sourcesByIteration: [],
          aliasName: '',
          notes: 'Post-transformation validation: duplicate expressions detected, fell back to respondent-anchored',
        },
      };
    }
  }

  return validatedPolicy;
}

// =============================================================================
// Main Generator
// =============================================================================

/**
 * Generate R script with validation.
 * Returns both the script and a validation report.
 * Invalid tables are skipped (not included in the script) but logged in the report.
 */
export function generateRScriptV2WithValidation(
  input: RScriptV2Input,
  options: RScriptV2Options = {}
): RScriptV2Result {
  const {
    tables,
    cuts,
    cutGroups = [],
    totalStatLetter = 'T',
    dataFilePath = 'dataFile.sav',
    significanceLevel = 0.10,
    significanceThresholds,
    totalRespondents,
    bannerGroups = [],
    statTestingConfig,
    loopMappings = [],
    loopSemanticsPolicy,
    compiledLoopContract,
    loopStatTestingMode,
    weightVariable,
  } = input;
  const isWeighted = !!weightVariable;

  // Extract stat testing config values (use explicit params if provided, else config, else defaults)
  const minBase = statTestingConfig?.minBase ?? 0;
  const proportionTest = statTestingConfig?.proportionTest ?? 'unpooled_z';
  const meanTest = statTestingConfig?.meanTest ?? 'welch_t';
  const { sessionId = 'unknown', outputDir = 'results' } = options;

  // Compute effective thresholds: use significanceThresholds if provided, else fall back to significanceLevel
  const effectiveThresholds = significanceThresholds
    ?? (significanceLevel ? [significanceLevel] : [0.10]);
  const hasMultipleThresholds = effectiveThresholds.length >= 2
    && effectiveThresholds[0] !== effectiveThresholds[1];  // Same values = treat as single

  // CRITICAL SAFETY CHECK: When compiled contract is available, it already handles validation
  // (duplicate detection, source variable validation). Only fall back to validateAndFix for legacy path.
  const validatedLoopPolicy = compiledLoopContract
    ? loopSemanticsPolicy  // Contract handles validation — pass through raw policy for legacy compat
    : (loopSemanticsPolicy
      ? validateAndFixLoopSemanticsPolicy(loopSemanticsPolicy, cuts)
      : undefined);

  // Validate all tables first, then sort to ensure consistent output order
  const { validTables: unsortedValid, report } = validateAllTables(tables);
  const validTables = sortTables(unsortedValid) as TableWithLoopFrame[];

  // Log summary
  if (report.invalidTables > 0) {
    console.error(`[RScriptGeneratorV2] Validation failed for ${report.invalidTables} table(s). They will be skipped.`);
  }

  // Build banner groups from cuts if not provided
  const effectiveBannerGroups = bannerGroups.length > 0
    ? bannerGroups
    : buildBannerGroupsFromCuts(cuts, cutGroups, totalStatLetter);

  // Build comparison groups string (e.g., "A/B/C/D/E, F/G, H/I")
  const comparisonGroups = buildComparisonGroups(effectiveBannerGroups);

  const lines: string[] = [];

  // -------------------------------------------------------------------------
  // Header
  // -------------------------------------------------------------------------
  lines.push('# TabulateAI - R Script V2');
  lines.push(`# Session: ${sessionId}`);
  lines.push(`# Generated: ${new Date().toISOString()}`);
  lines.push(`# Tables: ${report.validTables} (${report.invalidTables} skipped due to validation errors)`);
  lines.push(`# Cuts: ${cuts.length}`);  // Total is now included in cuts
  lines.push('#');
  lines.push('# STATISTICAL TESTING:');
  if (hasMultipleThresholds) {
    lines.push(`#   Thresholds: p<${effectiveThresholds[0]} (uppercase) / p<${effectiveThresholds[1]} (lowercase)`);
  } else {
    lines.push(`#   Threshold: p<${effectiveThresholds[0]} (${Math.round((1 - effectiveThresholds[0]) * 100)}% confidence)`);
  }
  lines.push(`#   Proportion test: ${proportionTest === 'unpooled_z' ? 'Unpooled z-test' : 'Pooled z-test'}`);
  lines.push(`#   Mean test: ${meanTest === 'welch_t' ? "Welch's t-test" : "Student's t-test"}`);
  lines.push(`#   Minimum base: ${minBase > 0 ? minBase : 'None (testing all cells)'}`);
  lines.push('#   Comparisons: Within-group + vs Total');
  if (isWeighted) {
    lines.push(`#   Weight variable: ${weightVariable}`);
    lines.push('#   Output: Dual pass (weighted + unweighted)');
  }
  if (report.invalidTables > 0) {
    lines.push('#');
    lines.push('# WARNING: Some tables were skipped due to validation errors.');
    lines.push('# Check validation report for details.');
  }
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
  // UTF-8 Locale (prevents <xx> hex escapes in JSON output)
  // -------------------------------------------------------------------------
  lines.push('# Ensure UTF-8 encoding for proper Unicode handling');
  lines.push('tryCatch(invisible(Sys.setlocale("LC_ALL", "en_US.UTF-8")), error = function(e) {');
  lines.push('  tryCatch(invisible(Sys.setlocale("LC_ALL", "C.UTF-8")), error = function(e2) {');
  lines.push('    cat("WARNING: Could not set UTF-8 locale. Non-ASCII characters may display as <xx> hex codes.\\n")');
  lines.push('  })');
  lines.push('})');
  lines.push('');

  // -------------------------------------------------------------------------
  // Load Data
  // -------------------------------------------------------------------------
  const safeDataFilePath = escapeRString(dataFilePath);
  lines.push('# Load SPSS data file (with encoding fallback)');
  lines.push(`data <- tryCatch(`);
  lines.push(`  read_sav("${safeDataFilePath}"),`);
  lines.push('  error = function(e) {');
  lines.push('    if (grepl("iconv|encoding|translat", e$message, ignore.case = TRUE)) {');
  lines.push('      cat("WARNING: Encoding error, retrying with encoding=\'latin1\'\\n")');
  lines.push(`      read_sav("${safeDataFilePath}", encoding = "latin1")`);
  lines.push('    } else {');
  lines.push('      stop(e)');
  lines.push('    }');
  lines.push('  }');
  lines.push(')');
  // Demo mode: truncate respondents to cap
  if (input.maxRespondents) {
    lines.push(`data <- head(data, ${input.maxRespondents})`);
    lines.push(`print(paste("Demo mode: truncated to first ${input.maxRespondents} respondents"))`);
  }
  lines.push('print(paste("Loaded", nrow(data), "rows and", ncol(data), "columns"))');
  lines.push('');

  // Initialize cut error accumulator (used by tryCatch wrappers in cut definitions)
  lines.push('# Error accumulator for cut expression failures');
  lines.push('.hawktab_cut_errors <- c()');
  lines.push('');

  // Weight vector setup
  if (isWeighted) {
    const safeWeightVar = escapeRString(weightVariable);
    lines.push('# =============================================================================');
    lines.push('# Weight Variable Setup');
    lines.push('# =============================================================================');
    lines.push('');
    lines.push(`weight_vec <- data[["${safeWeightVar}"]]`);
    lines.push('if (is.null(weight_vec)) {');
    lines.push(`  stop("Weight variable '${safeWeightVar}' not found in data")`);
    lines.push('}');
    lines.push('weight_vec[is.na(weight_vec)] <- 1.0  # NA weights default to 1');
    lines.push('');
    lines.push('# Weight sanity checks');
    lines.push('n_negative <- sum(weight_vec < 0)');
    lines.push('if (n_negative > 0) {');
    lines.push('  cat(paste("WARNING: Found", n_negative, "negative weights — setting to 0\\n"))');
    lines.push('  weight_vec[weight_vec < 0] <- 0');
    lines.push('}');
    lines.push('n_zero <- sum(weight_vec == 0)');
    lines.push('if (n_zero > 0) {');
    lines.push('  cat(paste("WARNING: Found", n_zero, "zero weights (these respondents will be excluded from weighted calculations)\\n"))');
    lines.push('}');
    lines.push('wt_median <- median(weight_vec[weight_vec > 0])');
    lines.push('if (wt_median > 0) {');
    lines.push('  n_extreme <- sum(weight_vec > 10 * wt_median)');
    lines.push('  if (n_extreme > 0) {');
    lines.push('    cat(paste("WARNING: Found", n_extreme, "extreme weights (>10x median of", round(wt_median, 3), "), max =", round(max(weight_vec), 3), "\\n"))');
    lines.push('  }');
    lines.push('}');
    lines.push('');
    lines.push(`cat(paste("Weight variable: ${safeWeightVar}",`);
    lines.push('    "- mean:", round(mean(weight_vec), 3),');
    lines.push('    "- range:", round(min(weight_vec), 3), "-", round(max(weight_vec), 3), "\\n"))');
    lines.push('');
  }

  // -------------------------------------------------------------------------
  // Loop Stacking Preamble (if any loop groups detected)
  // -------------------------------------------------------------------------
  if (loopMappings.length > 0) {
    generateStackingPreamble(lines, loopMappings, cuts, validatedLoopPolicy, compiledLoopContract);
  }

  // -------------------------------------------------------------------------
  // Significance Thresholds
  // -------------------------------------------------------------------------
  lines.push('# =============================================================================');
  lines.push('# Statistical Testing Configuration');
  lines.push('# =============================================================================');
  lines.push('');
  lines.push('# Significance thresholds');
  if (hasMultipleThresholds) {
    lines.push(`p_threshold_high <- ${effectiveThresholds[0]}  # High confidence (uppercase letters)`);
    lines.push(`p_threshold_low <- ${effectiveThresholds[1]}   # Low confidence (lowercase letters)`);
    lines.push('p_threshold <- p_threshold_high  # Default for backward compat');
  } else {
    lines.push(`p_threshold <- ${effectiveThresholds[0]}`);
  }
  lines.push('');
  lines.push('# Minimum base size for significance testing (0 = no minimum)');
  lines.push(`stat_min_base <- ${minBase}`);
  lines.push('');
  lines.push('# Test methodology');
  lines.push(`# Proportion test: ${proportionTest === 'unpooled_z' ? 'Unpooled z-test (WinCross default)' : 'Pooled z-test'}`);
  lines.push(`# Mean test: ${meanTest === 'welch_t' ? "Welch's t-test (unequal variances)" : "Student's t-test (equal variances)"}`);
  lines.push('');

  // -------------------------------------------------------------------------
  // Cuts Definition with Stat Letters
  // -------------------------------------------------------------------------
  generateCutsDefinition(lines, cuts, cutGroups, totalStatLetter);

  // Copy stat letters for stacked loop frames (must come AFTER cut_stat_letters is defined)
  if (loopMappings.length > 0) {
    for (const mapping of loopMappings) {
      lines.push(`cut_stat_letters_${mapping.stackedFrameName} <- cut_stat_letters`);
    }
    lines.push('');
  }

  // -------------------------------------------------------------------------
  // Helper Functions
  // -------------------------------------------------------------------------
  generateHelperFunctions(lines, isWeighted);

  // -------------------------------------------------------------------------
  // Table Calculations
  // -------------------------------------------------------------------------
  lines.push('# =============================================================================');
  lines.push('# Table Calculations');
  lines.push('# =============================================================================');
  lines.push('');

  // Dual-pass weight mode loop (when weighted)
  if (isWeighted) {
    const safeWtVar = escapeRString(weightVariable!);
    lines.push('# Dual-pass: compute both weighted and unweighted results');
    lines.push('weight_modes <- c("unweighted", "weighted")');
    lines.push('');
    lines.push('for (weight_mode in weight_modes) {');
    lines.push('  if (weight_mode == "weighted") {');
    lines.push('    w_main <- weight_vec');
    // Set weight vectors for stacked loop frames
    for (const mapping of loopMappings) {
      const frameName = mapping.stackedFrameName;
      lines.push(`    w_main_${sanitizeVarName(frameName)} <- ${frameName}[["${safeWtVar}"]]`);
      lines.push(`    w_main_${sanitizeVarName(frameName)}[is.na(w_main_${sanitizeVarName(frameName)})] <- 1.0`);
    }
    lines.push('  } else {');
    lines.push('    w_main <- rep(1, nrow(data))');
    for (const mapping of loopMappings) {
      const frameName = mapping.stackedFrameName;
      lines.push(`    w_main_${sanitizeVarName(frameName)} <- rep(1, nrow(${frameName}))`);
    }
    lines.push('  }');
    lines.push('  cat(paste("Computing tables for mode:", weight_mode, "\\n"))');
    lines.push('');
  }

  lines.push('all_tables <- list()');
  lines.push('');

  // Generate demo table first (banner profile - always first in output)
  if (cuts.length > 0) {
    generateDemoTable(lines, cuts, cutGroups, totalStatLetter, isWeighted);
  }

  // Add comments for skipped invalid tables
  if (report.skippedTables.length > 0) {
    lines.push('# -----------------------------------------------------------------------------');
    lines.push('# SKIPPED TABLES (validation errors):');
    for (const skipped of report.skippedTables) {
      lines.push(`#   ${skipped.tableId}: ${skipped.errors.join('; ')}`);
    }
    lines.push('# -----------------------------------------------------------------------------');
    lines.push('');
  }

  // Generate code for all valid tables (including excluded ones - they get flagged in output)
  for (const table of validTables) {
    // Note: Excluded tables are still calculated but flagged with excluded=true in output
    if (table.exclude) {
      lines.push(`# Table: ${table.tableId} (excluded: ${table.excludeReason}) - still calculating for reference`);
      lines.push('');
    }

    // Since we validated upfront, tableType should always be valid
    if (table.tableType === 'frequency') {
      generateFrequencyTable(lines, table, isWeighted);
    } else if (table.tableType === 'mean_rows') {
      generateMeanRowsTable(lines, table, isWeighted);
    }
    // No else/fallback needed - validation already caught invalid types
  }

  // -------------------------------------------------------------------------
  // Significance Testing Pass
  // -------------------------------------------------------------------------
  generateSignificanceTesting(lines, validatedLoopPolicy, loopStatTestingMode, compiledLoopContract);

  // -------------------------------------------------------------------------
  // Loop Semantics Policy Validation (if entity-anchored groups exist)
  // -------------------------------------------------------------------------
  if (compiledLoopContract || validatedLoopPolicy) {
    generateLoopPolicyValidation(lines, validatedLoopPolicy, cuts, loopMappings, outputDir, compiledLoopContract);
  }

  // Close weight mode loop and save per-mode tables
  if (isWeighted) {
    lines.push('  # Save tables for this weight mode');
    lines.push('  assign(paste0("all_tables_", weight_mode), all_tables)');
    lines.push('  cat(paste("Saved", length(all_tables), "tables for mode:", weight_mode, "\\n"))');
    lines.push('}');  // end for (weight_mode ...)
    lines.push('');
  }

  // -------------------------------------------------------------------------
  // Export Data Materialization
  // -------------------------------------------------------------------------
  generateExportDataMaterialization(lines, loopMappings);

  // -------------------------------------------------------------------------
  // JSON Output
  // -------------------------------------------------------------------------
  generateJsonOutput(lines, validTables, cuts, outputDir, {
    totalRespondents,
    bannerGroups: effectiveBannerGroups,
    comparisonGroups,
    significanceThresholds: effectiveThresholds,
  }, isWeighted, weightVariable);

  return {
    script: lines.join('\n'),
    validation: report,
  };
}

/**
 * Generate R script (backward-compatible wrapper).
 * Uses validation internally but only returns the script string.
 * Invalid tables are silently skipped with console warnings.
 */
export function generateRScriptV2(
  input: RScriptV2Input,
  options: RScriptV2Options = {}
): string {
  const result = generateRScriptV2WithValidation(input, options);
  return result.script;
}

// =============================================================================
// Loop Stacking Preamble
// =============================================================================

/**
 * Generate R code to create stacked data frames for loop groups.
 * Each loop group gets its own stacked frame via dplyr::bind_rows + rename.
 * Cuts are also pre-computed for each stacked frame.
 */
function generateStackingPreamble(
  lines: string[],
  loopMappings: LoopGroupMapping[],
  cuts: CutDefinition[],
  loopSemanticsPolicy?: LoopSemanticsPolicy,
  compiledLoopContract?: CompiledLoopContract,
): void {
  // Stacked-frame cut expressions can run before the main helper section in some scripts.
  // Declare these guards early so tryCatch handlers and quantile-based cuts are always safe.
  lines.push('# Ensure cut helper state exists before stacked cut evaluation');
  lines.push('if (!exists(".hawktab_cut_errors", inherits = FALSE)) .hawktab_cut_errors <- c()');
  lines.push('if (!exists("safe_quantile", mode = "function")) safe_quantile <- function(x, ...) quantile(as.numeric(x), ...)');
  lines.push('');

  lines.push('# =============================================================================');
  lines.push('# Loop Stacking: Create stacked data frames for looped questions');
  lines.push(`# ${loopMappings.length} loop group(s) detected`);
  lines.push('# =============================================================================');
  lines.push('');

  // Build lookup: groupName → compiled contract entry for entity-anchored groups
  // Prefer compiledLoopContract over raw loopSemanticsPolicy when available
  const contractEntityGroups = new Map<string, CompiledGroupEntry>();
  const entityPolicies = new Map<string, BannerGroupPolicy>();
  if (compiledLoopContract) {
    for (const group of compiledLoopContract.groups) {
      if (group.anchorType === 'entity' && group.helperColumnName) {
        contractEntityGroups.set(group.groupName, group);
      }
    }
  } else if (loopSemanticsPolicy) {
    for (const bp of loopSemanticsPolicy.bannerGroups) {
      if (bp.anchorType === 'entity' && bp.implementation.strategy === 'alias_column') {
        entityPolicies.set(bp.groupName, bp);
      }
    }
  }

  for (const mapping of loopMappings) {
    const frameName = mapping.stackedFrameName;

    lines.push(`# --- ${frameName}: ${mapping.variables.length} variables x ${mapping.iterations.length} iterations ---`);
    lines.push(`# Skeleton: ${mapping.skeleton}`);
    lines.push(`# Iterations: ${mapping.iterations.join(', ')}`);
    lines.push('');

    // Generate bind_rows with one remap per iteration.
    // Use mutate(target = .data[[source]]) instead of rename() so we can safely
    // overwrite existing target columns without triggering duplicate-name errors.
    lines.push(`${frameName} <- dplyr::bind_rows(`);

    for (let i = 0; i < mapping.iterations.length; i++) {
      const iter = mapping.iterations[i];
      const isLast = i === mapping.iterations.length - 1;

      // Build remap assignments: baseName = .data[[originalCol]]
      // Deduplicate destination names defensively to prevent malformed mutate calls.
      const remapAssignments: string[] = [];
      const seenDestinations = new Set<string>();

      for (const v of mapping.variables) {
        const origCol = v.iterationColumns[iter];
        if (!origCol) continue;
        // Only need remap if base differs from original
        if (v.baseName === origCol) continue;

        if (seenDestinations.has(v.baseName)) {
          console.warn(
            `[RScriptGeneratorV2] Duplicate loop remap target "${v.baseName}" in ${frameName} iteration ${iter}; keeping first mapping.`
          );
          continue;
        }

        seenDestinations.add(v.baseName);
        remapAssignments.push(
          `${sanitizeRColumnName(v.baseName)} = .data[["${escapeRString(origCol)}"]]`
        );
      }

      if (remapAssignments.length > 0) {
        lines.push(`  data %>% dplyr::mutate(${remapAssignments.join(', ')}, .loop_iter = ${iter})${isLast ? '' : ','}`);
      } else {
        lines.push(`  data %>% dplyr::mutate(.loop_iter = ${iter})${isLast ? '' : ','}`);
      }
    }

    lines.push(')');
    lines.push(`print(paste("Created ${frameName}:", nrow(${frameName}), "rows (", nrow(data), "x", ${mapping.iterations.length}, "iterations)"))`);
    lines.push('');

    // Detect and warn about value label conflicts across iterations
    // bind_rows keeps the first iteration's labels — warn if later iterations differ
    if (mapping.variables.length > 0 && mapping.iterations.length >= 2) {
      lines.push(`# Check for value label conflicts across iterations (first iteration's labels win)`);
      lines.push(`label_conflict_warnings <- c()`);

      // Sample up to 20 variables to avoid bloating the script
      const varsToCheck = mapping.variables.slice(0, 20);
      const firstIter = mapping.iterations[0];

      for (const v of varsToCheck) {
        const refCol = v.iterationColumns[firstIter];
        if (!refCol) continue;

        for (let i = 1; i < mapping.iterations.length; i++) {
          const otherCol = v.iterationColumns[mapping.iterations[i]];
          if (!otherCol) continue;

          const safeRef = escapeRString(refCol);
          const safeOther = escapeRString(otherCol);
          lines.push(`if (!is.null(attr(data[["${safeRef}"]], "labels")) && !identical(attr(data[["${safeRef}"]], "labels"), attr(data[["${safeOther}"]], "labels"))) {`);
          lines.push(`  label_conflict_warnings <- c(label_conflict_warnings, paste0("${escapeRString(v.baseName)}: labels differ between ${refCol} and ${otherCol}"))`);
          lines.push(`}`);
        }
      }

      lines.push(`if (length(label_conflict_warnings) > 0) {`);
      lines.push(`  warning(paste("Value label conflicts in ${frameName} (first iteration labels used):", paste(label_conflict_warnings, collapse = "; ")))`);
      lines.push(`  print(paste("WARNING:", length(label_conflict_warnings), "label conflict(s) in ${frameName} - using iteration ${firstIter} labels"))`);
      lines.push(`}`);
      lines.push('');
    }

    // Generate alias columns for entity-anchored banner groups
    // Prefer compiled contract over raw policy when available
    const contractAliasesForFrame = [...contractEntityGroups.values()].filter(
      g => getTargetFrames(g).includes(frameName),
    );
    const aliasesForFrame = [...entityPolicies.values()].filter(
      bp => bp.stackedFrameName === frameName || bp.stackedFrameName === ''
    );
    const hasAliases = contractAliasesForFrame.length > 0 || aliasesForFrame.length > 0;
    if (hasAliases) {
      // Build set of all real column names available in the stacked frame.
      // Includes:
      // 1. Loop-mapped variables (base names + iteration columns)
      // 2. Variables referenced in sourcesByIteration/helperBranches (iteration-linked hidden vars, etc.)
      // Note: bind_rows includes ALL columns from the original data, not just loop-mapped ones,
      // so we must include any variable identified as an alias source.
      const realColumns = new Set<string>();
      for (const v of mapping.variables) {
        realColumns.add(v.baseName);
        for (const origCol of Object.values(v.iterationColumns)) {
          realColumns.add(origCol);
        }
      }
      // Add variables from contract helperBranches or legacy sourcesByIteration
      for (const cg of contractAliasesForFrame) {
        for (const branch of cg.helperBranches) {
          realColumns.add(branch.sourceVariable);
        }
      }
      for (const bp of aliasesForFrame) {
        if (bp.implementation.strategy === 'alias_column') {
          for (const source of bp.implementation.sourcesByIteration) {
            realColumns.add(source.variable);
          }
        }
      }

      lines.push(`# Create alias columns for entity-anchored banner groups`);
      lines.push(`${frameName} <- ${frameName} %>% dplyr::mutate(`);

      const mutateArgs: string[] = [];

      // --- Contract-driven path (preferred) ---
      for (const cg of contractAliasesForFrame) {
        const aliasName = cg.helperColumnName;
        if (!aliasName || cg.helperBranches.length === 0) continue;

        const caseLines: string[] = [];
        for (const branch of cg.helperBranches) {
          if (!realColumns.has(branch.sourceVariable)) {
            console.warn(
              `[RScriptGenerator] Skipping alias branch for iteration ${branch.iteration}: ` +
              `variable "${branch.sourceVariable}" not found in ${frameName} columns`,
            );
            continue;
          }
          caseLines.push(`    .loop_iter == ${branch.iteration} ~ ${sanitizeRColumnName(branch.sourceVariable)}`);
        }

        if (caseLines.length === 0) {
          console.warn(
            `[RScriptGenerator] Skipping alias "${aliasName}" entirely: ` +
            `no valid source variables found in ${frameName}.`,
          );
          continue;
        }

        caseLines.push('    TRUE ~ NA_real_');
        mutateArgs.push(
          `  \`${aliasName}\` = dplyr::case_when(\n${caseLines.join(',\n')}\n  )`
        );
      }

      // --- Legacy policy path (fallback when no contract) ---
      for (const bp of aliasesForFrame) {
        const aliasName = bp.implementation.aliasName;
        const sourcesArray = bp.implementation.sourcesByIteration;
        if (!aliasName || sourcesArray.length === 0) continue;

        // Convert array to lookup map: iteration -> variable
        const sourcesMap = new Map(sourcesArray.map(s => [s.iteration, s.variable]));

        const caseLines: string[] = [];
        for (const iter of mapping.iterations) {
          const sourceVar = sourcesMap.get(iter);
          if (sourceVar) {
            // Safety net: only emit case_when branch if the variable actually exists
            if (!realColumns.has(sourceVar)) {
              console.warn(
                `[RScriptGenerator] Skipping alias branch for iteration ${iter}: ` +
                `variable "${sourceVar}" not found in ${frameName} columns`,
              );
              continue;
            }
            caseLines.push(`    .loop_iter == ${iter} ~ ${sanitizeRColumnName(sourceVar)}`);
          }
        }

        // If no valid branches, skip this alias entirely rather than creating an all-NA column
        if (caseLines.length === 0) {
          console.warn(
            `[RScriptGenerator] Skipping alias "${aliasName}" entirely: ` +
            `no valid source variables found in ${frameName}. ` +
            `Cuts referencing this alias will produce empty columns.`,
          );
          continue;
        }

        caseLines.push('    TRUE ~ NA_real_');

        mutateArgs.push(
          `  \`${aliasName}\` = dplyr::case_when(\n${caseLines.join(',\n')}\n  )`
        );
      }

      if (mutateArgs.length > 0) {
        lines.push(mutateArgs.join(',\n'));
        lines.push(')');
        lines.push(`print(paste("Added ${mutateArgs.length} alias column(s) to ${frameName}"))`);
      } else {
        // No valid aliases — remove the dangling mutate( line
        lines.pop(); // Remove the `dplyr::mutate(` line
        lines.pop(); // Remove the `frameName <- frameName %>%` line
        lines.push(`# No valid alias columns for ${frameName} — all source variables missing`);
        lines.push(`print("WARNING: No alias columns created for ${frameName} — source variables not found in stacked frame")`);
      }
      lines.push('');
    }

    // Pre-compute cuts for this stacked frame — wrapped in tryCatch for resilience
    lines.push(`# Cuts for ${frameName} (each wrapped in tryCatch for resilience)`);
    lines.push(`cuts_${frameName} <- list(`);
    lines.push(`  Total = rep(TRUE, nrow(${frameName}))`);

    for (const cut of cuts) {
      if (cut.name === 'Total') continue; // Total already hardcoded above
      let expr = cut.rExpression.replace(/^\s*#.*$/gm, '').trim();
      if (!expr || expr.startsWith('#')) continue;

      // Replace quantile() with safe_quantile() to handle haven_labelled vectors
      expr = expr.replace(/\bquantile\s*\(/g, 'safe_quantile(');

      // Check if this cut belongs to an entity-anchored group — use compiled expression if available
      const contractGroup = contractEntityGroups.get(cut.groupName);
      if (contractGroup) {
        // Contract path: use pre-compiled expression
        const compiledCut = contractGroup.compiledCuts.find(c => c.cutName === cut.name);
        if (compiledCut && compiledCut.wasTransformed) {
          lines.push(`  # Transformed: ${expr}`);
          expr = compiledCut.compiledExpression;
        }
      } else {
        // Legacy path: transform using raw policy
        const policy = entityPolicies.get(cut.groupName);
        if (policy && policy.implementation.aliasName) {
          const sourceVars = policy.implementation.sourcesByIteration.map(s => s.variable);
          const transformed = transformCutForAlias(expr, sourceVars, policy.implementation.aliasName);
          if (transformed !== expr) {
            lines.push(`  # Transformed: ${expr}`);
            expr = transformed;
          }
        }
      }

      const safeName = cut.name.replace(/`/g, "'");
      lines.push(`,  \`${safeName}\` = tryCatch(with(${frameName}, ${expr}), error = function(e) {`);
      lines.push(`    .hawktab_cut_errors <<- c(.hawktab_cut_errors, paste0("Cut '${safeName}' on ${frameName}: ", e$message))`);
      lines.push(`    rep(FALSE, nrow(${frameName}))`);
      lines.push(`  })`);
    }

    lines.push(')');
    lines.push('');

    // NOTE: cut_stat_letters_${frameName} is assigned AFTER cut_stat_letters is defined (see below)
    lines.push('');
  }
}

/**
 * Sanitize a column name for use in R dplyr::rename().
 * Wraps in backticks if the name contains special characters.
 */
function sanitizeRColumnName(name: string): string {
  // If it's a simple alphanumeric + underscore name, no backticks needed
  if (/^[a-zA-Z][a-zA-Z0-9_.]*$/.test(name)) {
    return name;
  }
  // Escape backticks and backslashes within the column name
  const escaped = name.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  return `\`${escaped}\``;
}

// =============================================================================
// Cuts Definition with Stat Letters and Groups
// =============================================================================

function generateCutsDefinition(
  lines: string[],
  cuts: CutDefinition[],
  cutGroups: CutGroup[],
  totalStatLetter: string | null
): void {
  // Cut expressions are evaluated when the list is built; ensure required state/helpers exist first.
  lines.push('# Ensure cut helper state exists before cut evaluation');
  lines.push('if (!exists(".hawktab_cut_errors", inherits = FALSE)) .hawktab_cut_errors <- c()');
  lines.push('if (!exists("safe_quantile", mode = "function")) safe_quantile <- function(x, ...) quantile(as.numeric(x), ...)');
  lines.push('');

  lines.push('# =============================================================================');
  lines.push('# Cuts Definition (banner columns) with stat testing metadata');
  lines.push('# =============================================================================');
  lines.push('');

  // Define cuts list — each cut wrapped in tryCatch so a bad variable reference
  // produces an empty (all-FALSE) column instead of crashing the whole script
  lines.push('# Cut masks (each wrapped in tryCatch for resilience)');
  lines.push('cuts <- list(');
  lines.push('  Total = rep(TRUE, nrow(data))');

  for (const cut of cuts) {
    let expr = cut.rExpression.replace(/^\s*#.*$/gm, '').trim();
    if (expr && !expr.startsWith('#')) {
      // Validate expression against dangerous R functions before interpolation
      const sanitizeResult = sanitizeRExpression(expr);
      if (!sanitizeResult.safe) {
        console.warn(`[RScriptGen] Blocked unsafe cut expression "${cut.name}": ${sanitizeResult.error}`);
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
  lines.push('  cat("\\nWARNING: The following cut expressions failed (columns will be empty):\\n")');
  lines.push('  for (err in .hawktab_cut_errors) cat("  -", err, "\\n")');
  lines.push('}');
  lines.push('');

  // Define stat letter mapping
  lines.push('# Stat letter mapping (for significance testing output)');
  lines.push('cut_stat_letters <- c(');
  lines.push(`  "Total" = "${totalStatLetter || 'T'}"`);

  for (const cut of cuts) {
    const safeName = cut.name.replace(/`/g, "'").replace(/"/g, '\\"');
    lines.push(`,  "${safeName}" = "${cut.statLetter}"`);
  }

  lines.push(')');
  lines.push('');

  // Define group membership
  lines.push('# Group membership (for within-group comparisons)');
  lines.push('cut_groups <- list(');

  if (cutGroups.length > 0) {
    const groupEntries: string[] = [];
    for (const group of cutGroups) {
      const cutNames = group.cuts.map(c => `"${c.name.replace(/"/g, '\\"')}"`).join(', ');
      groupEntries.push(`  "${group.groupName}" = c(${cutNames})`);
    }
    lines.push(groupEntries.join(',\n'));
  } else {
    // Fallback: derive groups from cuts
    const groupMap = new Map<string, string[]>();
    for (const cut of cuts) {
      if (!groupMap.has(cut.groupName)) {
        groupMap.set(cut.groupName, []);
      }
      groupMap.get(cut.groupName)!.push(cut.name);
    }
    const groupEntries: string[] = [];
    for (const [groupName, cutNames] of groupMap) {
      const names = cutNames.map(n => `"${n.replace(/"/g, '\\"')}"`).join(', ');
      groupEntries.push(`  "${groupName}" = c(${names})`);
    }
    lines.push(groupEntries.join(',\n'));
  }

  lines.push(')');
  lines.push('');
  lines.push('print(paste("Defined", length(cuts), "cuts in", length(cut_groups), "groups"))');
  lines.push('');
}

// =============================================================================
// Demo Table Generator (Banner Profile)
// =============================================================================

/**
 * Generate a demo table showing respondent distribution across all banner cuts.
 * This creates a "banner x banner" profile table showing how respondents are distributed.
 */
function generateDemoTable(
  lines: string[],
  cuts: CutDefinition[],
  cutGroups: CutGroup[],
  totalStatLetter: string | null,
  isWeighted: boolean = false
): void {
  lines.push('# -----------------------------------------------------------------------------');
  lines.push('# Demo Table: Banner Profile (respondent distribution across cuts)');
  lines.push('# -----------------------------------------------------------------------------');
  lines.push('');

  lines.push('table__demo_banner_x_banner <- list(');
  lines.push('  tableId = "_demo_banner_x_banner",');
  lines.push('  questionId = "",');
  lines.push('  questionText = "Banner Profile",');
  lines.push('  tableType = "frequency",');
  lines.push('  isDerived = FALSE,');
  lines.push('  sourceTableId = "",');
  lines.push('  surveySection = "DEMO",');
  lines.push('  baseText = "All qualified respondents",');
  lines.push('  userNote = "Auto-generated banner profile showing respondent distribution",');
  lines.push('  tableSubtitle = "",');
  lines.push('  excluded = FALSE,');
  lines.push('  excludeReason = "",');
  lines.push('  data = list()');
  lines.push(')');
  lines.push('');

  // For each banner column, calculate how many respondents match each banner cut (row)
  lines.push('for (cut_name in names(cuts)) {');
  lines.push('  cut_data <- apply_cut(data, cuts[[cut_name]])');
  if (isWeighted) {
    lines.push('  w_cut_mask <- cuts[[cut_name]]');
    lines.push('  w_cut_mask[is.na(w_cut_mask)] <- FALSE');
    lines.push('  w_cut <- w_main[w_cut_mask]');
  }
  lines.push('  table__demo_banner_x_banner$data[[cut_name]] <- list()');
  lines.push('  table__demo_banner_x_banner$data[[cut_name]]$stat_letter <- cut_stat_letters[[cut_name]]');
  lines.push('');

  // Build the group structure for row organization
  // Derive effective cut groups from cutGroups or from cuts
  const effectiveCutGroups: Array<{ groupName: string; cuts: Array<{ name: string; statLetter: string }> }> = [];

  if (cutGroups.length > 0) {
    for (const group of cutGroups) {
      effectiveCutGroups.push({
        groupName: group.groupName,
        cuts: group.cuts.map(c => ({ name: c.name, statLetter: c.statLetter }))
      });
    }
  } else {
    // Derive from cuts
    const groupMap = new Map<string, Array<{ name: string; statLetter: string }>>();
    for (const cut of cuts) {
      if (!groupMap.has(cut.groupName)) {
        groupMap.set(cut.groupName, []);
      }
      groupMap.get(cut.groupName)!.push({ name: cut.name, statLetter: cut.statLetter });
    }
    for (const [groupName, cutList] of groupMap) {
      effectiveCutGroups.push({ groupName, cuts: cutList });
    }
  }

  // Generate a row for each banner cut
  let rowIndex = 0;

  // First add Total as a row (totalStatLetter used for consistency but Total always labeled "Total")
  const _totalLetter = totalStatLetter || 'T';  // Unused but kept for potential future use
  lines.push(`  # Row: Total`);
  if (isWeighted) {
    lines.push('  total_count <- sum(w_cut)');
    lines.push('  base_n <- sum(w_cut)');
  } else {
    lines.push('  total_count <- nrow(cut_data)');
    lines.push('  base_n <- nrow(cut_data)');
  }
  lines.push('  pct <- if (base_n > 0) total_count / base_n * 100 else 0');
  lines.push('');
  lines.push(`  table__demo_banner_x_banner$data[[cut_name]][["row_${rowIndex}_Total"]] <- list(`);
  lines.push('    label = "Total",');
  lines.push(`    groupName = "Total",`);
  lines.push('    n = base_n,');
  lines.push('    count = total_count,');
  lines.push('    pct = pct,');
  lines.push('    isNet = FALSE,');
  lines.push('    indent = 0,');
  lines.push('    sig_higher_than = c(),');
  lines.push('    sig_vs_total = NA');
  lines.push('  )');
  lines.push('');
  rowIndex++;

  // Then add each group and its cuts
  for (const group of effectiveCutGroups) {
    for (const cut of group.cuts) {
      const safeCutName = cut.name.replace(/`/g, "'").replace(/"/g, '\\"');
      const safeGroupName = group.groupName.replace(/"/g, '\\"');
      const rowKey = `row_${rowIndex}_${cut.statLetter}`;

      lines.push(`  # Row: ${cut.name} (${group.groupName})`);
      lines.push(`  row_cut_mask <- cuts[["${safeCutName}"]]`);
      lines.push('  if (!is.null(row_cut_mask)) {');
      lines.push('    # Count respondents in this column who also match this banner cut');
      lines.push('    combined_mask <- cuts[[cut_name]] & row_cut_mask');
      lines.push('    combined_mask[is.na(combined_mask)] <- FALSE');
      if (isWeighted) {
        lines.push('    row_count <- sum(w_main[combined_mask])');
      } else {
        lines.push('    row_count <- sum(combined_mask)');
      }
      lines.push('    row_pct <- if (base_n > 0) row_count / base_n * 100 else 0');
      lines.push('');
      lines.push(`    table__demo_banner_x_banner$data[[cut_name]][["${rowKey}"]] <- list(`);
      lines.push(`      label = "${safeCutName}",`);
      lines.push(`      groupName = "${safeGroupName}",`);
      lines.push('      n = base_n,');
      lines.push('      count = row_count,');
      lines.push('      pct = row_pct,');
      lines.push('      isNet = FALSE,');
      lines.push('      indent = 0,');
      lines.push('      sig_higher_than = c(),');
      lines.push('      sig_vs_total = NA');
      lines.push('    )');
      lines.push('  }');
      lines.push('');
      rowIndex++;
    }
  }

  lines.push('}');
  lines.push('');
  lines.push('all_tables[["_demo_banner_x_banner"]] <- table__demo_banner_x_banner');
  lines.push('print("Generated demo table: _demo_banner_x_banner")');
  lines.push('');
}

// =============================================================================
// Compute Context Helpers
// =============================================================================

type TableComputeContext = NonNullable<TableWithLoopFrame['computeContext']>;
type RowComputeContext = NonNullable<ExtendedTableRow['computeContext']>;

function getTableComputeContext(table: TableWithLoopFrame): TableComputeContext | null {
  return table.computeContext ?? null;
}

function getRowComputeContext(row: ExtendedTableRow): RowComputeContext | null {
  return row.computeContext ?? null;
}

function emitStructuralMaskApplication(
  lines: string[],
  table: TableWithLoopFrame,
  isWeighted: boolean,
): void {
  const computeContext = getTableComputeContext(table);
  if (!computeContext || !computeContext.tableMaskRecipe) return;

  if (computeContext.tableMaskRecipe.kind === 'none' || computeContext.tableMaskRecipe.kind === 'model') {
    return;
  }

  lines.push('');
  lines.push('  # Apply structural table mask from computeContext');
  if (computeContext.tableMaskRecipe.kind === 'any_answered') {
    const variables = computeContext.tableMaskRecipe.variables.map(value => `"${escapeRString(value)}"`).join(', ');
    lines.push(`  structural_mask <- get_answered_mask(cut_data, c(${variables}))`);
  } else if (computeContext.tableMaskRecipe.kind === 'variable_answered') {
    lines.push(`  structural_mask <- get_answered_mask(cut_data, c("${escapeRString(computeContext.tableMaskRecipe.variable)}"))`);
  }
  lines.push('  cut_data <- cut_data[structural_mask, , drop = FALSE]');
  if (isWeighted) {
    lines.push('  w_cut <- w_cut[structural_mask]');
  }
}

function emitValidityMaskApplication(
  lines: string[],
  table: TableWithLoopFrame,
  isWeighted: boolean,
): void {
  const computeContext = getTableComputeContext(table);
  const expression = computeContext?.validityPolicy === 'legacy_expression'
    ? computeContext.validityExpression
    : (table.additionalFilter && table.additionalFilter.trim().length > 0 ? table.additionalFilter : null);

  if (!expression || expression.trim().length === 0) return;

  const sanitizeFilterResult = sanitizeRExpression(expression);
  if (!sanitizeFilterResult.safe) {
    console.warn(`[RScriptGen] Blocked unsafe additionalFilter for table "${table.tableId}": ${sanitizeFilterResult.error}`);
    return;
  }

  const filterExpr = escapeRString(expression);
  lines.push('');
  lines.push('  # Apply validity filter from computeContext/legacy compatibility');
  lines.push(`  additional_mask <- with(cut_data, eval(parse(text = "${filterExpr}")))`);
  lines.push('  additional_mask[is.na(additional_mask)] <- FALSE');
  lines.push('  cut_data <- cut_data[additional_mask, , drop = FALSE]');
  if (isWeighted) {
    lines.push('  w_cut <- w_cut[additional_mask]');
  }
}

function getRowValueTokens(row: ExtendedTableRow): string[] {
  const computeContext = getRowComputeContext(row);
  if (computeContext && computeContext.componentValues.length > 0) {
    return computeContext.componentValues;
  }
  return row.filterValue.split(',').map(value => value.trim()).filter(Boolean);
}

function getRealNetComponents(row: ExtendedTableRow): string[] {
  const computeContext = getRowComputeContext(row);
  const componentVariables = computeContext?.componentVariables ?? row.netComponents ?? [];
  return componentVariables.filter(component => !/^\d+$/.test(component));
}

function usesSharedTableUniverse(row: ExtendedTableRow): boolean {
  return getRowComputeContext(row)?.universeMode === 'masked_shared_table_n';
}

function getRowAggregationMode(row: ExtendedTableRow, tableType: TableWithLoopFrame['tableType']): RowComputeContext['aggregationMode'] | null {
  const computeContext = getRowComputeContext(row);
  if (computeContext) return computeContext.aggregationMode;

  if (row.rowKind === 'stat') return 'stat_summary';
  if (row.rowKind === 'not_answered') return 'not_answered';
  const realNetComponents = getRealNetComponents(row);
  if (row.isNet && realNetComponents.length > 0) {
    return tableType === 'mean_rows' ? 'row_sum_components' : 'any_component_selected';
  }
  if (getRowValueTokens(row).length > 1) return 'single_variable_value_set';
  return 'none';
}

function getRowSourceVariable(row: ExtendedTableRow): string {
  return getRowComputeContext(row)?.sourceVariable ?? row.variable;
}

function getRowTailExclusions(table: TableWithLoopFrame, row: ExtendedTableRow): number[] {
  const tableContext = getTableComputeContext(table);
  if (!tableContext || tableContext.rebasePolicy === 'none') return [];

  const aggregationMode = getRowAggregationMode(row, table.tableType);
  if (
    aggregationMode !== 'stat_summary'
    && aggregationMode !== 'single_variable_value_set'
    && aggregationMode !== 'none'
  ) {
    return [];
  }

  const sourceVariable = getRowSourceVariable(row);
  if (
    sourceVariable
    && tableContext.rebaseSourceVariables.length > 0
    && !tableContext.rebaseSourceVariables.includes(sourceVariable)
  ) {
    return [];
  }

  return tableContext.rebaseExcludedValues;
}

function emitObservedBaseCount(
  lines: string[],
  row: ExtendedTableRow,
  isWeighted: boolean,
): void {
  if (usesSharedTableUniverse(row)) {
    if (isWeighted) {
      lines.push('    base_n <- sum(w_cut)');
    } else {
      lines.push('    base_n <- nrow(cut_data)');
    }
    return;
  }

  if (isWeighted) {
    lines.push('    base_n <- weighted_base(w_cut, var_col)');
  } else {
    lines.push('    base_n <- sum(!is.na(var_col))');
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

function generateHelperFunctions(lines: string[], isWeighted: boolean = false): void {
  lines.push('# =============================================================================');
  lines.push('# Helper Functions');
  lines.push('# =============================================================================');
  lines.push('');

  // Weighted helper functions (only when weight variable is active)
  if (isWeighted) {
    lines.push('# --- Weighted computation helpers ---');
    lines.push('');
    lines.push('# Weighted base: sum of weights for non-NA respondents');
    lines.push('weighted_base <- function(w, var_col) sum(w[!is.na(var_col)], na.rm = TRUE)');
    lines.push('');
    lines.push('# Weighted count: sum of weights where mask is TRUE');
    lines.push('weighted_count <- function(w, mask) sum(w[mask], na.rm = TRUE)');
    lines.push('');
    lines.push('# Weighted mean');
    lines.push('weighted_mean_custom <- function(w, x) {');
    lines.push('  v <- !is.na(x)');
    lines.push('  if (sum(v) == 0) return(NA)');
    lines.push('  sum(w[v] * x[v]) / sum(w[v])');
    lines.push('}');
    lines.push('');
    lines.push('# Weighted standard deviation');
    lines.push('weighted_sd_custom <- function(w, x) {');
    lines.push('  v <- !is.na(x)');
    lines.push('  if (sum(v) < 2) return(NA)');
    lines.push('  wm <- weighted_mean_custom(w[v], x[v])');
    lines.push('  sqrt(sum(w[v] * (x[v] - wm)^2) / sum(w[v]))');
    lines.push('}');
    lines.push('');
    lines.push('# Effective sample size (for significance testing with weights)');
    lines.push('n_effective <- function(w) sum(w)^2 / sum(w^2)');
    lines.push('');
  }

  // Round half up (not banker's rounding) — with NaN/Inf guard
  lines.push('# Round half up (12.5 -> 13, not banker\'s rounding which gives 12)');
  lines.push('round_half_up <- function(x, digits = 0) {');
  lines.push('  result <- floor(x * 10^digits + 0.5) / 10^digits');
  lines.push('  bad <- is.nan(result) | is.infinite(result)');
  lines.push('  if (any(bad)) {');
  lines.push('    cat(paste("WARNING: round_half_up replaced", sum(bad), "NaN/Inf values with 0\\n"))');
  lines.push('    result[bad] <- 0');
  lines.push('  }');
  lines.push('  result');
  lines.push('}');
  lines.push('');

  // Sanitize NaN/Inf before JSON serialization
  lines.push('# Sanitize NaN/Inf in nested lists before JSON serialization');
  lines.push('sanitize_for_json <- function(obj) {');
  lines.push('  if (is.list(obj)) {');
  lines.push('    return(lapply(obj, sanitize_for_json))');
  lines.push('  }');
  lines.push('  if (is.numeric(obj)) {');
  lines.push('    bad <- is.nan(obj) | is.infinite(obj)');
  lines.push('    if (any(bad)) {');
  lines.push('      cat(paste("WARNING: sanitize_for_json replaced", sum(bad), "NaN/Inf values with 0\\n"))');
  lines.push('      obj[bad] <- 0');
  lines.push('    }');
  lines.push('  }');
  lines.push('  obj');
  lines.push('}');
  lines.push('');

  // Apply cut safely (handle NA in cut expression)
  lines.push('# Apply cut mask safely (NA in cut = exclude)');
  lines.push('apply_cut <- function(data, cut_mask) {');
  lines.push('  safe_mask <- cut_mask');
  lines.push('  safe_mask[is.na(safe_mask)] <- FALSE');
  lines.push('  data[safe_mask, ]');
  lines.push('}');
  lines.push('');

  // Safe variable access
  lines.push('# Safely get variable column (returns NULL if not found)');
  lines.push('safe_get_var <- function(data, var_name) {');
  lines.push('  if (var_name %in% names(data)) {');
  lines.push('    return(data[[var_name]])');
  lines.push('  }');
  lines.push('  return(NULL)');
  lines.push('}');
  lines.push('');

  lines.push('# Build a respondent mask for any answered variable in a set');
  lines.push('get_answered_mask <- function(data, vars) {');
  lines.push('  if (length(vars) == 0) return(rep(TRUE, nrow(data)))');
  lines.push('  masks <- lapply(vars, function(var_name) {');
  lines.push('    var_col <- safe_get_var(data, var_name)');
  lines.push('    if (is.null(var_col)) return(rep(FALSE, nrow(data)))');
  lines.push('    !is.na(var_col)');
  lines.push('  })');
  lines.push('  mask_matrix <- do.call(cbind, masks)');
  lines.push('  if (is.null(dim(mask_matrix))) return(as.logical(mask_matrix))');
  lines.push('  apply(mask_matrix, 1, any)');
  lines.push('}');
  lines.push('');

  // Safe quantile for haven-labelled vectors
  // haven::read_sav() produces haven_labelled vectors; quantile() fails on them.
  // This wrapper coerces to numeric first — used by cut expressions with tertile splits.
  lines.push('# Safe quantile that handles haven_labelled vectors');
  lines.push('safe_quantile <- function(x, ...) {');
  lines.push('  quantile(as.numeric(x), ...)');
  lines.push('}');
  lines.push('');

  // Mean without outliers (IQR method)
  lines.push('# Calculate mean excluding outliers (IQR method)');
  lines.push('mean_no_outliers <- function(x) {');
  lines.push('  valid <- x[!is.na(x)]');
  lines.push('  if (length(valid) < 4) return(NA)  # Need enough data for IQR');
  lines.push('');
  lines.push('  q1 <- quantile(valid, 0.25)');
  lines.push('  q3 <- quantile(valid, 0.75)');
  lines.push('  iqr <- q3 - q1');
  lines.push('');
  lines.push('  lower_bound <- q1 - 1.5 * iqr');
  lines.push('  upper_bound <- q3 + 1.5 * iqr');
  lines.push('');
  lines.push('  no_outliers <- valid[valid >= lower_bound & valid <= upper_bound]');
  lines.push('  if (length(no_outliers) == 0) return(NA)');
  lines.push('');
  lines.push('  return(mean(no_outliers))');
  lines.push('}');
  lines.push('');

  // Z-test for proportions (unpooled - matches WinCross default)
  lines.push('# Z-test for proportions (unpooled formula - WinCross default)');
  lines.push('# No minimum sample size - WinCross tests all data');
  lines.push('sig_test_proportion <- function(count1, n1, count2, n2, threshold = p_threshold) {');
  lines.push('  # Calculate proportions');
  lines.push('  p1 <- count1 / n1');
  lines.push('  p2 <- count2 / n2');
  lines.push('');
  lines.push('  # Edge case: can\'t test if either proportion is undefined');
  lines.push('  if (is.na(p1) || is.na(p2)) return(NA)');
  lines.push('');
  lines.push('  # Edge case: can\'t test if both are 0% or both are 100%');
  lines.push('  if ((p1 == 0 && p2 == 0) || (p1 == 1 && p2 == 1)) return(NA)');
  lines.push('');
  lines.push('  # Standard error (unpooled formula)');
  lines.push('  se <- sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)');
  lines.push('  if (is.na(se) || se == 0) return(NA)');
  lines.push('');
  lines.push('  # Z statistic');
  lines.push('  z <- (p1 - p2) / se');
  lines.push('');
  lines.push('  # Two-tailed p-value');
  lines.push('  p_value <- 2 * (1 - pnorm(abs(z)))');
  lines.push('');
  lines.push('  return(list(significant = p_value < threshold, higher = p1 > p2))');
  lines.push('}');
  lines.push('');

  // T-test for means (summary statistics version - doesn't need raw data)
  // Uses Welch's t-test formula with n, mean, sd from each group
  lines.push("# Welch's t-test for means using summary statistics (n, mean, sd)");
  lines.push('# Returns list(p_value, higher) or NA if cannot compute');
  lines.push('sig_test_mean_summary <- function(n1, mean1, sd1, n2, mean2, sd2, min_base = 0) {');
  lines.push('  # Check minimum base size');
  lines.push('  if (!is.na(min_base) && min_base > 0) {');
  lines.push('    if (n1 < min_base || n2 < min_base) return(NA)');
  lines.push('  }');
  lines.push('');
  lines.push('  # Need at least 2 observations for SD and variance');
  lines.push('  if (is.na(n1) || is.na(n2) || n1 < 2 || n2 < 2) return(NA)');
  lines.push('  if (is.na(mean1) || is.na(mean2)) return(NA)');
  lines.push('  if (is.na(sd1) || is.na(sd2)) return(NA)');
  lines.push('');
  lines.push('  # Handle zero variance (SD = 0)');
  lines.push('  if (sd1 == 0 && sd2 == 0) {');
  lines.push('    # Both have no variance - cannot compute t-test');
  lines.push('    # If means are exactly equal, not significant');
  lines.push('    # If means differ, technically infinite t-stat but we return NA');
  lines.push('    return(NA)');
  lines.push('  }');
  lines.push('');
  lines.push("  # Welch's t-test formula");
  lines.push('  var1 <- sd1^2');
  lines.push('  var2 <- sd2^2');
  lines.push('');
  lines.push('  # Standard error of the difference');
  lines.push('  se <- sqrt(var1/n1 + var2/n2)');
  lines.push('  if (se == 0) return(NA)  # Cannot divide by zero');
  lines.push('');
  lines.push('  # t statistic');
  lines.push('  t_stat <- (mean1 - mean2) / se');
  lines.push('');
  lines.push('  # Welch-Satterthwaite degrees of freedom');
  lines.push('  df_num <- (var1/n1 + var2/n2)^2');
  lines.push('  df_denom <- (var1/n1)^2/(n1-1) + (var2/n2)^2/(n2-1)');
  lines.push('  df <- df_num / df_denom');
  lines.push('');
  lines.push('  # Two-tailed p-value');
  lines.push('  p_value <- 2 * pt(-abs(t_stat), df)');
  lines.push('');
  lines.push('  return(list(p_value = p_value, higher = mean1 > mean2))');
  lines.push('}');
  lines.push('');

  // Legacy t-test with raw data (kept for backward compatibility)
  lines.push('# T-test for means using raw data (legacy, for backward compatibility)');
  lines.push('sig_test_mean <- function(vals1, vals2, threshold = p_threshold) {');
  lines.push('  n1 <- sum(!is.na(vals1))');
  lines.push('  n2 <- sum(!is.na(vals2))');
  lines.push('');
  lines.push('  if (n1 < 2 || n2 < 2) return(NA)  # Insufficient sample size');
  lines.push('');
  lines.push('  tryCatch({');
  lines.push('    result <- t.test(vals1, vals2, na.rm = TRUE)');
  lines.push('    m1 <- mean(vals1, na.rm = TRUE)');
  lines.push('    m2 <- mean(vals2, na.rm = TRUE)');
  lines.push('    return(list(significant = result$p.value < threshold, higher = m1 > m2))');
  lines.push('  }, error = function(e) {');
  lines.push('    return(NA)');
  lines.push('  })');
  lines.push('}');
  lines.push('');

  // Get cuts in same group
  lines.push('# Get other cuts in the same group (for within-group comparison)');
  lines.push('get_group_cuts <- function(cut_name) {');
  lines.push('  for (group_name in names(cut_groups)) {');
  lines.push('    if (cut_name %in% cut_groups[[group_name]]) {');
  lines.push('      return(cut_groups[[group_name]])');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return(c())');
  lines.push('}');
  lines.push('');
}

// =============================================================================
// Frequency Table Generator
// =============================================================================

function generateFrequencyTable(lines: string[], table: TableWithLoopFrame, isWeighted: boolean = false): void {
  const tableId = escapeRString(table.tableId);
  const questionText = escapeRString(table.questionText);

  // Determine data frame and cuts variable for this table
  const sanitizedFrame = table.loopDataFrame ? sanitizeVarName(table.loopDataFrame) : '';
  const frameName = sanitizedFrame || 'data';
  const cutsName = sanitizedFrame ? `cuts_${sanitizedFrame}` : 'cuts';
  const isLoopTable = !!sanitizedFrame;

  // Sanitize questionText for R comments (replace newlines with spaces)
  const commentSafeQuestion = table.questionText.replace(/[\r\n]+/g, ' ').trim();

  lines.push(`# -----------------------------------------------------------------------------`);
  lines.push(`# Table: ${table.tableId} (frequency)${table.isDerived ? ' [DERIVED]' : ''}${isLoopTable ? ` [LOOP: ${frameName}]` : ''}`);
  lines.push(`# Question: ${commentSafeQuestion}`);
  lines.push(`# Rows: ${table.rows.length}`);
  if (table.sourceTableId) {
    lines.push(`# Source: ${table.sourceTableId}`);
  }
  lines.push(`# -----------------------------------------------------------------------------`);
  lines.push('');

  const questionId = escapeRString(table.questionId || '');
  const sourceTableId = escapeRString(table.sourceTableId || '');
  const surveySection = escapeRString(table.surveySection || '');
  const baseText = escapeRString(table.baseText || '');
  const userNote = escapeRString(table.userNote || '');
  const tableSubtitle = escapeRString(table.tableSubtitle || '');

  const excludeReason = escapeRString(table.excludeReason || '');

  lines.push(`table_${sanitizeVarName(table.tableId)} <- list(`);
  lines.push(`  tableId = "${tableId}",`);
  lines.push(`  questionId = "${questionId}",`);
  lines.push(`  questionText = "${questionText}",`);
  lines.push(`  tableType = "frequency",`);
  lines.push(`  isDerived = ${table.isDerived ? 'TRUE' : 'FALSE'},`);
  lines.push(`  sourceTableId = "${sourceTableId}",`);
  lines.push(`  surveySection = "${surveySection}",`);
  lines.push(`  baseText = "${baseText}",`);
  lines.push(`  userNote = "${userNote}",`);
  lines.push(`  tableSubtitle = "${tableSubtitle}",`);
  lines.push(`  excluded = ${table.exclude ? 'TRUE' : 'FALSE'},`);
  lines.push(`  excludeReason = "${excludeReason}",`);
  lines.push('  data = list()');
  lines.push(')');
  lines.push('');

  lines.push(`for (cut_name in names(${cutsName})) {`);
  lines.push(`  cut_data <- apply_cut(${frameName}, ${cutsName}[[cut_name]])`);

  // Weight vector for this cut (filtered in parallel with cut_data)
  if (isWeighted) {
    const weightSource = isLoopTable ? `w_main_${sanitizeVarName(frameName)}` : 'w_main';
    lines.push(`  w_cut_mask <- ${cutsName}[[cut_name]]`);
    lines.push('  w_cut_mask[is.na(w_cut_mask)] <- FALSE');
    lines.push(`  w_cut <- ${weightSource}[w_cut_mask]`);
  }

  emitStructuralMaskApplication(lines, table, isWeighted);
  emitValidityMaskApplication(lines, table, isWeighted);

  const tid = sanitizeVarName(table.tableId);
  lines.push(`  table_${tid}$data[[cut_name]] <- list()`);
  const freqStatLettersVar = isLoopTable ? `cut_stat_letters_${frameName}` : 'cut_stat_letters';
  lines.push(`  table_${tid}$data[[cut_name]]$stat_letter <- ${freqStatLettersVar}[[cut_name]]`);

  // Emit table-level base for overview tables with varying item bases.
  // Excel renderers use this for the displayed base row instead of picking
  // one item's per-row observed count (which is misleading when bases vary).
  const tableCtx = getTableComputeContext(table);
  if (
    tableCtx?.effectiveBaseMode === 'table_mask_then_row_observed_n'
    && tableCtx.itemBaseRange != null
  ) {
    if (isWeighted) {
      lines.push(`  table_${tid}$data[[cut_name]]$table_base_n <- sum(w_cut)`);
    } else if (isLoopTable && table.rows.length > 0) {
      // For stacked/loop tables, nrow() counts all rows including iterations
      // where the respondent didn't participate (all-NA).  Use the non-NA count
      // of the first structural variable so the base reflects actual responses.
      const anchorVar = escapeRString(getRowSourceVariable(table.rows[0] as ExtendedTableRow));
      lines.push(`  table_${tid}$data[[cut_name]]$table_base_n <- sum(!is.na(safe_get_var(cut_data, "${anchorVar}")))`);
    } else {
      lines.push(`  table_${tid}$data[[cut_name]]$table_base_n <- nrow(cut_data)`);
    }
  }

  lines.push('');

  // Generate each row
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i] as ExtendedTableRow;
    const sourceVariable = getRowSourceVariable(row);
    const varName = escapeRString(sourceVariable);
    const label = escapeRString(row.label);
    const filterValue = row.filterValue;
    const rowKey = `${row.variable}_row_${i + 1}`;
    const isNet = row.isNet || false;
    const indent = row.indent || 0;
    const aggregationMode = getRowAggregationMode(row, table.tableType);
    const rowValueTokens = getRowValueTokens(row);
    const realNetComponents = getRealNetComponents(row);

    // Stat rows (Mean, Median, etc.) on frequency tables are computed inline
    // from the variable's values, not as frequency counts.
    if (aggregationMode === 'stat_summary') {
      lines.push(`  # Row ${i + 1}: ${row.label} (stat) for ${sourceVariable}`);
      lines.push(`  var_col <- safe_get_var(cut_data, "${varName}")`);
      lines.push('  if (!is.null(var_col)) {');

      // Exclude non-substantive codes (e.g., 98=Don't Know, 99=Refused) from
      // stat calculations — these inflate statistics on bounded scales.
      const tailCodesFreq = getRowTailExclusions(table, row);
      if (tailCodesFreq.length > 0) {
        const rVectorFreq = tailCodesFreq.join(', ');
        lines.push(`    # Exclude non-substantive codes from statistics: c(${rVectorFreq})`);
        lines.push(`    var_col[var_col %in% c(${rVectorFreq})] <- NA`);
      }

      lines.push('    valid_mask <- !is.na(var_col)');
      lines.push('    valid_vals <- as.numeric(var_col[valid_mask])');
      lines.push('    n_stat <- length(valid_vals)');

      // Generate the appropriate stat computation (weighted or unweighted)
      const statLabel = row.label.toLowerCase();
      if (isWeighted) {
        lines.push('    w_valid <- w_cut[valid_mask]');
        if (statLabel.includes('std') && statLabel.includes('err')) {
          lines.push('    stat_val <- if (n_stat > 1) round(weighted_sd_custom(w_valid, valid_vals) / sqrt(sum(w_valid)), 2) else NA');
        } else if (statLabel.includes('std') && statLabel.includes('dev')) {
          lines.push('    stat_val <- if (n_stat > 1) round(weighted_sd_custom(w_valid, valid_vals), 2) else NA');
        } else if (statLabel.includes('median')) {
          lines.push('    stat_val <- if (n_stat > 0) round(median(valid_vals), 1) else NA');
        } else {
          lines.push('    stat_val <- if (n_stat > 0) round(weighted_mean_custom(w_valid, valid_vals), 1) else NA');
        }
      } else {
        if (statLabel.includes('std') && statLabel.includes('err')) {
          lines.push('    stat_val <- if (n_stat > 1) round(sd(valid_vals) / sqrt(n_stat), 2) else NA');
        } else if (statLabel.includes('std') && statLabel.includes('dev')) {
          lines.push('    stat_val <- if (n_stat > 1) round(sd(valid_vals), 2) else NA');
        } else if (statLabel.includes('median')) {
          lines.push('    stat_val <- if (n_stat > 0) round(median(valid_vals), 1) else NA');
        } else {
          lines.push('    stat_val <- if (n_stat > 0) round(mean(valid_vals), 1) else NA');
        }
      }

      lines.push(`    table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`      label = "${label}",`);
      lines.push('      n = n_stat,');
      lines.push('      count = NA,');
      lines.push('      pct = stat_val,');
      lines.push(`      isNet = FALSE,`);
      lines.push('      isStat = TRUE,');
      lines.push(`      indent = ${indent},`);
      lines.push('      sig_higher_than = c(),');
      lines.push('      sig_vs_total = NA');
      lines.push('    )');
      lines.push('  } else {');
      lines.push(`    table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`      label = "${label}",`);
      lines.push('      n = 0,');
      lines.push('      count = NA,');
      lines.push('      pct = NA,');
      lines.push(`      isNet = FALSE,`);
      lines.push('      isStat = TRUE,');
      lines.push(`      indent = ${indent},`);
      lines.push('      sig_higher_than = c(),');
      lines.push('      sig_vs_total = NA');
      lines.push('    )');
      lines.push('  }');
      lines.push('');
      continue;
    }

    // Not-answered rows (e.g., "Not Ranked") count NA occurrences
    if (aggregationMode === 'not_answered') {
      lines.push(`  # Row ${i + 1}: ${row.label} (not answered) for ${sourceVariable}`);
      lines.push(`  var_col <- safe_get_var(cut_data, "${varName}")`);
      lines.push('  if (!is.null(var_col)) {');
      if (isWeighted) {
        lines.push('    base_n <- sum(w_cut)');
        lines.push('    na_mask <- is.na(var_col)');
        lines.push('    count <- sum(w_cut[na_mask], na.rm = TRUE)');
      } else {
        lines.push('    base_n <- length(var_col)');
        lines.push('    count <- sum(is.na(var_col))');
      }
      lines.push('    pct <- if (base_n > 0) count / base_n * 100 else 0');
      lines.push('');
      lines.push(`    table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`      label = "${label}",`);
      lines.push('      n = base_n,');
      lines.push('      count = count,');
      lines.push('      pct = pct,');
      lines.push(`      isNet = FALSE,`);
      lines.push(`      indent = ${indent},`);
      lines.push('      sig_higher_than = c(),');
      lines.push('      sig_vs_total = NA');
      lines.push('    )');
      lines.push('  } else {');
      lines.push(`    table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`      label = "${label}",`);
      lines.push('      n = 0,');
      lines.push('      count = 0,');
      lines.push('      pct = 0,');
      lines.push(`      isNet = FALSE,`);
      lines.push(`      indent = ${indent},`);
      lines.push('      sig_higher_than = c(),');
      lines.push('      sig_vs_total = NA,');
      lines.push(`      error = "Variable ${varName} not found"`);
      lines.push('    )');
      lines.push('  }');
      lines.push('');
      continue;
    }

    // Check for category header (visual grouping row with no data)
    const isCategoryHeader = row.variable === '_CAT_';

    if (isCategoryHeader) {
      // Category header: output row with null values, no computation
      // NOTE: Use NA instead of NULL because R's NULL inside a list serializes to {}
      // in JSON, while NA properly serializes to null
      lines.push(`  # Row ${i + 1}: Category header - ${row.label}`);
      lines.push(`  table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`    label = "${label}",`);
      lines.push('    n = NA,');
      lines.push('    count = NA,');
      lines.push('    pct = NA,');
      lines.push('    isNet = FALSE,');
      lines.push(`    indent = ${indent},`);
      lines.push('    isCategoryHeader = TRUE,');
      lines.push('    sig_higher_than = c(),');
      lines.push('    sig_vs_total = NA');
      lines.push('  )');
      lines.push('');
      continue; // Skip to next row
    }

    const filterValues = rowValueTokens;
    const hasMultipleValues = aggregationMode === 'single_variable_value_set';

    // Check for range pattern (e.g., "0-4", "10-35" for binned distributions)
    const rangeMatch = filterValue.match(/^(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)$/);

    if (aggregationMode === 'any_component_selected') {
      // NET row: aggregate counts from multiple variables
      lines.push(`  # Row ${i + 1}: NET - ${row.label} (components: ${realNetComponents.join(', ')})`);
      const componentVars = realNetComponents.map(v => `"${escapeRString(v)}"`).join(', ');
      lines.push(`  net_vars <- c(${componentVars})`);
      lines.push('  net_respondents <- rep(FALSE, nrow(cut_data))');
      lines.push('  for (net_var in net_vars) {');
      lines.push('    var_col <- safe_get_var(cut_data, net_var)');
      lines.push('    if (!is.null(var_col)) {');
      lines.push('      # Mark respondent if they have any non-NA value for this variable');
      lines.push('      net_respondents <- net_respondents | (!is.na(var_col) & var_col > 0)');
      lines.push('    }');
      lines.push('  }');
      lines.push('  # Base = table base (all qualified respondents in this cut)');
      if (isWeighted) {
        lines.push('  base_n <- sum(w_cut)');
        lines.push('  count <- sum(w_cut[net_respondents], na.rm = TRUE)');
      } else {
        lines.push('  base_n <- nrow(cut_data)');
        lines.push('  count <- sum(net_respondents, na.rm = TRUE)');
      }
      lines.push('  pct <- if (base_n > 0) count / base_n * 100 else 0');
    } else if (rangeMatch) {
      // Range filter value (e.g., "0-4" for binned distributions)
      const minVal = Number(rangeMatch[1]);
      const maxVal = Number(rangeMatch[2]);
      const rangeLow = Math.min(minVal, maxVal);
      const rangeHigh = Math.max(minVal, maxVal);
      lines.push(`  # Row ${i + 1}: ${sourceVariable} in range [${minVal}-${maxVal}]`);
      lines.push(`  var_col <- safe_get_var(cut_data, "${varName}")`);
      lines.push('  if (!is.null(var_col)) {');
      const rangeTailCodes = getRowTailExclusions(table, row);
      if (rangeTailCodes.length > 0) {
        const rangeTailVector = rangeTailCodes.join(', ');
        lines.push(`    var_col[var_col %in% c(${rangeTailVector})] <- NA`);
      }
      emitObservedBaseCount(lines, row, isWeighted);
      if (isWeighted) {
        lines.push(`    range_mask <- as.numeric(var_col) >= ${rangeLow} & as.numeric(var_col) <= ${rangeHigh} & !is.na(var_col)`);
        lines.push('    count <- weighted_count(w_cut, range_mask)');
      } else {
        lines.push(`    count <- sum(as.numeric(var_col) >= ${rangeLow} & as.numeric(var_col) <= ${rangeHigh} & !is.na(var_col), na.rm = TRUE)`);
      }
      lines.push('    pct <- if (base_n > 0) count / base_n * 100 else 0');
    } else if (hasMultipleValues) {
      // Multiple filter values (e.g., T2B "4,5")
      lines.push(`  # Row ${i + 1}: ${sourceVariable} IN (${filterValues.join(', ')})`);
      lines.push(`  var_col <- safe_get_var(cut_data, "${varName}")`);
      lines.push('  if (!is.null(var_col)) {');
      const multiTailCodes = getRowTailExclusions(table, row);
      if (multiTailCodes.length > 0) {
        const multiTailVector = multiTailCodes.join(', ');
        lines.push(`    var_col[var_col %in% c(${multiTailVector})] <- NA`);
      }
      emitObservedBaseCount(lines, row, isWeighted);
      if (isWeighted) {
        lines.push(`    multi_mask <- as.numeric(var_col) %in% c(${filterValues.join(', ')}) & !is.na(var_col)`);
        lines.push('    count <- weighted_count(w_cut, multi_mask)');
      } else {
        lines.push(`    count <- sum(as.numeric(var_col) %in% c(${filterValues.join(', ')}) & !is.na(var_col), na.rm = TRUE)`);
      }
      lines.push('    pct <- if (base_n > 0) count / base_n * 100 else 0');
    } else {
      // Standard single filter value
      lines.push(`  # Row ${i + 1}: ${sourceVariable} == ${filterValue}`);
      lines.push(`  var_col <- safe_get_var(cut_data, "${varName}")`);
      lines.push('  if (!is.null(var_col)) {');
      const singleTailCodes = getRowTailExclusions(table, row);
      if (singleTailCodes.length > 0) {
        const singleTailVector = singleTailCodes.join(', ');
        lines.push(`    var_col[var_col %in% c(${singleTailVector})] <- NA`);
      }
      emitObservedBaseCount(lines, row, isWeighted);
      if (isWeighted) {
        lines.push(`    val_mask <- as.numeric(var_col) == ${filterValue} & !is.na(var_col)`);
        lines.push('    count <- weighted_count(w_cut, val_mask)');
      } else {
        lines.push(`    count <- sum(as.numeric(var_col) == ${filterValue} & !is.na(var_col), na.rm = TRUE)`);
      }
      lines.push('    pct <- if (base_n > 0) count / base_n * 100 else 0');
    }

    lines.push('');
    if (isWeighted) {
      lines.push('    n_eff_val <- n_effective(w_cut)');
    }
    lines.push(`    table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
    lines.push(`      label = "${label}",`);
    lines.push('      n = base_n,');
    lines.push('      count = count,');
    lines.push('      pct = pct,');
    if (isWeighted) {
      lines.push('      n_eff = n_eff_val,');
    }
    lines.push(`      isNet = ${isNet ? 'TRUE' : 'FALSE'},`);
    lines.push(`      indent = ${indent},`);
    lines.push('      sig_higher_than = c(),');
    lines.push('      sig_vs_total = NA');
    lines.push('    )');

    // Close the if block for any row path that emitted `if (!is.null(var_col)) {`.
    // Numeric NET components (e.g., ["6","7"]) intentionally use the multi-value
    // single-variable path and must also emit this closing branch.
    if (aggregationMode !== 'any_component_selected') {
      lines.push('  } else {');
      lines.push(`    table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`      label = "${label}",`);
      lines.push('      n = 0,');
      lines.push('      count = 0,');
      lines.push('      pct = 0,');
      lines.push(`      isNet = ${isNet ? 'TRUE' : 'FALSE'},`);
      lines.push(`      indent = ${indent},`);
      lines.push('      sig_higher_than = c(),');
      lines.push('      sig_vs_total = NA,');
      lines.push(`      error = "Variable ${varName} not found"`);
      lines.push('    )');
      lines.push('  }');
    }
    lines.push('');
  }

  lines.push('}');
  lines.push('');
  lines.push(`all_tables[["${tableId}"]] <- table_${sanitizeVarName(table.tableId)}`);
  lines.push(`print(paste("Generated frequency table: ${tableId}"))`);
  lines.push('');
}

// =============================================================================
// Mean Rows Table Generator
// =============================================================================

function generateMeanRowsTable(lines: string[], table: TableWithLoopFrame, isWeighted: boolean = false): void {
  const tableId = escapeRString(table.tableId);
  const questionText = escapeRString(table.questionText);

  // Determine data frame and cuts variable for this table
  const sanitizedFrame = table.loopDataFrame ? sanitizeVarName(table.loopDataFrame) : '';
  const frameName = sanitizedFrame || 'data';
  const cutsName = sanitizedFrame ? `cuts_${sanitizedFrame}` : 'cuts';
  const isLoopTable = !!sanitizedFrame;

  // Sanitize questionText for R comments (replace newlines with spaces)
  const commentSafeQuestion = table.questionText.replace(/[\r\n]+/g, ' ').trim();

  lines.push(`# -----------------------------------------------------------------------------`);
  lines.push(`# Table: ${table.tableId} (mean_rows)${table.isDerived ? ' [DERIVED]' : ''}${isLoopTable ? ` [LOOP: ${frameName}]` : ''}`);
  lines.push(`# Question: ${commentSafeQuestion}`);
  lines.push(`# Rows: ${table.rows.length}`);
  if (table.sourceTableId) {
    lines.push(`# Source: ${table.sourceTableId}`);
  }
  lines.push(`# -----------------------------------------------------------------------------`);
  lines.push('');

  const questionId = escapeRString(table.questionId || '');
  const sourceTableId = escapeRString(table.sourceTableId || '');
  const surveySection = escapeRString(table.surveySection || '');
  const baseText = escapeRString(table.baseText || '');
  const userNote = escapeRString(table.userNote || '');
  const tableSubtitle = escapeRString(table.tableSubtitle || '');
  const excludeReason = escapeRString(table.excludeReason || '');

  lines.push(`table_${sanitizeVarName(table.tableId)} <- list(`);
  lines.push(`  tableId = "${tableId}",`);
  lines.push(`  questionId = "${questionId}",`);
  lines.push(`  questionText = "${questionText}",`);
  lines.push(`  tableType = "mean_rows",`);
  lines.push(`  isDerived = ${table.isDerived ? 'TRUE' : 'FALSE'},`);
  lines.push(`  sourceTableId = "${sourceTableId}",`);
  lines.push(`  surveySection = "${surveySection}",`);
  lines.push(`  baseText = "${baseText}",`);
  lines.push(`  userNote = "${userNote}",`);
  lines.push(`  tableSubtitle = "${tableSubtitle}",`);
  lines.push(`  excluded = ${table.exclude ? 'TRUE' : 'FALSE'},`);
  lines.push(`  excludeReason = "${excludeReason}",`);
  lines.push('  data = list()');
  lines.push(')');
  lines.push('');

  lines.push(`for (cut_name in names(${cutsName})) {`);
  lines.push(`  cut_data <- apply_cut(${frameName}, ${cutsName}[[cut_name]])`);

  // Weight vector for this cut
  if (isWeighted) {
    const weightSourceMean = isLoopTable ? `w_main_${sanitizeVarName(frameName)}` : 'w_main';
    lines.push(`  w_cut_mask <- ${cutsName}[[cut_name]]`);
    lines.push('  w_cut_mask[is.na(w_cut_mask)] <- FALSE');
    lines.push(`  w_cut <- ${weightSourceMean}[w_cut_mask]`);
  }

  emitStructuralMaskApplication(lines, table, isWeighted);
  emitValidityMaskApplication(lines, table, isWeighted);

  lines.push(`  table_${sanitizeVarName(table.tableId)}$data[[cut_name]] <- list()`);
  const meanStatLettersVar = isLoopTable ? `cut_stat_letters_${frameName}` : 'cut_stat_letters';
  const meanTid = sanitizeVarName(table.tableId);
  lines.push(`  table_${meanTid}$data[[cut_name]]$stat_letter <- ${meanStatLettersVar}[[cut_name]]`);

  // Emit table-level base for mean_rows tables with varying item bases
  const meanTableCtx = getTableComputeContext(table);
  if (
    meanTableCtx?.effectiveBaseMode === 'table_mask_then_row_observed_n'
    && meanTableCtx.itemBaseRange != null
  ) {
    if (isWeighted) {
      lines.push(`  table_${meanTid}$data[[cut_name]]$table_base_n <- sum(w_cut)`);
    } else if (isLoopTable && table.rows.length > 0) {
      const anchorVar = escapeRString(getRowSourceVariable(table.rows[0] as ExtendedTableRow));
      lines.push(`  table_${meanTid}$data[[cut_name]]$table_base_n <- sum(!is.na(safe_get_var(cut_data, "${anchorVar}")))`);
    } else {
      lines.push(`  table_${meanTid}$data[[cut_name]]$table_base_n <- nrow(cut_data)`);
    }
  }

  lines.push('');

  // Generate each row
  for (let i = 0; i < table.rows.length; i++) {
    const row = table.rows[i] as ExtendedTableRow;
    const sourceVariable = getRowSourceVariable(row);
    const varName = escapeRString(sourceVariable);
    const label = escapeRString(row.label);
    const rowKey = row.variable;  // For mean_rows, use variable name as key
    const _isNet = row.isNet || false;
    const indent = row.indent || 0;
    const aggregationMode = getRowAggregationMode(row, table.tableType);
    const realNetComponents = getRealNetComponents(row);

    if (aggregationMode === 'row_sum_components') {
      // NET row: mean of per-respondent row-sums across component variables
      lines.push(`  # Row ${i + 1}: NET - ${row.label} (mean of per-respondent row-sums)`);
      const componentVars = realNetComponents.map(v => `"${escapeRString(v)}"`).join(', ');
      lines.push(`  net_vars <- c(${componentVars})`);
      lines.push('  # Build matrix of component columns, compute row-sum per respondent');
      lines.push('  net_cols <- lapply(net_vars, function(v) {');
      lines.push('    col <- safe_get_var(cut_data, v)');
      lines.push('    if (!is.null(col)) as.numeric(col) else rep(NA_real_, nrow(cut_data))');
      lines.push('  })');
      lines.push('  net_matrix <- do.call(cbind, net_cols)');
      lines.push('  # Row-sum: NA only if ALL components are NA for that respondent');
      lines.push('  row_all_na <- apply(net_matrix, 1, function(r) all(is.na(r)))');
      lines.push('  row_sums <- rowSums(net_matrix, na.rm = TRUE)');
      lines.push('  row_sums[row_all_na] <- NA');
      if (isWeighted) {
        lines.push('  net_mean <- if (all(is.na(row_sums))) NA else round_half_up(weighted_mean_custom(w_cut, row_sums), 1)');
        lines.push('  # Base = weighted table base');
        lines.push('  n <- sum(w_cut)');
      } else {
        lines.push('  net_mean <- if (all(is.na(row_sums))) NA else round_half_up(mean(row_sums, na.rm = TRUE), 1)');
        lines.push('  # Base = table base (all qualified respondents in this cut)');
        lines.push('  n <- nrow(cut_data)');
      }
      lines.push('');
      lines.push(`  table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`    label = "${label}",`);
      lines.push('    n = n,');
      lines.push('    mean = net_mean,');
      lines.push('    mean_label = "Mean (sum of components)",');
      lines.push('    median = NA,');
      lines.push('    median_label = "",');
      lines.push('    sd = NA,');
      lines.push('    std_err = NA,');
      lines.push('    mean_no_outliers = NA,');
      lines.push('    mean_no_outliers_label = "",');
      lines.push(`    isNet = TRUE,`);
      lines.push(`    indent = ${indent},`);
      lines.push('    sig_higher_than = c(),');
      lines.push('    sig_vs_total = NA');
      lines.push('  )');
    } else {
      // Standard row: calculate mean from variable directly
      lines.push(`  # Row ${i + 1}: ${sourceVariable} (numeric summary)`);
      lines.push(`  var_col <- safe_get_var(cut_data, "${varName}")`);
      lines.push('  if (!is.null(var_col)) {');

      // Exclude non-substantive codes (e.g., 98=Don't Know, 99=Refused) from
      // mean/median/stddev — these inflate statistics on bounded scales.
      const tailCodes = getRowTailExclusions(table, row);
      if (tailCodes.length > 0) {
        const rVector = tailCodes.join(', ');
        lines.push(`    # Exclude non-substantive codes from statistics: c(${rVector})`);
        lines.push(`    var_col[var_col %in% c(${rVector})] <- NA`);
      }

      if (isWeighted) {
        lines.push('    # Get valid mask and weighted n');
        lines.push('    valid_mask <- !is.na(var_col)');
        lines.push('    valid_vals <- var_col[valid_mask]');
        lines.push('    w_valid <- w_cut[valid_mask]');
        if (usesSharedTableUniverse(row)) {
          lines.push('    n <- sum(w_cut)');
        } else {
          lines.push('    n <- weighted_base(w_cut, var_col)');
        }
        lines.push('');
        lines.push('    # Calculate weighted summary statistics');
        lines.push('    mean_val <- if (length(valid_vals) > 0) round_half_up(weighted_mean_custom(w_valid, valid_vals), 1) else NA');
        lines.push('    median_val <- if (length(valid_vals) > 0) round_half_up(median(valid_vals), 1) else NA  # median not weighted');
        lines.push('    sd_val <- if (length(valid_vals) > 1) round_half_up(weighted_sd_custom(w_valid, valid_vals), 1) else NA');
        lines.push('    std_err_val <- if (length(valid_vals) > 1) round_half_up(weighted_sd_custom(w_valid, valid_vals) / sqrt(sum(w_valid)), 2) else NA');
        lines.push('    mean_no_out <- if (length(valid_vals) > 3) round_half_up(mean_no_outliers(valid_vals), 1) else NA');
      } else {
        lines.push('    # Get valid (non-NA) values');
        lines.push('    valid_vals <- var_col[!is.na(var_col)]');
        if (usesSharedTableUniverse(row)) {
          lines.push('    n <- nrow(cut_data)');
        } else {
          lines.push('    n <- length(valid_vals)');
        }
        lines.push('');
        lines.push('    # Calculate summary statistics (all rounded to 1 decimal)');
        lines.push('    mean_val <- if (n > 0) round_half_up(mean(valid_vals), 1) else NA');
        lines.push('    median_val <- if (n > 0) round_half_up(median(valid_vals), 1) else NA');
        lines.push('    sd_val <- if (n > 1) round_half_up(sd(valid_vals), 1) else NA');
        lines.push('    std_err_val <- if (n > 1) round_half_up(sd(valid_vals) / sqrt(n), 2) else NA');
        lines.push('    mean_no_out <- if (n > 3) round_half_up(mean_no_outliers(valid_vals), 1) else NA');
      }
      lines.push('');
      lines.push(`    table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`      label = "${label}",`);
      lines.push('      n = n,');
      lines.push('      mean = mean_val,');
      lines.push('      mean_label = "Mean (overall)",');
      lines.push('      median = median_val,');
      lines.push('      median_label = "Median (overall)",');
      lines.push('      sd = sd_val,');
      lines.push('      std_err = std_err_val,');
      lines.push('      mean_no_outliers = mean_no_out,');
      lines.push('      mean_no_outliers_label = "Mean (minus outliers)",');
      lines.push(`      isNet = FALSE,`);
      lines.push(`      indent = ${indent},`);
      lines.push('      sig_higher_than = c(),');
      lines.push('      sig_vs_total = NA');
      lines.push('    )');
      lines.push('  } else {');
      lines.push(`    table_${sanitizeVarName(table.tableId)}$data[[cut_name]][["${escapeRString(rowKey)}"]] <- list(`);
      lines.push(`      label = "${label}",`);
      lines.push('      n = 0,');
      lines.push('      mean = NA,');
      lines.push('      mean_label = "Mean (overall)",');
      lines.push('      median = NA,');
      lines.push('      median_label = "Median (overall)",');
      lines.push('      sd = NA,');
      lines.push('      std_err = NA,');
      lines.push('      mean_no_outliers = NA,');
      lines.push('      mean_no_outliers_label = "Mean (minus outliers)",');
      lines.push(`      isNet = FALSE,`);
      lines.push(`      indent = ${indent},`);
      lines.push('      sig_higher_than = c(),');
      lines.push('      sig_vs_total = NA,');
      lines.push(`      error = "Variable ${varName} not found"`);
      lines.push('    )');
      lines.push('  }');
    }
    lines.push('');
  }

  lines.push('}');
  lines.push('');
  lines.push(`all_tables[["${tableId}"]] <- table_${sanitizeVarName(table.tableId)}`);
  lines.push(`print(paste("Generated mean_rows table: ${tableId}"))`);
  lines.push('');
}

// =============================================================================
// Significance Testing Pass
// =============================================================================

function generateSignificanceTesting(
  lines: string[],
  loopSemanticsPolicy?: LoopSemanticsPolicy,
  loopStatTestingMode?: 'suppress' | 'complement',
  compiledLoopContract?: CompiledLoopContract,
): void {
  lines.push('# =============================================================================');
  lines.push('# Significance Testing Pass');
  lines.push('# =============================================================================');
  lines.push('');
  lines.push('print("Running significance testing...")');
  lines.push('');

  // Build comparison mode lookup for entity-anchored, partitioned groups
  // Prefer compiled contract over raw policy
  lines.push('# Comparison mode by group (entity-anchored, shouldPartition=true)');
  lines.push('comparison_mode_by_group <- list()');
  if (compiledLoopContract) {
    const entityPartitionGroups = compiledLoopContract.groups.filter(
      g => g.anchorType === 'entity' && g.shouldPartition,
    );
    for (const group of entityPartitionGroups) {
      const safeGroupName = group.groupName.replace(/`/g, "'").replace(/"/g, '\\"');
      const comparisonMode = loopStatTestingMode || group.comparisonMode || 'suppress';
      lines.push(`comparison_mode_by_group[["${safeGroupName}"]] <- "${comparisonMode}"`);
    }
  } else {
    const entityPartitionGroups = loopSemanticsPolicy?.bannerGroups.filter(
      bp => bp.anchorType === 'entity' && bp.shouldPartition,
    ) || [];
    for (const group of entityPartitionGroups) {
      const safeGroupName = group.groupName.replace(/`/g, "'").replace(/"/g, '\\"');
      const comparisonMode = loopStatTestingMode || group.comparisonMode || 'suppress';
      lines.push(`comparison_mode_by_group[["${safeGroupName}"]] <- "${comparisonMode}"`);
    }
  }
  lines.push('');

  // Check if we have dual thresholds
  lines.push('# Check for dual threshold mode (uppercase = high conf, lowercase = low conf)');
  lines.push('has_dual_thresholds <- exists("p_threshold_high") && exists("p_threshold_low")');
  lines.push('');

  // Helper: get group name for a cut
  lines.push('# Get group name for a cut (from cut_groups)');
  lines.push('get_group_name <- function(cut_name) {');
  lines.push('  for (group_name in names(cut_groups)) {');
  lines.push('    if (cut_name %in% cut_groups[[group_name]]) {');
  lines.push('      return(group_name)');
  lines.push('    }');
  lines.push('  }');
  lines.push('  return(NA)');
  lines.push('}');
  lines.push('');

  lines.push('for (table_id in names(all_tables)) {');
  lines.push('  tbl <- all_tables[[table_id]]');
  lines.push('  table_type <- tbl$tableType');
  lines.push('');
  lines.push('  # Get row keys (skip metadata fields)');
  lines.push('  cut_names <- names(tbl$data)');
  lines.push('');
  lines.push('  for (cut_name in cut_names) {');
  lines.push('    cut_data_obj <- tbl$data[[cut_name]]');
  lines.push('    row_keys <- names(cut_data_obj)');
  lines.push('    row_keys <- row_keys[!row_keys %in% c("stat_letter", "table_base_n")]  # Skip metadata');
  lines.push('');
  lines.push('    # Get cuts in same group for within-group comparison');
  lines.push('    group_cuts <- get_group_cuts(cut_name)');
  lines.push('    group_name <- get_group_name(cut_name)');
  lines.push('    comparison_mode <- if (!is.na(group_name) && !is.null(comparison_mode_by_group[[group_name]])) comparison_mode_by_group[[group_name]] else "pairwise"');
  lines.push('');
  lines.push('    for (row_key in row_keys) {');
  lines.push('      row_data <- cut_data_obj[[row_key]]');
  lines.push('      if (is.null(row_data) || !is.null(row_data$error)) next');
  lines.push('');
  lines.push('      sig_higher <- c()');
  lines.push('');
  lines.push('      # Compare within group (pairwise, suppress, or vs complement)');
  lines.push('      if (comparison_mode == "pairwise") {');
  lines.push('        for (other_cut in group_cuts) {');
  lines.push('          if (other_cut == cut_name) next');
  lines.push('          if (!(other_cut %in% names(tbl$data))) next');
  lines.push('');
  lines.push('          other_data <- tbl$data[[other_cut]][[row_key]]');
  lines.push('          if (is.null(other_data) || !is.null(other_data$error)) next');
  lines.push('');
  lines.push('          other_letter <- cut_stat_letters[[other_cut]]');
  lines.push('');
  lines.push('          if (table_type == "frequency") {');
  lines.push('            # Skip category headers and rows with null values (e.g., visual grouping rows)');
  lines.push('            if (is.null(row_data$n) || is.null(row_data$count) ||');
  lines.push('                is.null(other_data$n) || is.null(other_data$count)) next');
  lines.push('');
  lines.push('            # Calculate p-value directly for dual threshold support');
  lines.push('            p1 <- row_data$count / row_data$n');
  lines.push('            p2 <- other_data$count / other_data$n');
  lines.push('            # Use effective n for sig testing when weighted (accounts for design effect)');
  lines.push('            n1 <- if (!is.null(row_data$n_eff)) row_data$n_eff else row_data$n');
  lines.push('            n2 <- if (!is.null(other_data$n_eff)) other_data$n_eff else other_data$n');
  lines.push('');
  lines.push('            # Skip if both proportions are same or undefined');
  lines.push('            if (is.na(p1) || is.na(p2)) next');
  lines.push('            if ((p1 == 0 && p2 == 0) || (p1 == 1 && p2 == 1)) next');
  lines.push('');
  lines.push('            # Calculate p-value (unpooled z-test)');
  lines.push('            se <- sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)');
  lines.push('            if (is.na(se) || se == 0) next');
  lines.push('            z <- (p1 - p2) / se');
  lines.push('            p_value <- 2 * (1 - pnorm(abs(z)))');
  lines.push('');
  lines.push('            # Only add letter if this column is higher');
  lines.push('            if (p1 > p2) {');
  lines.push('              if (has_dual_thresholds) {');
  lines.push('                # Dual mode: uppercase for high confidence, lowercase for low-only');
  lines.push('                if (p_value < p_threshold_high) {');
  lines.push('                  sig_higher <- c(sig_higher, toupper(other_letter))');
  lines.push('                } else if (p_value < p_threshold_low) {');
  lines.push('                  sig_higher <- c(sig_higher, tolower(other_letter))');
  lines.push('                }');
  lines.push('              } else {');
  lines.push('                # Single threshold mode');
  lines.push('                if (p_value < p_threshold) {');
  lines.push('                  sig_higher <- c(sig_higher, other_letter)');
  lines.push('                }');
  lines.push('              }');
  lines.push('            }');
  lines.push('          } else if (table_type == "mean_rows") {');
  lines.push("            # Welch's t-test using summary statistics (n, mean, sd)");
  lines.push('            # These are stored in each row during mean_rows table generation');
  lines.push('            if (!is.na(row_data$mean) && !is.na(other_data$mean) &&');
  lines.push('                !is.null(row_data$n) && !is.null(other_data$n) &&');
  lines.push('                !is.null(row_data$sd) && !is.null(other_data$sd)) {');
  lines.push('');
  lines.push('              # Get minimum base from config (defaults to 0 = no minimum)');
  lines.push('              min_base <- if (exists("stat_min_base")) stat_min_base else 0');
  lines.push('');
  lines.push('              # Use effective n for weighted data (if available)');
  lines.push('              n1_sig <- if (!is.null(row_data$n_eff)) row_data$n_eff else row_data$n');
  lines.push('              n2_sig <- if (!is.null(other_data$n_eff)) other_data$n_eff else other_data$n');
  lines.push('              result <- sig_test_mean_summary(');
  lines.push('                n1_sig, row_data$mean, row_data$sd,');
  lines.push('                n2_sig, other_data$mean, other_data$sd,');
  lines.push('                min_base');
  lines.push('              )');
  lines.push('');
  lines.push('              if (is.list(result) && !is.na(result$p_value) && result$higher) {');
  lines.push('                if (has_dual_thresholds) {');
  lines.push('                  if (result$p_value < p_threshold_high) {');
  lines.push('                    sig_higher <- c(sig_higher, toupper(other_letter))');
  lines.push('                  } else if (result$p_value < p_threshold_low) {');
  lines.push('                    sig_higher <- c(sig_higher, tolower(other_letter))');
  lines.push('                  }');
  lines.push('                } else {');
  lines.push('                  if (result$p_value < p_threshold) {');
  lines.push('                    sig_higher <- c(sig_higher, other_letter)');
  lines.push('                  }');
  lines.push('                }');
  lines.push('              }');
  lines.push('            }');
  lines.push('          }');
  lines.push('        }');
  lines.push('      } else if (comparison_mode == "complement") {');
  lines.push('        if ("Total" %in% names(tbl$data) && cut_name != "Total") {');
  lines.push('          total_data <- tbl$data[["Total"]][[row_key]]');
  lines.push('          if (!is.null(total_data) && is.null(total_data$error)) {');
  lines.push('            if (table_type == "frequency") {');
  lines.push('              if (is.null(row_data$n) || is.null(row_data$count) ||');
  lines.push('                  is.null(total_data$n) || is.null(total_data$count)) {');
  lines.push('                next');
  lines.push('              }');
  lines.push('              n_comp <- total_data$n - row_data$n');
  lines.push('              count_comp <- total_data$count - row_data$count');
  lines.push('              if (is.na(n_comp) || n_comp <= 0 || is.na(count_comp) || count_comp < 0) next');
  lines.push('');
  lines.push('              p1 <- row_data$count / row_data$n');
  lines.push('              p2 <- count_comp / n_comp');
  lines.push('');
  lines.push('              # Use effective n for sig testing when weighted (accounts for design effect)');
  lines.push('              n1 <- if (!is.null(row_data$n_eff)) row_data$n_eff else row_data$n');
  lines.push('              n2_raw <- if (!is.null(total_data$n_eff) && !is.null(row_data$n_eff)) total_data$n_eff - row_data$n_eff else n_comp');
  lines.push('              n2 <- if (is.na(n2_raw) || n2_raw <= 0) n_comp else n2_raw');
  lines.push('');
  lines.push('              if (is.na(p1) || is.na(p2)) next');
  lines.push('              if ((p1 == 0 && p2 == 0) || (p1 == 1 && p2 == 1)) next');
  lines.push('');
  lines.push('              se <- sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)');
  lines.push('              if (is.na(se) || se == 0) next');
  lines.push('              z <- (p1 - p2) / se');
  lines.push('              p_value <- 2 * (1 - pnorm(abs(z)))');
  lines.push('');
  lines.push('              if (p1 > p2) {');
  lines.push('                if (has_dual_thresholds) {');
  lines.push('                  if (p_value < p_threshold_high) {');
  lines.push('                    sig_higher <- c(sig_higher, "*")');
  lines.push('                  } else if (p_value < p_threshold_low) {');
  lines.push('                    sig_higher <- c(sig_higher, "*")');
  lines.push('                  }');
  lines.push('                } else {');
  lines.push('                  if (p_value < p_threshold) {');
  lines.push('                    sig_higher <- c(sig_higher, "*")');
  lines.push('                  }');
  lines.push('                }');
  lines.push('              }');
  lines.push('            } else if (table_type == "mean_rows") {');
  lines.push('              if (!is.na(row_data$mean) && !is.na(total_data$mean) &&');
  lines.push('                  !is.null(row_data$n) && !is.null(total_data$n) &&');
  lines.push('                  !is.null(row_data$sd) && !is.null(total_data$sd)) {');
  lines.push('');
  lines.push('                n_total <- if (!is.null(total_data$n_eff)) total_data$n_eff else total_data$n');
  lines.push('                n_a <- if (!is.null(row_data$n_eff)) row_data$n_eff else row_data$n');
  lines.push('                n_b <- n_total - n_a');
  lines.push('                if (is.na(n_b) || n_b <= 1) next');
  lines.push('');
  lines.push('                mean_total <- total_data$mean');
  lines.push('                mean_a <- row_data$mean');
  lines.push('                sd_total <- total_data$sd');
  lines.push('                sd_a <- row_data$sd');
  lines.push('');
  lines.push('                sum_total <- n_total * mean_total');
  lines.push('                sum_a <- n_a * mean_a');
  lines.push('                mean_b <- (sum_total - sum_a) / n_b');
  lines.push('');
  lines.push('                sumsq_total <- (n_total - 1) * (sd_total ^ 2) + n_total * (mean_total ^ 2)');
  lines.push('                sumsq_a <- (n_a - 1) * (sd_a ^ 2) + n_a * (mean_a ^ 2)');
  lines.push('                sumsq_b <- sumsq_total - sumsq_a');
  lines.push('                var_b <- (sumsq_b - n_b * (mean_b ^ 2)) / (n_b - 1)');
  lines.push('                if (is.na(var_b) || var_b <= 0) next');
  lines.push('                sd_b <- sqrt(var_b)');
  lines.push('');
  lines.push('                min_base <- if (exists("stat_min_base")) stat_min_base else 0');
  lines.push('                result <- sig_test_mean_summary(');
  lines.push('                  n_a, mean_a, sd_a,');
  lines.push('                  n_b, mean_b, sd_b,');
  lines.push('                  min_base');
  lines.push('                )');
  lines.push('');
  lines.push('                if (is.list(result) && !is.na(result$p_value) && result$higher) {');
  lines.push('                  if (has_dual_thresholds) {');
  lines.push('                    if (result$p_value < p_threshold_high) {');
  lines.push('                      sig_higher <- c(sig_higher, "*")');
  lines.push('                    } else if (result$p_value < p_threshold_low) {');
  lines.push('                      sig_higher <- c(sig_higher, "*")');
  lines.push('                    }');
  lines.push('                  } else {');
  lines.push('                    if (result$p_value < p_threshold) {');
  lines.push('                      sig_higher <- c(sig_higher, "*")');
  lines.push('                    }');
  lines.push('                  }');
  lines.push('                }');
  lines.push('              }');
  lines.push('            }');
  lines.push('          }');
  lines.push('        }');
  lines.push('      }');
  lines.push('');
  lines.push('      # Compare to Total');
  lines.push('      if ("Total" %in% names(tbl$data) && cut_name != "Total") {');
  lines.push('        total_data <- tbl$data[["Total"]][[row_key]]');
  lines.push('        if (!is.null(total_data) && is.null(total_data$error)) {');
  lines.push('          sig_vs_total <- NA');
  lines.push('');
  lines.push('          if (table_type == "frequency") {');
  lines.push('            # Skip category headers and rows with null values');
  lines.push('            if (is.null(row_data$n) || is.null(row_data$count) ||');
  lines.push('                is.null(total_data$n) || is.null(total_data$count)) {');
  lines.push('              sig_vs_total <- NA');
  lines.push('            } else {');
  lines.push('              p1 <- row_data$count / row_data$n');
  lines.push('              p2 <- total_data$count / total_data$n');
  lines.push('              n1 <- if (!is.null(row_data$n_eff)) row_data$n_eff else row_data$n');
  lines.push('              n2 <- if (!is.null(total_data$n_eff)) total_data$n_eff else total_data$n');
  lines.push('');
  lines.push('              if (!is.na(p1) && !is.na(p2) && !((p1 == 0 && p2 == 0) || (p1 == 1 && p2 == 1))) {');
  lines.push('                se <- sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)');
  lines.push('                if (!is.na(se) && se > 0) {');
  lines.push('                  z <- (p1 - p2) / se');
  lines.push('                  p_value <- 2 * (1 - pnorm(abs(z)))');
  lines.push('                  threshold_to_use <- if (has_dual_thresholds) p_threshold_high else p_threshold');
  lines.push('                  if (p_value < threshold_to_use) {');
  lines.push('                    sig_vs_total <- if (p1 > p2) "higher" else "lower"');
  lines.push('                  }');
  lines.push('                }');
  lines.push('              }');
  lines.push('            }');
  lines.push('          } else if (table_type == "mean_rows") {');
  lines.push("            # Welch's t-test vs Total using summary statistics");
  lines.push('            if (!is.na(row_data$mean) && !is.na(total_data$mean) &&');
  lines.push('                !is.null(row_data$n) && !is.null(total_data$n) &&');
  lines.push('                !is.null(row_data$sd) && !is.null(total_data$sd)) {');
  lines.push('');
  lines.push('              min_base <- if (exists("stat_min_base")) stat_min_base else 0');
  lines.push('');
  lines.push('              n1_sig <- if (!is.null(row_data$n_eff)) row_data$n_eff else row_data$n');
  lines.push('              n2_sig <- if (!is.null(total_data$n_eff)) total_data$n_eff else total_data$n');
  lines.push('              result <- sig_test_mean_summary(');
  lines.push('                n1_sig, row_data$mean, row_data$sd,');
  lines.push('                n2_sig, total_data$mean, total_data$sd,');
  lines.push('                min_base');
  lines.push('              )');
  lines.push('');
  lines.push('              if (is.list(result) && !is.na(result$p_value)) {');
  lines.push('                threshold_to_use <- if (has_dual_thresholds) p_threshold_high else p_threshold');
  lines.push('                if (result$p_value < threshold_to_use) {');
  lines.push('                  sig_vs_total <- if (result$higher) "higher" else "lower"');
  lines.push('                }');
  lines.push('              }');
  lines.push('            }');
  lines.push('          }');
  lines.push('');
  lines.push('          all_tables[[table_id]]$data[[cut_name]][[row_key]]$sig_vs_total <- sig_vs_total');
  lines.push('        }');
  lines.push('      }');
  lines.push('');
  lines.push('      # Update sig_higher_than');
  lines.push('      all_tables[[table_id]]$data[[cut_name]][[row_key]]$sig_higher_than <- sig_higher');
  lines.push('    }');
  lines.push('  }');
  lines.push('}');
  lines.push('');
  lines.push('print("Significance testing complete")');
  lines.push('');
}

// =============================================================================
// Loop Semantics Policy Validation
// =============================================================================

/**
 * Generate R code to validate the loop semantics policy on real data.
 * For each entity-anchored group with shouldPartition=true, checks that:
 * - Sum of bases equals total (no overlap)
 * - No pairwise overlaps between cuts in the group
 */
function generateLoopPolicyValidation(
  lines: string[],
  policy: LoopSemanticsPolicy | undefined,
  cuts: CutDefinition[],
  loopMappings: LoopGroupMapping[],
  outputDir: string,
  compiledLoopContract?: CompiledLoopContract,
): void {
  // Prefer compiled contract for determining entity-partitioned groups
  // Expand multi-frame entries into one validation entry per (group, frame) pair
  const entityPartitionGroups = compiledLoopContract
    ? compiledLoopContract.groups
        .filter(g => g.anchorType === 'entity' && g.shouldPartition)
        .flatMap(g => getTargetFrames(g).map(frame => ({ groupName: g.groupName, stackedFrameName: frame })))
    : (policy?.bannerGroups ?? [])
        .filter(bp => bp.anchorType === 'entity' && bp.shouldPartition)
        .map(bp => ({ groupName: bp.groupName, stackedFrameName: bp.stackedFrameName }));

  if (entityPartitionGroups.length === 0) return;

  lines.push('# =============================================================================');
  lines.push('# Loop Semantics Policy Validation');
  lines.push('# =============================================================================');
  lines.push('');
  lines.push('loop_policy_validation <- list()');
  lines.push('');

  for (const epg of entityPartitionGroups) {
    const groupName = epg.groupName;
    const safeGroupName = escapeRString(groupName);
    const varName = `lpv_${sanitizeVarName(groupName)}`;
    const frameName = epg.stackedFrameName || loopMappings[0]?.stackedFrameName || 'data';
    const cutsVarName = `cuts_${frameName}`;

    // Get cut names for this group
    const groupCuts = cuts.filter(c => c.groupName === groupName && c.name !== 'Total');
    if (groupCuts.length === 0) continue;

    lines.push(`# Validate: ${groupName} (entity-anchored, shouldPartition=true)`);

    // Build masks
    lines.push(`${varName}_masks <- list(`);
    const maskLines: string[] = [];
    for (const cut of groupCuts) {
      const safeCutName = cut.name.replace(/`/g, "'").replace(/"/g, '\\"');
      maskLines.push(`  \`${safeCutName}\` = ${cutsVarName}[["${safeCutName}"]]`);
    }
    lines.push(maskLines.join(',\n'));
    lines.push(')');
    lines.push('');

    // Compute bases and check partition
    lines.push(`${varName}_total <- nrow(${frameName})`);
    lines.push(`${varName}_bases <- sapply(${varName}_masks, function(m) sum(m, na.rm = TRUE))`);
    lines.push(`${varName}_sum_bases <- sum(${varName}_bases)`);
    // NA count: all masks share the same alias column, so NA pattern is identical across masks.
    // Just check the first mask's NA count.
    lines.push(`${varName}_na_count <- sum(is.na(${varName}_masks[[1]]))`);
    lines.push('');

    // Pairwise overlap check
    lines.push(`${varName}_overlaps <- list()`);
    lines.push(`${varName}_names <- names(${varName}_masks)`);
    lines.push(`for (i in seq_along(${varName}_masks)) {`);
    lines.push(`  for (j in seq_len(i - 1)) {`);
    lines.push(`    overlap <- sum(${varName}_masks[[i]] & ${varName}_masks[[j]], na.rm = TRUE)`);
    lines.push('    if (overlap > 0) {');
    lines.push(`      ${varName}_overlaps[[paste0(${varName}_names[i], " x ", ${varName}_names[j])]] <- overlap`);
    lines.push('    }');
    lines.push('  }');
    lines.push('}');
    lines.push('');

    // Store validation result
    lines.push(`loop_policy_validation[["${safeGroupName}"]] <- list(`);
    lines.push(`  groupName = "${safeGroupName}",`);
    lines.push('  anchorType = "entity",');
    lines.push('  shouldPartition = TRUE,');
    lines.push(`  totalBase = ${varName}_total,`);
    lines.push(`  sumOfBases = ${varName}_sum_bases,`);
    lines.push(`  naCount = ${varName}_na_count,`);
    lines.push(`  partitionValid = (${varName}_sum_bases + ${varName}_na_count == ${varName}_total) && (length(${varName}_overlaps) == 0),`);
    lines.push(`  bases = as.list(${varName}_bases),`);
    lines.push(`  overlaps = ${varName}_overlaps`);
    lines.push(')');
    lines.push('');
  }

  // Write validation results
  lines.push(`# Create validation output directory`);
  lines.push(`if (!dir.exists("${outputDir}")) {`);
  lines.push(`  dir.create("${outputDir}", recursive = TRUE)`);
  lines.push('}');
  lines.push(`write_json(loop_policy_validation, file.path("${outputDir}", "loop-semantics-validation.json"), auto_unbox = TRUE, pretty = TRUE)`);
  lines.push('print("Loop semantics validation results written")');
  lines.push('');
}

// =============================================================================
// JSON Output
// =============================================================================

interface JsonOutputMetadata {
  totalRespondents?: number;
  bannerGroups: BannerGroup[];
  comparisonGroups: string[];
  significanceThresholds: number[];  // e.g., [0.05, 0.10] or [0.10]
}

function generateExportDataMaterialization(
  lines: string[],
  loopMappings: LoopGroupMapping[],
): void {
  const frameNames = [...new Set(
    loopMappings
      .map((mapping) => mapping.stackedFrameName?.trim() ?? '')
      .filter((frameName) => frameName.length > 0),
  )].sort();

  if (frameNames.length === 0) return;

  lines.push('# =============================================================================');
  lines.push('# Materialize Routed Export Data Files');
  lines.push('# =============================================================================');
  lines.push('');
  lines.push('if (!exists(".hawktab_export_data_errors", inherits = FALSE)) .hawktab_export_data_errors <- c()');
  lines.push('export_data_dir <- file.path("export", "data")');
  lines.push('if (!dir.exists(export_data_dir)) {');
  lines.push('  dir.create(export_data_dir, recursive = TRUE)');
  lines.push('}');
  lines.push('');

  for (const frameName of frameNames) {
    const safeFrameName = escapeRString(frameName);
    const relativePath = `export/data/${frameName}.sav`;
    lines.push(`if (exists("${safeFrameName}", inherits = FALSE)) {`);
    lines.push('  tryCatch({');
    lines.push(`    export_df <- ${frameName}`);
    lines.push(`    # Drop internal computation columns before export`);
    lines.push(`    internal_cols <- grep("^\\\\.loop_iter$|^HT_", names(export_df), value = TRUE)`);
    lines.push(`    if (length(internal_cols) > 0) export_df <- export_df[, !names(export_df) %in% internal_cols, drop = FALSE]`);
    lines.push(`    haven::write_sav(export_df, file.path("export", "data", "${safeFrameName}.sav"))`);
    lines.push(`    print("Export data file saved to: ${relativePath}")`);
    lines.push('  }, error = function(e) {');
    lines.push(`    .hawktab_export_data_errors <<- c(.hawktab_export_data_errors, paste0("${safeFrameName}: ", e$message))`);
    lines.push(`    warning(paste("Failed to write export data file for ${safeFrameName}:", e$message))`);
    lines.push('  })');
    lines.push('} else {');
    lines.push(`  .hawktab_export_data_errors <<- c(.hawktab_export_data_errors, "missing data frame: ${safeFrameName}")`);
    lines.push(`  warning("Expected stacked export data frame ${safeFrameName} was not created")`);
    lines.push('}');
    lines.push('');
  }
}

function generateJsonOutput(
  lines: string[],
  tables: ExtendedTableDefinition[],
  cuts: CutDefinition[],
  outputDir: string,
  metadata: JsonOutputMetadata,
  isWeighted: boolean = false,
  weightVariable?: string,
): void {
  lines.push('# =============================================================================');
  lines.push('# Save Results as JSON');
  lines.push('# =============================================================================');
  lines.push('');
  lines.push(`# Create output directory`);
  lines.push(`if (!dir.exists("${outputDir}")) {`);
  lines.push(`  dir.create("${outputDir}", recursive = TRUE)`);
  lines.push('}');
  lines.push('');

  // Build banner groups JSON for R
  const bannerGroupsJson = JSON.stringify(metadata.bannerGroups);
  const comparisonGroupsJson = JSON.stringify(metadata.comparisonGroups);
  const thresholds = metadata.significanceThresholds;
  const hasMultipleThresholds = thresholds.length >= 2 && thresholds[0] !== thresholds[1];

  lines.push('# Build final output structure');
  lines.push('output <- list(');
  lines.push('  metadata = list(');
  lines.push(`    generatedAt = "${new Date().toISOString()}",`);
  lines.push(`    tableCount = ${tables.length},`);
  lines.push(`    cutCount = ${cuts.length},`);  // Total is now included in cuts

  // Significance testing methodology documentation
  lines.push('    significanceTest = "unpooled z-test for column proportions",');
  lines.push('    meanSignificanceTest = "two-sample t-test",');

  // Thresholds as array
  if (hasMultipleThresholds) {
    lines.push(`    significanceThresholds = c(${thresholds[0]}, ${thresholds[1]}),`);
    lines.push('    significanceNotation = list(');
    lines.push(`      high = list(pValue = ${thresholds[0]}, confidence = ${Math.round((1 - thresholds[0]) * 100)}, case = "uppercase"),`);
    lines.push(`      low = list(pValue = ${thresholds[1]}, confidence = ${Math.round((1 - thresholds[1]) * 100)}, case = "lowercase")`);
    lines.push('    ),');
  } else {
    lines.push(`    significanceThresholds = c(${thresholds[0]}),`);
  }

  // Keep significanceLevel for backward compatibility (uses first/primary threshold)
  lines.push(`    significanceLevel = ${thresholds[0]},`);

  // Add totalRespondents (use nrow(data) if not provided)
  if (metadata.totalRespondents !== undefined) {
    lines.push(`    totalRespondents = ${metadata.totalRespondents},`);
  } else {
    lines.push('    totalRespondents = nrow(data),');
  }
  // Add banner groups and comparison groups
  lines.push(`    bannerGroups = fromJSON('${bannerGroupsJson.replace(/'/g, "\\'")}'),`);
  lines.push(`    comparisonGroups = fromJSON('${comparisonGroupsJson.replace(/'/g, "\\'")}')`);
  lines.push('  ),');
  if (isWeighted) {
    // Use unweighted tables as placeholder — overridden per mode below
    lines.push('  tables = all_tables_unweighted');
  } else {
    lines.push('  tables = all_tables');
  }
  lines.push(')');
  lines.push('');

  if (isWeighted) {
    // Dual JSON output: one for each weight mode
    lines.push('# Write dual JSON output (weighted + unweighted)');
    lines.push('for (wm in weight_modes) {');
    lines.push('  output_tables <- sanitize_for_json(get(paste0("all_tables_", wm)))');
    lines.push('  output_wm <- output');
    lines.push('  output_wm$tables <- output_tables');
    lines.push('  output_wm$metadata$weighted <- (wm == "weighted")');
    lines.push(`  output_wm$metadata$weightVariable <- if (wm == "weighted") "${escapeRString(weightVariable!)}" else ""`);
    lines.push(`  output_path <- file.path("${outputDir}", paste0("tables-", wm, ".json"))`);
    lines.push('  write_json(output_wm, output_path, pretty = TRUE, auto_unbox = TRUE)');
    lines.push('  print(paste("JSON output saved to:", output_path))');
    lines.push('}');
  } else {
    lines.push('# Write JSON output');
    lines.push('output$tables <- sanitize_for_json(output$tables)');
    lines.push(`output_path <- file.path("${outputDir}", "tables.json")`);
    lines.push('write_json(output, output_path, pretty = TRUE, auto_unbox = TRUE)');
    lines.push('print(paste("JSON output saved to:", output_path))');
  }
  lines.push('');

  lines.push('# Summary');
  lines.push('print(paste(rep("=", 60), collapse = ""))');
  lines.push('print(paste("SUMMARY"))');
  if (isWeighted) {
    lines.push('print(paste("  Tables generated:", length(all_tables_weighted), "(per mode)"))');
    lines.push(`print(paste("  Weight variable: ${weightVariable}"))`);
    lines.push('print(paste("  Output: tables-weighted.json + tables-unweighted.json"))');
  } else {
    lines.push('print(paste("  Tables generated:", length(all_tables)))');
    lines.push('print(paste("  Output:", output_path))');
  }
  lines.push('print(paste("  Cuts applied:", length(cuts)))');
  lines.push('print(paste("  Significance level:", p_threshold))');
  lines.push('if (length(.hawktab_cut_errors) > 0) {');
  lines.push('  print(paste("  CUT ERRORS:", length(.hawktab_cut_errors), "cut(s) failed — those columns are empty"))');
  lines.push('  for (err in .hawktab_cut_errors) print(paste("    -", err))');
  lines.push('}');
  lines.push('if (exists(".hawktab_export_data_errors", inherits = FALSE) && length(.hawktab_export_data_errors) > 0) {');
  lines.push('  print(paste("  EXPORT DATA ERRORS:", length(.hawktab_export_data_errors), "file(s) failed to materialize"))');
  lines.push('  for (err in .hawktab_export_data_errors) print(paste("    -", err))');
  lines.push('}');
  lines.push('print(paste(rep("=", 60), collapse = ""))');
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Escape special characters for R string literals
 */
function escapeRString(str: string): string {
  return str
    .replace(/\\/g, '\\\\')  // Backslash first
    .replace(/"/g, '\\"')     // Double quotes
    .replace(/\n/g, '\\n')    // Newlines
    .replace(/\r/g, '\\r')    // Carriage returns
    .replace(/\t/g, '\\t')    // Tabs
    // Normalize uncommon line separators that can break R parsing
    .replace(/[\u2028\u2029\u0085]/g, '\\n')
    // Replace other control chars (except escaped \n/\r/\t) with spaces
    .replace(/[\u0000-\u001F]/g, ' ');
}

/**
 * Sanitize a string for use as an R variable name
 */
function sanitizeVarName(str: string): string {
  return str
    .replace(/[^a-zA-Z0-9_]/g, '_')  // Replace non-alphanumeric with underscore
    .replace(/^([0-9])/, '_$1');      // Prefix with _ if starts with digit
}

// =============================================================================
// Banner Groups Utilities
// =============================================================================

/**
 * Build banner groups structure from cuts (for Excel formatter metadata)
 * Reorders to put Total first, then other groups in order
 */
function buildBannerGroupsFromCuts(
  cuts: CutDefinition[],
  cutGroups: CutGroup[],
  totalStatLetter: string | null
): BannerGroup[] {
  const groups: BannerGroup[] = [];

  // First, add Total group (always - Total is hardcoded in R script)
  groups.push({
    groupName: 'Total',
    columns: [{ name: 'Total', statLetter: totalStatLetter || 'T' }]
  });

  // Then add other groups in order (excluding Total)
  if (cutGroups.length > 0) {
    for (const group of cutGroups) {
      if (group.groupName === 'Total') continue;
      groups.push({
        groupName: group.groupName,
        columns: group.cuts.map(c => ({
          name: c.name,
          statLetter: c.statLetter
        }))
      });
    }
  } else {
    // Derive from cuts if no groups provided
    const groupMap = new Map<string, BannerGroupColumn[]>();
    for (const cut of cuts) {
      if (cut.name === 'Total' || cut.groupName === 'Total') continue;
      if (!groupMap.has(cut.groupName)) {
        groupMap.set(cut.groupName, []);
      }
      groupMap.get(cut.groupName)!.push({
        name: cut.name,
        statLetter: cut.statLetter
      });
    }
    for (const [groupName, columns] of groupMap) {
      groups.push({ groupName, columns });
    }
  }

  return groups;
}

/**
 * Build comparison groups array (e.g., ["A/B/C/D/E", "F/G", "H/I"])
 * Each group's stat letters joined with /, groups as array
 */
function buildComparisonGroups(bannerGroups: BannerGroup[]): string[] {
  const groups: string[] = [];

  for (const group of bannerGroups) {
    // Skip Total from comparison groups (it's compared against individually)
    if (group.groupName === 'Total') continue;
    if (group.columns.length < 2) continue; // Need at least 2 columns for comparison

    const letters = group.columns.map(c => c.statLetter).join('/');
    groups.push(letters);
  }

  return groups;
}

// =============================================================================
// Exports for Testing
// =============================================================================

// Note: generateRScriptV2, generateRScriptV2WithValidation, validateTable, validateAllTables
// are already exported at their definition sites above.

export {
  // Internal generators (for testing)
  generateCutsDefinition,
  generateDemoTable,
  generateHelperFunctions,
  generateFrequencyTable,
  generateMeanRowsTable,
  generateSignificanceTesting,
  generateLoopPolicyValidation,
  generateJsonOutput,
  generateStackingPreamble,
  // Utilities
  escapeRString,
  sanitizeVarName,
  sanitizeRColumnName,
  buildBannerGroupsFromCuts,
  buildComparisonGroups,
};
