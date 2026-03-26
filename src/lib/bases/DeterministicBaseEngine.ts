/**
 * DeterministicBaseEngine
 *
 * Computes per-table base directives by reading the .sav file directly.
 * A non-NA value means the respondent answered; NA means they were not asked.
 *
 * This replaces the AI-driven chain: SkipLogicAgent → FilterTranslatorAgent.
 *
 * R subprocess pattern adapted from scripts/audit-base-vs-skiplogic.ts
 * (both generate similar R code; linked by comment rather than shared module
 * to keep the audit script self-contained).
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { promises as fs } from 'fs';
import path from 'path';
import type { ExtendedTableDefinition } from '../../schemas/verificationAgentSchema';
import type {
  BaseDirective,
  BaseEngineResult,
  BaseEngineOptions,
  TableSpec,
  RAuditResult,
  RowGroupDirective,
} from './types';

const execFileAsync = promisify(execFile);

// =============================================================================
// Default thresholds
// =============================================================================

const DEFAULT_BASE_GAP_PCT = 2;
const DEFAULT_ROW_GAP_PCT = 2;
const DEFAULT_SUM_COMPLETE_MIN = 0.9;
const DEFAULT_SUM_TOLERANCE = 5;

// =============================================================================
// Public API
// =============================================================================

/**
 * Main entry point: compute base directives for all tables.
 *
 * @param tables - ExtendedTableDefinition[] (post-verification or post-TableGenerator)
 * @param savPath - Absolute path to the .sav data file
 * @param outputDir - Pipeline output directory (for temp R script)
 * @param opts - Optional threshold overrides
 */
export async function computeBaseDirectives(
  tables: ExtendedTableDefinition[],
  savPath: string,
  outputDir: string,
  opts?: BaseEngineOptions,
): Promise<BaseEngineResult> {
  const startTime = Date.now();

  const baseGapPct = opts?.baseGapPct ?? DEFAULT_BASE_GAP_PCT;
  const rowGapPct = opts?.rowGapPct ?? DEFAULT_ROW_GAP_PCT;
  const sumCompleteMin = opts?.sumCompleteMin ?? DEFAULT_SUM_COMPLETE_MIN;
  const sumTolerance = opts?.sumTolerance ?? DEFAULT_SUM_TOLERANCE;

  // Build table specs from ExtendedTableDefinition[]
  const specs = buildTableSpecs(tables);

  if (specs.length === 0) {
    return {
      directives: [],
      totalN: 0,
      tablesAnalyzed: 0,
      tablesWithBaseGap: 0,
      tablesWithRowSplits: 0,
      durationMs: Date.now() - startTime,
    };
  }

  // Write specs to temp file for R to consume
  const basesDir = path.join(outputDir, 'bases');
  await fs.mkdir(basesDir, { recursive: true });

  const specsPath = path.join(basesDir, 'table-specs.json');
  await fs.writeFile(specsPath, JSON.stringify({ tables: specs }, null, 2), 'utf-8');

  // Run R to compute masks
  const rscript = await findRscriptBinary();
  const rScriptPath = path.join(basesDir, '_base_engine.R');
  const metrics = await runBaseAuditR({
    rscript,
    savPath,
    specsPath,
    scriptPath: rScriptPath,
    sumTolerance,
  });

  // Persist raw metrics for debugging
  await fs.writeFile(
    path.join(basesDir, 'base-metrics.json'),
    JSON.stringify({ config: { baseGapPct, rowGapPct, sumCompleteMin, sumTolerance }, ...metrics }, null, 2),
    'utf-8',
  );

  // Convert metrics → directives
  const directives = buildDirectives(specs, metrics, {
    baseGapPct,
    rowGapPct,
    sumCompleteMin,
    sumTolerance,
  });

  // Persist directives for debugging
  await fs.writeFile(
    path.join(basesDir, 'base-directives.json'),
    JSON.stringify(directives, null, 2),
    'utf-8',
  );

  const tablesWithBaseGap = directives.filter(d => d.needsTableFilter).length;
  const tablesWithRowSplits = directives.filter(d => d.needsRowSplit).length;

  const result: BaseEngineResult = {
    directives,
    totalN: metrics.totalN,
    tablesAnalyzed: specs.length,
    tablesWithBaseGap,
    tablesWithRowSplits,
    durationMs: Date.now() - startTime,
  };

  // Persist summary
  await fs.writeFile(
    path.join(basesDir, 'base-engine-summary.json'),
    JSON.stringify(result, null, 2),
    'utf-8',
  );

  return result;
}

