/**
 * @deprecated Legacy Review Tables backend removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not invoke from active code.
 */
import {
  ExcelFormatter,
  type TablesJson,
  type ExcelFormatOptions,
} from '../excel/ExcelFormatter';
import type { ExcludeUpdate } from '@/schemas/tableReviewSchema';

// ---------------------------------------------------------------------------
// Workbook mapping: tables.json variant → Excel output paths
// ---------------------------------------------------------------------------

/** Maps a tables.json R2 relative path to the primary + optional counts Excel paths. */
const VARIANT_TO_EXCEL: Record<string, { primary: string; counts?: string }> = {
  'results/tables.json': {
    primary: 'results/crosstabs.xlsx',
    counts: 'results/crosstabs-counts.xlsx',
  },
  'results/tables-weighted.json': {
    primary: 'results/crosstabs-weighted.xlsx',
    counts: 'results/crosstabs-weighted-counts.xlsx',
  },
  'results/tables-unweighted.json': {
    primary: 'results/crosstabs-unweighted.xlsx',
    // Unweighted variant never gets a separate counts workbook in current pipeline
  },
};

/** All known tables.json relative paths. */
const ALL_TABLE_VARIANTS = Object.keys(VARIANT_TO_EXCEL);

// ---------------------------------------------------------------------------
// applyExcludeUpdates — pure function
// ---------------------------------------------------------------------------

export interface ExcludeResult {
  tablesJson: TablesJson;
  applied: number;
  notFound: string[];
}

/**
 * Apply exclude/include updates to a tablesJson object (mutates in place for efficiency).
 * Idempotent: applying the same exclude twice is a no-op.
 */
export function applyExcludeUpdates(
  tablesJson: TablesJson,
  updates: ExcludeUpdate[],
): ExcludeResult {
  let applied = 0;
  const notFound: string[] = [];

  for (const update of updates) {
    const table = tablesJson.tables[update.tableId];
    if (!table) {
      notFound.push(update.tableId);
      continue;
    }

    // Idempotent check
    if (table.excluded === update.exclude && table.excludeReason === (update.excludeReason ?? table.excludeReason)) {
      continue;
    }

    table.excluded = update.exclude;
    if (update.exclude) {
      table.excludeReason = update.excludeReason;
    } else {
      // Clear reason when including
      delete table.excludeReason;
    }
    applied++;
  }

  return { tablesJson, applied, notFound };
}

// ---------------------------------------------------------------------------
// detectTableVariants
// ---------------------------------------------------------------------------

/**
 * Determine which tables.json variants exist in the run's R2 outputs.
 */
export function detectTableVariants(
  r2Outputs: Record<string, string>,
): string[] {
  return ALL_TABLE_VARIANTS.filter((variant) => variant in r2Outputs);
}

// ---------------------------------------------------------------------------
// rebuildAllWorkbooks
// ---------------------------------------------------------------------------

/**
 * Given a map of parsed tables.json variants, rebuild all corresponding Excel workbooks.
 * Returns a Map of R2 relativePath → Buffer for each generated workbook.
 */
export async function rebuildAllWorkbooks(
  tablesJsonVariants: Map<string, TablesJson>,
  config: ExcelFormatOptions,
): Promise<Map<string, Buffer>> {
  const buffers = new Map<string, Buffer>();

  for (const [variantPath, tablesJson] of tablesJsonVariants) {
    const excelPaths = VARIANT_TO_EXCEL[variantPath];
    if (!excelPaths) {
      console.warn(`[tableReviewService] Unknown variant path: ${variantPath}, skipping`);
      continue;
    }

    const formatter = new ExcelFormatter(config);
    await formatter.formatFromJson(tablesJson);

    // Primary workbook
    buffers.set(excelPaths.primary, await formatter.getBuffer());

    // Counts variant (only when separateWorkbooks + displayMode=both)
    if (excelPaths.counts && formatter.hasSecondWorkbook()) {
      buffers.set(excelPaths.counts, await formatter.getSecondWorkbookBuffer());
    }
  }

  return buffers;
}
