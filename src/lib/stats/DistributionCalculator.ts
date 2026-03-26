/**
 * Distribution Calculator
 *
 * Calculates actual distribution statistics from SPSS data for mean_rows tables.
 * Uses R subprocess to compute stats (consistent with existing R architecture).
 *
 * Provides VerificationAgent with real distribution data (n, min, max, mean, median, q1, q3)
 * instead of just theoretical ranges from the datamap.
 */

import { spawn } from 'child_process';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import type { TableMeta } from '@/schemas/tableAgentSchema';

export interface DistributionStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
  q1: number;
  q3: number;
}

/**
 * Table with minimal required structure for distribution calculation.
 */
interface TableWithMeta {
  tableId: string;
  tableType: string;
  rows: Array<{ variable: string }>;
  meta?: TableMeta;
}

/**
 * Result structure from convertToLegacyFormat.
 */
interface LegacyTableResult<T extends TableWithMeta> {
  questionId: string;
  questionText: string;
  tables: T[];
  confidence: number;
  reasoning: string;
}

/**
 * Calculate distribution statistics for mean_rows tables.
 *
 * @param tables - Tables to enrich with distribution data
 * @param spssPath - Path to the SPSS data file
 * @param outputDir - Directory for temporary R script
 * @returns Tables with enriched meta.distribution for mean_rows tables
 */
export async function calculateDistributionStats<T extends TableWithMeta>(
  tables: T[],
  spssPath: string,
  outputDir: string
): Promise<T[]> {
  // Identify numeric variables from mean_rows tables
  const numericVars = [
    ...new Set(
      tables
        .filter(t => t.tableType === 'mean_rows')
        .flatMap(t => t.rows.map(r => r.variable))
    ),
  ];

  if (numericVars.length === 0) {
    return tables;
  }

  // Calculate stats via R subprocess
  let stats: Record<string, DistributionStats>;
  try {
    stats = await calculateStatsViaR(spssPath, numericVars, outputDir);
  } catch (error) {
    // Log warning but continue without distribution data
    console.warn(
      `[DistributionCalculator] Failed to calculate stats: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return tables;
  }

  // Merge stats into table meta
  return tables.map(t => {
    if (t.tableType !== 'mean_rows') return t;

    // For single-variable mean_rows tables, use that variable's stats
    // For multi-variable tables, we could aggregate, but single is most common
    const varName = t.rows[0]?.variable;
    const dist = stats[varName];
    if (!dist) return t;

    const existingMeta = t.meta || { itemCount: t.rows.length, rowCount: t.rows.length };
    return {
      ...t,
      meta: {
        ...existingMeta,
        distribution: dist,
      },
    };
  });
}

/**
 * Enrich LegacyTableResult results with distribution statistics.
 * Used in PipelineRunner before VerificationAgent.
 */
export async function enrichTableResultsWithStats<T extends TableWithMeta>(
  results: LegacyTableResult<T>[],
  spssPath: string,
  outputDir: string
): Promise<LegacyTableResult<T>[]> {
  // Flatten all tables
  const allTables = results.flatMap(r => r.tables);

  // Enrich with stats
  const enrichedTables = await calculateDistributionStats(allTables, spssPath, outputDir);

  // Build lookup by tableId
  const enrichedMap = new Map(enrichedTables.map(t => [t.tableId, t]));

  // Map back to results structure
  return results.map(r => ({
    ...r,
    tables: r.tables.map(t => enrichedMap.get(t.tableId) || t),
  }));
}

/**
 * Calculate statistics via R subprocess.
 */
async function calculateStatsViaR(
  spssPath: string,
  variables: string[],
  outputDir: string
): Promise<Record<string, DistributionStats>> {
  const rScript = generateStatsScript(spssPath, variables);
  const scriptPath = join(outputDir, 'distribution_stats.R');

  writeFileSync(scriptPath, rScript);

  return new Promise((resolve, reject) => {
    // Find R - try common paths
    const rPaths = [
      '/opt/homebrew/bin/Rscript',
      '/usr/local/bin/Rscript',
      '/usr/bin/Rscript',
      'Rscript',
    ];

    let rCommand = 'Rscript';
    for (const rPath of rPaths) {
      if (rPath === 'Rscript' || existsSync(rPath)) {
        rCommand = rPath;
        break;
      }
    }

    const proc = spawn(rCommand, [scriptPath]);
    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', d => (stdout += d));
    proc.stderr.on('data', d => (stderr += d));

    proc.on('close', code => {
      // Clean up script file
      try {
        unlinkSync(scriptPath);
      } catch {
        // Ignore cleanup errors
      }

      if (code !== 0) {
        reject(new Error(`R stats script failed (code ${code}): ${stderr}`));
      } else {
        try {
          const result = JSON.parse(stdout);
          resolve(result);
        } catch {
          reject(new Error(`Failed to parse R output: ${stdout.substring(0, 200)}`));
        }
      }
    });

    proc.on('error', err => {
      // Clean up script file
      try {
        unlinkSync(scriptPath);
      } catch {
        // Ignore cleanup errors
      }
      reject(new Error(`Failed to spawn R process: ${err.message}`));
    });
  });
}

/**
 * Generate R script to calculate distribution statistics.
 */
function generateStatsScript(spssPath: string, variables: string[]): string {
  // Escape backslashes for R string
  const escapedPath = spssPath.replace(/\\/g, '/');
  const varsArray = variables.map(v => `"${v}"`).join(', ');

  return `
# Distribution statistics calculator
# Auto-generated by TabulateAI

suppressPackageStartupMessages({
  library(haven)
  library(jsonlite)
})

# Read SPSS file (with encoding fallback)
data <- tryCatch(
  read_sav("${escapedPath}"),
  error = function(e) {
    if (grepl("iconv|encoding|translat", e$message, ignore.case = TRUE)) {
      cat("WARNING: Encoding error, retrying with encoding='latin1'\\n")
      read_sav("${escapedPath}", encoding = "latin1")
    } else {
      stop(e)
    }
  }
)

# Variables to analyze
vars <- c(${varsArray})

# Calculate stats for each variable
stats_list <- list()
for (var in vars) {
  if (var %in% names(data)) {
    vals <- data[[var]]
    vals <- vals[!is.na(vals)]
    if (inherits(vals, "POSIXt") || inherits(vals, "difftime")) next
    if (length(vals) > 0) {
      stats_list[[var]] <- list(
        n = length(vals),
        min = min(vals),
        max = max(vals),
        mean = round(mean(vals), 2),
        median = round(median(vals), 2),
        q1 = round(as.numeric(quantile(vals, 0.25)), 2),
        q3 = round(as.numeric(quantile(vals, 0.75)), 2)
      )
    }
  }
}

# Output as JSON
cat(toJSON(stats_list, auto_unbox = TRUE))
`;
}