// =============================================================================
// Table spec builder
// =============================================================================

/**
 * Convert ExtendedTableDefinition[] to R-consumable table specs.
 * Skips excluded tables, NET rows, and tables without questionId.
 */
export function buildTableSpecs(tables: ExtendedTableDefinition[]): TableSpec[] {
  const specs: TableSpec[] = [];

  for (const table of tables) {
    if (table.exclude) continue;
    const tableId = (table.tableId || '').trim();
    const questionId = (table.questionId || '').trim();
    if (!tableId || !questionId) continue;

    const variables = new Set<string>();
    const rowGroups = new Map<string, Set<string>>();

    for (const row of table.rows || []) {
      const variable = (row.variable || '').trim();
      if (!variable) continue;
      if (variable.startsWith('_NET_')) continue; // Skip computed NET rows
      variables.add(variable);

      const parsed = parseRowGroup(variable);
      if (!parsed) continue;
      if (!rowGroups.has(parsed.groupId)) rowGroups.set(parsed.groupId, new Set<string>());
      rowGroups.get(parsed.groupId)!.add(variable);
    }

    const variableList = [...variables].sort();
    const rowGroupList = [...rowGroups.entries()]
      .map(([groupId, vars]) => ({ groupId, variables: [...vars].sort() }))
      .filter((group) => group.variables.length >= 2) // Only groups with 2+ vars
      .sort((a, b) => a.groupId.localeCompare(b.groupId));

    specs.push({
      tableId,
      questionId,
      variables: variableList,
      rowGroups: rowGroupList,
      expectsSum100: hasSum100Cue(table.questionText || '', table.userNote || ''),
    });
  }

  return specs.sort((a, b) => a.tableId.localeCompare(b.tableId));
}

// =============================================================================
// Filter expression generator
// =============================================================================

/**
 * Build an R filter expression: "at least one variable is non-NA".
 * Pattern: !is.na(`v1`) | !is.na(`v2`) | ...
 */
export function generateFilterExpression(variables: string[]): string {
  if (variables.length === 0) return '';
  return variables.map(v => `!is.na(\`${v}\`)`).join(' | ');
}

/**
 * Build an R filter expression for row groups that must sum to 100.
 * Pattern: complete row + abs(sum(vars) - 100) <= tol
 */
export function generateSum100FilterExpression(variables: string[], tolerance = DEFAULT_SUM_TOLERANCE): string {
  if (variables.length < 2) return generateFilterExpression(variables);
  const completeExpr = variables.map(v => `!is.na(\`${v}\`)`).join(' & ');
  const sumExpr = variables.map(v => `as.numeric(\`${v}\`)`).join(' + ');
  return `(${completeExpr}) & (abs((${sumExpr}) - 100) <= ${tolerance})`;
}

// =============================================================================
// Internal helpers
// =============================================================================

function parseRowGroup(variable: string): { groupId: string } | null {
  const match = variable.match(/^(.*?)[rR](\d+)[cC](\d+)$/);
  if (!match) return null;
  const prefix = match[1];
  const row = match[2];
  return { groupId: `${prefix}r${row}` };
}

function hasSum100Cue(...texts: string[]): boolean {
  const joined = texts.join('\n').toLowerCase();
  return (
    /\bsum\s+to\s+100\b/.test(joined) ||
    /\bmust\s+sum\s+to\b/.test(joined) ||
    /\badd\s+to\s+100\b/.test(joined) ||
    /\bresponses?\s+must\s+sum\b/.test(joined) ||
    /\bpercentages?\s+must\s+sum\b/.test(joined)
  );
}

