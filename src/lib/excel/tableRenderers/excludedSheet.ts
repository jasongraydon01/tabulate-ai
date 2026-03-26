/**
 * Excluded Tables Sheet Renderer
 *
 * Renders tables marked as excluded: true on a separate sheet.
 * Format matches the main Crosstabs sheet exactly - same headers,
 * column widths, and table rendering. Exclusion reason is shown
 * in the context column of each table.
 */

import type { Workbook, Worksheet } from 'exceljs';
import type { TableData } from '../ExcelFormatter';
import type { StdHeaderInfo, FrequencyTableData } from './standardFrequency';
import type { MeanRowsTableData } from './standardMeanRows';
import {
  renderStdHeaders,
  renderStdFrequencyTable,
  setStdColumnWidths,
} from './standardFrequency';
import { renderStdMeanRowsTable } from './standardMeanRows';
import { TABLE_SPACING } from '../styles';
import type { BannerGroup } from '../../r/RScriptGeneratorV2';

// =============================================================================
// Types
// =============================================================================

export interface ExcludedSheetRenderResult {
  worksheet: Worksheet | null;
  excludedCount: number;
}

// =============================================================================
// Main Renderer
// =============================================================================

/**
 * Render Excluded Tables sheet
 *
 * Renders excluded tables with the same format as the main Crosstabs sheet:
 * - Same banner headers (group names, column names, stat letters)
 * - Same column widths
 * - Same table rendering
 * - Freeze panes on headers and context/label columns
 *
 * Exclusion reason is shown in each table's context column.
 *
 * Returns null worksheet if no excluded tables exist.
 */
export function renderExcludedSheet(
  workbook: Workbook,
  excludedTables: TableData[],
  headerInfo: StdHeaderInfo,
  totalRespondents: number,
  bannerGroups?: BannerGroup[]
): ExcludedSheetRenderResult {
  if (excludedTables.length === 0) {
    return {
      worksheet: null,
      excludedCount: 0,
    };
  }

  const worksheet = workbook.addWorksheet('Excluded Tables', {
    properties: { tabColor: { argb: 'FFFF6B6B' } }  // Red tab color
  });

  // Render headers (same as main sheet) if bannerGroups provided
  let currentRow: number = TABLE_SPACING.startRow;
  let effectiveHeaderInfo = headerInfo;

  if (bannerGroups) {
    effectiveHeaderInfo = renderStdHeaders(worksheet, bannerGroups, TABLE_SPACING.startRow);
    currentRow = TABLE_SPACING.startRow + effectiveHeaderInfo.headerRowCount;
  } else {
    // Use passed headerInfo's row count to determine where tables start
    currentRow = TABLE_SPACING.startRow + headerInfo.headerRowCount;
    // Re-render headers on this sheet
    // Since we don't have bannerGroups, we'll render without headers
    // and just use the column layout from headerInfo
  }

  // Set column widths (same as main sheet)
  setStdColumnWidths(worksheet, effectiveHeaderInfo);

  // Render each excluded table (continuous flow, no gaps - matches main sheet)
  for (const table of excludedTables) {
    if (table.tableType === 'frequency') {
      const result = renderStdFrequencyTable(
        worksheet,
        table as unknown as FrequencyTableData,
        currentRow,
        effectiveHeaderInfo,
        'percent',
        false,
        totalRespondents
      );
      currentRow = result.endRow;
    } else if (table.tableType === 'mean_rows') {
      const result = renderStdMeanRowsTable(
        worksheet,
        table as unknown as MeanRowsTableData,
        currentRow,
        effectiveHeaderInfo,
        totalRespondents
      );
      currentRow = result.endRow;
    }
  }

  // Apply freeze panes (same as main sheet)
  const frozenCols = 2; // Context + Label columns
  worksheet.views = [{
    state: 'frozen',
    ySplit: effectiveHeaderInfo.headerRowCount,
    xSplit: frozenCols,
    topLeftCell: `C${effectiveHeaderInfo.headerRowCount + 1}`,
    activeCell: 'A1',
  }];

  return {
    worksheet,
    excludedCount: excludedTables.length,
  };
}