function pct(numerator: number, denominator: number): number {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

async function findRscriptBinary(): Promise<string> {
  const candidates = ['/opt/homebrew/bin/Rscript', '/usr/local/bin/Rscript', '/usr/bin/Rscript', 'Rscript'];
  for (const candidate of candidates) {
    try {
      await execFileAsync(candidate, ['--version'], { timeout: 2000 });
      return candidate;
    } catch {
      continue;
    }
  }
  throw new Error('Rscript not found. Install R and ensure Rscript is available.');
}

// =============================================================================
// R subprocess
// =============================================================================

async function runBaseAuditR(args: {
  rscript: string;
  savPath: string;
  specsPath: string;
  scriptPath: string;
  sumTolerance: number;
}): Promise<RAuditResult> {
  const escapedSav = args.savPath.replace(/\\/g, '/').replace(/"/g, '\\"');
  const escapedSpecs = args.specsPath.replace(/\\/g, '/').replace(/"/g, '\\"');

  // R code adapted from scripts/audit-base-vs-skiplogic.ts runDataAuditWithR()
  const rCode = `
suppressMessages(library(haven))
suppressMessages(library(jsonlite))

data <- tryCatch(
  read_sav("${escapedSav}"),
  error = function(e) {
    if (grepl("iconv|encoding|translat", e$message, ignore.case = TRUE)) {
      read_sav("${escapedSav}", encoding = "latin1")
    } else {
      stop(e)
    }
  }
)

spec <- fromJSON("${escapedSpecs}", simplifyVector = FALSE)
sum_tol <- ${args.sumTolerance}

is_numeric_col <- function(col) {
  is.numeric(col) || inherits(col, "haven_labelled")
}

compute_mask_counts <- function(df) {
  if (ncol(df) == 0) {
    return(list(asked_n = 0L, complete_n = 0L))
  }
  if (ncol(df) == 1) {
    nm <- !is.na(df[[1]])
    return(list(
      asked_n = as.integer(sum(nm)),
      complete_n = as.integer(sum(nm))
    ))
  }
  nm <- !is.na(df)
  asked_n <- as.integer(sum(rowSums(nm) > 0))
  complete_n <- as.integer(sum(rowSums(nm) == ncol(df)))
  list(asked_n = asked_n, complete_n = complete_n)
}

results <- vector("list", length(spec$tables))

for (i in seq_along(spec$tables)) {
  tbl <- spec$tables[[i]]
  vars <- unique(unlist(tbl$variables))
  vars <- vars[vars %in% colnames(data)]

  tbl_out <- list(
    tableId = tbl$tableId,
    questionId = tbl$questionId,
    varCount = length(tbl$variables),
    existingVarCount = length(vars),
    askedN = 0L,
    completeN = 0L,
    isNumericTable = FALSE,
    tableSum100N = NULL,
    tableSum100RateAsked = NULL,
    tableSum100RateComplete = NULL,
    rowGroups = list()
  )

  if (length(vars) > 0) {
    sub <- data[, vars, drop = FALSE]
    masks <- compute_mask_counts(sub)
    tbl_out$askedN <- masks$asked_n
    tbl_out$completeN <- masks$complete_n

    numeric_flags <- sapply(vars, function(v) is_numeric_col(data[[v]]))
    tbl_out$isNumericTable <- all(numeric_flags)

    if (tbl_out$isNumericTable && length(vars) >= 2 && isTRUE(tbl$expectsSum100)) {
      numeric_sub <- as.data.frame(lapply(sub, as.numeric))
      masks_num <- compute_mask_counts(numeric_sub)
      row_sums <- rowSums(numeric_sub)
      valid_100 <- !is.na(row_sums) & abs(row_sums - 100) <= sum_tol
      valid_n <- as.integer(sum(valid_100))
      tbl_out$tableSum100N <- valid_n
      tbl_out$tableSum100RateAsked <- if (masks_num$asked_n > 0) valid_n / masks_num$asked_n else NULL
      tbl_out$tableSum100RateComplete <- if (masks_num$complete_n > 0) valid_n / masks_num$complete_n else NULL
    }
  }

  row_group_results <- list()
  groups <- tbl$rowGroups
  if (!is.null(groups) && length(groups) > 0) {
    for (g_idx in seq_along(groups)) {
      g <- groups[[g_idx]]
      gvars <- unique(unlist(g$variables))
      gvars <- gvars[gvars %in% colnames(data)]

      g_out <- list(
        groupId = g$groupId,
        varCount = length(g$variables),
        existingVarCount = length(gvars),
        askedN = 0L,
        completeN = 0L,
        isNumericGroup = FALSE,
        sum100N = NULL,
        sum100RateAsked = NULL,
        sum100RateComplete = NULL
      )

      if (length(gvars) > 0) {
        gsub <- data[, gvars, drop = FALSE]
        gmasks <- compute_mask_counts(gsub)
        g_out$askedN <- gmasks$asked_n
        g_out$completeN <- gmasks$complete_n

        numeric_flags <- sapply(gvars, function(v) is_numeric_col(data[[v]]))
        g_out$isNumericGroup <- all(numeric_flags)

        if (g_out$isNumericGroup && length(gvars) >= 2) {
          gsub_num <- as.data.frame(lapply(gsub, as.numeric))
          gmasks_num <- compute_mask_counts(gsub_num)
          row_sums <- rowSums(gsub_num)
          valid_100 <- !is.na(row_sums) & abs(row_sums - 100) <= sum_tol
          valid_n <- as.integer(sum(valid_100))
          g_out$sum100N <- valid_n
          g_out$sum100RateAsked <- if (gmasks_num$asked_n > 0) valid_n / gmasks_num$asked_n else NULL
          g_out$sum100RateComplete <- if (gmasks_num$complete_n > 0) valid_n / gmasks_num$complete_n else NULL
        }
      }

      row_group_results[[length(row_group_results) + 1]] <- g_out
    }
  }

  tbl_out$rowGroups <- row_group_results
  results[[i]] <- tbl_out
}

out <- list(
  totalN = as.integer(nrow(data)),
  tables = results
)

cat(toJSON(out, auto_unbox = TRUE, null = "null", digits = 10))
`;

  await fs.writeFile(args.scriptPath, rCode, 'utf-8');

  try {
    const { stdout } = await execFileAsync(args.rscript, [args.scriptPath], {
      timeout: 180000,
      maxBuffer: 50 * 1024 * 1024,
      env: { ...process.env, LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' },
    });
    return JSON.parse(stdout) as RAuditResult;
  } finally {
    await fs.unlink(args.scriptPath).catch(() => {});
  }
}

// =============================================================================
// Directive builder — converts raw R metrics into BaseDirective[]
// =============================================================================

export function buildDirectives(
  specs: TableSpec[],
  metrics: RAuditResult,
  thresholds: { baseGapPct: number; rowGapPct: number; sumCompleteMin: number; sumTolerance?: number },
): BaseDirective[] {
  const metricById = new Map(metrics.tables.map(t => [t.tableId, t]));
  const directives: BaseDirective[] = [];

  for (const spec of specs) {
    const metric = metricById.get(spec.tableId);
    if (!metric) continue;

    const tableAskedPct = pct(metric.askedN, metrics.totalN);
    const tableGapPct = Number((100 - tableAskedPct).toFixed(2));
    const needsTableFilter = tableGapPct >= thresholds.baseGapPct;

    // Build row-group directives
    const rowGroups: RowGroupDirective[] = [];
    let needsRowSplit = false;

    for (const group of metric.rowGroups || []) {
      const groupAskedPct = pct(group.askedN, metrics.totalN);
      const groupGapPct = Number((100 - groupAskedPct).toFixed(2));
      const gapVsTable = Number((tableAskedPct - groupAskedPct).toFixed(2));

      if (gapVsTable >= thresholds.rowGapPct) {
        needsRowSplit = true;
      }

      // Find matching spec row group to get its variable list
      const specGroup = spec.rowGroups.find(g => g.groupId === group.groupId);
      const groupVariables = specGroup?.variables ?? [];
      const shouldUseSum100Filter = Boolean(
        group.isNumericGroup &&
        groupVariables.length >= 2 &&
        typeof group.sum100RateComplete === 'number' &&
        group.sum100RateComplete >= thresholds.sumCompleteMin,
      );

      const groupFilter = specGroup
        ? (shouldUseSum100Filter
          ? generateSum100FilterExpression(groupVariables, thresholds.sumTolerance ?? DEFAULT_SUM_TOLERANCE)
          : generateFilterExpression(groupVariables))
        : '';

      rowGroups.push({
        groupId: group.groupId,
        variables: groupVariables,
        askedN: group.askedN,
        gapPct: groupGapPct,
        gapVsTable,
        filter: groupFilter,
      });
    }

    // Sum-to-100 constraint detection
    let sumConstraint: BaseDirective['sumConstraint'] = null;
    if (spec.expectsSum100 && typeof metric.tableSum100RateComplete === 'number') {
      sumConstraint = {
        detected: true,
        completionRate: metric.tableSum100RateComplete,
      };
    }

    // Generate table-level filter expression
    const tableFilter = needsTableFilter ? generateFilterExpression(spec.variables) : '';
    const tableBaseText = needsTableFilter ? `Those answering ${spec.questionId}` : '';

    directives.push({
      tableId: spec.tableId,
      questionId: spec.questionId,
      totalN: metrics.totalN,
      tableAskedN: metric.askedN,
      tableGapPct,
      tableFilter,
      tableBaseText,
      needsTableFilter,
      rowGroups,
      needsRowSplit,
      sumConstraint,
    });
  }

  return directives;
}
