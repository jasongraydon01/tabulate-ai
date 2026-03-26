/**
 * Excel Formatter
 *
 * Main class for formatting tables.json into Excel workbook.
 *
 * Supports two formats:
 * - 'standard' (default): Horizontal layout with 1 row per answer, value+sig column pairs
 * - 'stacked': Vertical layout with 3 rows per answer (count, percent, sig stacked)
 *
 * Features:
 * - Reads tables.json from R output
 * - Renders frequency and mean_rows tables
 * - Multi-row headers with group/column/stat letter
 * - Heavy borders between banner groups
 * - Freeze panes for headers and label columns (standard format)
 * - Multi-sheet support for display modes (frequency/counts/both)
 */

import ExcelJS from 'exceljs';
import { promises as fs } from 'fs';
import type { TablePresentationConfig } from '@/lib/tablePresentation/labelVocabulary';

import { renderFrequencyTable, type FrequencyTableData } from './tableRenderers/frequencyTable';
import { renderMeanRowsTable, type MeanRowsTableData } from './tableRenderers/meanRowsTable';
import {
  renderStdHeaders,
  renderStdFrequencyTable,
  setStdColumnWidths,
  type StdHeaderInfo,
  type ValueType,
} from './tableRenderers/standardFrequency';
import { renderStdMeanRowsTable } from './tableRenderers/standardMeanRows';
import { renderTableOfContents } from './tableRenderers/tableOfContents';
import { renderExcludedSheet } from './tableRenderers/excludedSheet';
import { COLUMN_WIDTHS, COLUMN_WIDTHS_STD, TABLE_SPACING, runWithExcelTheme } from './styles';
import type { BannerGroup } from '../r/RScriptGeneratorV2';

// =============================================================================
// Types
// =============================================================================

export interface TablesJsonMetadata {
  generatedAt: string;
  tableCount: number;
  cutCount: number;
  significanceLevel: number;
  totalRespondents: number;
  bannerGroups: BannerGroup[];
  comparisonGroups: string[];
  weighted?: boolean;
  weightVariable?: string;
}

export interface TableData {
  tableId: string;
  questionId: string;
  questionText: string;
  tableType: 'frequency' | 'mean_rows';
  isDerived: boolean;
  sourceTableId: string;
  data: Record<string, unknown>;
  // Phase 2: Additional table metadata
  surveySection?: string;  // Section name from survey (e.g., "SCREENER")
  baseText?: string;       // Who was asked (e.g., "Total interventional radiologists")
  userNote?: string;       // Context note (e.g., "(Multiple answers accepted)")
  tableSubtitle?: string;  // Differentiator for derived tables (e.g., "Brand A", "T2B Comparison")
  // Phase 5: Excluded tables support
  excluded?: boolean;      // True if table should go to Excluded sheet
  excludeReason?: string;  // Why it was excluded
}

export interface TablesJson {
  metadata: TablesJsonMetadata;
  tables: Record<string, TableData>;
}

export type ExcelFormat = 'standard' | 'stacked';
export type DisplayMode = 'frequency' | 'counts' | 'both';

export interface ExcelFormatOptions {
  format?: ExcelFormat;            // 'standard' (default) or 'stacked'
  displayMode?: DisplayMode;       // 'frequency' (default), 'counts', or 'both'
  separateWorkbooks?: boolean;     // When displayMode='both', output two separate .xlsx files instead of two sheets in one
  hideExcludedTables?: boolean;    // When true, omit the red "Excluded Tables" sheet from output
  theme?: string;                  // Theme key from themes.ts (default: classic)
  tablePresentation?: TablePresentationConfig;
}

export interface FormatOptions extends ExcelFormatOptions {
  outputPath?: string;
  worksheetName?: string;
}

// =============================================================================
// Render Context
// =============================================================================

interface RenderContext {
  totalRespondents: number;
  bannerGroups: BannerGroup[];
  comparisonGroups: string[];
  significanceLevel: number;
  tablePresentation?: TablePresentationConfig;
}

// =============================================================================
// Main Formatter Class
// =============================================================================

export class ExcelFormatter {
  private workbook: ExcelJS.Workbook;
  private secondWorkbook: ExcelJS.Workbook | null = null;
  private options: ExcelFormatOptions;

  constructor(options: ExcelFormatOptions = {}) {
    this.workbook = new ExcelJS.Workbook();
    this.workbook.creator = 'TabulateAI';
    this.workbook.created = new Date();
    this.options = {
      format: options.format ?? 'standard',
      displayMode: options.displayMode ?? 'frequency',
      separateWorkbooks: options.separateWorkbooks ?? false,
      hideExcludedTables: options.hideExcludedTables ?? false,
      theme: options.theme ?? 'classic',
      tablePresentation: options.tablePresentation,
    };
  }

  /**
   * Format tables.json into Excel workbook
   */
  async formatFromJson(tablesJson: TablesJson): Promise<ExcelJS.Workbook> {
    return runWithExcelTheme(this.options.theme, async () => {
      const { metadata, tables } = tablesJson;

      // Build render context from metadata
      const context: RenderContext = {
        totalRespondents: metadata.totalRespondents,
        bannerGroups: metadata.bannerGroups,
        comparisonGroups: metadata.comparisonGroups,
        significanceLevel: metadata.significanceLevel,
        tablePresentation: this.options.tablePresentation,
      };

      const tableIds = Object.keys(tables);
      console.log(`[ExcelFormatter] Formatting ${tableIds.length} tables (format: ${this.options.format}, display: ${this.options.displayMode})...`);

      if (this.options.format === 'standard') {
        this.formatStandardStyle(tables, tableIds, context, metadata);
      } else {
        this.formatStackedStyle(tables, tableIds, context);
      }

      console.log(`[ExcelFormatter] Formatted ${tableIds.length} tables`);

      return this.workbook;
    });
  }

  /**
   * Format in standard style (horizontal layout)
   */
  private formatStandardStyle(
    tables: Record<string, TableData>,
    tableIds: string[],
    context: RenderContext,
    metadata?: TablesJsonMetadata
  ): void {
    const { displayMode } = this.options;

    // Convert tables to array for filtering
    const tableArray = tableIds.map(id => tables[id]);

    // Separate included and excluded tables
    const includedTables = tableArray.filter(t => !t.excluded);
    const excludedTables = tableArray.filter(t => t.excluded);
    const includedTableIds = includedTables.map(t => t.tableId);

    console.log(`[ExcelFormatter] Included tables: ${includedTables.length}, Excluded tables: ${excludedTables.length}`);

    // Create tables record for included only
    const includedTablesRecord: Record<string, TableData> = {};
    for (const table of includedTables) {
      includedTablesRecord[table.tableId] = table;
    }

    // 1. Render Table of Contents sheet first
    const tocSubtitle = metadata?.weighted
      ? `Weighted results (weight variable: ${metadata.weightVariable || 'unknown'})`
      : metadata?.weighted === false
        ? 'Unweighted results'
        : undefined;
    const tocResult = renderTableOfContents(this.workbook, tableArray, { subtitle: tocSubtitle });
    console.log(`[ExcelFormatter] ToC rendered with ${tocResult.tableCount} tables`);

    // Calculate total cuts for column widths
    const cutCount = context.bannerGroups.reduce((sum, g) => sum + g.columns.length, 0);

    // 2. Render main crosstabs sheet(s)
    let headerInfo: StdHeaderInfo | null = null;

    if (displayMode === 'both') {
      console.log(`[ExcelFormatter] Display mode: both, separateWorkbooks: ${this.options.separateWorkbooks}`);
    }

    if (displayMode === 'both' && this.options.separateWorkbooks) {
      // Separate workbooks: primary = Percentages, secondWorkbook = Counts
      const pctSheet = this.workbook.addWorksheet('Crosstabs', {
        properties: { tabColor: { argb: 'FF006BB3' } }
      });
      headerInfo = this.renderStandardSheet(pctSheet, includedTablesRecord, includedTableIds, context, cutCount, 'percent');

      // Build second workbook for counts
      this.secondWorkbook = new ExcelJS.Workbook();
      this.secondWorkbook.creator = 'TabulateAI';
      this.secondWorkbook.created = new Date();
      renderTableOfContents(this.secondWorkbook, tableArray, { subtitle: tocSubtitle });
      const countSheet = this.secondWorkbook.addWorksheet('Crosstabs', {
        properties: { tabColor: { argb: 'FF4472C4' } }
      });
      this.renderStandardSheet(countSheet, includedTablesRecord, includedTableIds, context, cutCount, 'count');

    } else if (displayMode === 'both') {
      // Two sheets in one workbook (existing behavior)
      const pctSheet = this.workbook.addWorksheet('Percentages', {
        properties: { tabColor: { argb: 'FF006BB3' } }
      });
      const countSheet = this.workbook.addWorksheet('Counts', {
        properties: { tabColor: { argb: 'FF4472C4' } }
      });

      headerInfo = this.renderStandardSheet(pctSheet, includedTablesRecord, includedTableIds, context, cutCount, 'percent');
      this.renderStandardSheet(countSheet, includedTablesRecord, includedTableIds, context, cutCount, 'count');
    } else {
      // Single sheet
      const valueType: ValueType = displayMode === 'counts' ? 'count' : 'percent';
      const sheetName = displayMode === 'counts' ? 'Counts' : 'Crosstabs';
      const worksheet = this.workbook.addWorksheet(sheetName, {
        properties: { tabColor: { argb: 'FF006BB3' } }
      });

      headerInfo = this.renderStandardSheet(worksheet, includedTablesRecord, includedTableIds, context, cutCount, valueType);
    }

    // 3. Render Excluded Tables sheet (if any, and not hidden by config)
    if (!this.options.hideExcludedTables && excludedTables.length > 0 && headerInfo) {
      const excludedResult = renderExcludedSheet(
        this.workbook,
        excludedTables,
        headerInfo,
        context.totalRespondents,
        context.bannerGroups
      );
      console.log(`[ExcelFormatter] Excluded sheet rendered with ${excludedResult.excludedCount} tables`);

      // Also add excluded sheet to second workbook if it exists
      if (this.secondWorkbook) {
        renderExcludedSheet(
          this.secondWorkbook,
          excludedTables,
          headerInfo,
          context.totalRespondents,
          context.bannerGroups
        );
      }
    }
  }

  /**
   * Render a single standard-format worksheet
   * Returns headerInfo for use by excluded sheet renderer
   */
  private renderStandardSheet(
    worksheet: ExcelJS.Worksheet,
    tables: Record<string, TableData>,
    tableIds: string[],
    context: RenderContext,
    _cutCount: number,
    valueType: ValueType
  ): StdHeaderInfo {
    // Render headers (once at top) - this builds the column layout
    const headerInfo = renderStdHeaders(
      worksheet,
      context.bannerGroups,
      TABLE_SPACING.startRow,
      context.tablePresentation,
    );
    let currentRow = TABLE_SPACING.startRow + headerInfo.headerRowCount;

    // Detect MaxDiff tables for wider label columns
    const hasMaxDiffTables = tableIds.some(id => tables[id]?.tableId?.startsWith('maxdiff_'));
    const labelWidth = hasMaxDiffTables ? COLUMN_WIDTHS_STD.labelMaxDiff : undefined;

    // Set column widths (needs headerInfo for spacer columns)
    setStdColumnWidths(worksheet, headerInfo, { labelWidth });

    // Render each table - NO gaps between tables (standard format = continuous flow)
    let maxdiffSectionStarted = false;
    for (const tableId of tableIds) {
      const table = tables[tableId];

      // Add a visual separator before the MaxDiff section
      if (!maxdiffSectionStarted && table.tableId?.startsWith('maxdiff_')) {
        maxdiffSectionStarted = true;
        // Add a gap row to visually separate MaxDiff tables from standard tables
        if (currentRow > TABLE_SPACING.startRow + headerInfo.headerRowCount) {
          currentRow += 1; // One blank row as separator
        }
      }

      if (table.tableType === 'frequency') {
        const result = renderStdFrequencyTable(
          worksheet,
          table as unknown as FrequencyTableData,
          currentRow,
          headerInfo,
          valueType,
          false,
          context.totalRespondents
        );
        currentRow = result.endRow;
      } else if (table.tableType === 'mean_rows') {
        const result = renderStdMeanRowsTable(
          worksheet,
          table as unknown as MeanRowsTableData,
          currentRow,
          headerInfo,
          context.totalRespondents
        );
        currentRow = result.endRow;
      } else {
        console.warn(`[ExcelFormatter] Unknown table type: ${table.tableType}, skipping ${tableId}`);
        continue;
      }
    }

    // Freeze panes: headers (top) and context+label columns (left)
    this.applyStandardFreezePanes(worksheet, headerInfo);

    return headerInfo;
  }

  /**
   * Apply freeze panes for standard format
   * Freezes header rows and context+label columns
   */
  private applyStandardFreezePanes(worksheet: ExcelJS.Worksheet, headerInfo: StdHeaderInfo): void {
    const headerRowCount = headerInfo.headerRowCount;
    const frozenCols = 2; // Context + Label columns

    worksheet.views = [{
      state: 'frozen',
      ySplit: headerRowCount,
      xSplit: frozenCols,
      topLeftCell: `C${headerRowCount + 1}`,
      activeCell: 'A1',
    }];
  }

  /**
   * Format in stacked style (vertical stacked layout)
   */
  private formatStackedStyle(
    tables: Record<string, TableData>,
    tableIds: string[],
    context: RenderContext
  ): void {
    const worksheet = this.workbook.addWorksheet('Crosstabs', {
      properties: { tabColor: { argb: 'FF006BB3' } }
    });

    // Set column widths
    this.setStackedColumnWidths(worksheet, context.bannerGroups);

    // Render each table
    let currentRow: number = TABLE_SPACING.startRow;

    for (const tableId of tableIds) {
      const table = tables[tableId];

      if (table.tableType === 'frequency') {
        currentRow = renderFrequencyTable(
          worksheet,
          table as unknown as FrequencyTableData,
          currentRow,
          context
        );
      } else if (table.tableType === 'mean_rows') {
        currentRow = renderMeanRowsTable(
          worksheet,
          table as unknown as MeanRowsTableData,
          currentRow,
          context
        );
      } else {
        console.warn(`[ExcelFormatter] Unknown table type: ${table.tableType}, skipping ${tableId}`);
        continue;
      }

      // Add gap between tables
      currentRow += TABLE_SPACING.gapBetweenTables;
    }
  }

  /**
   * Set column widths for stacked format
   */
  private setStackedColumnWidths(worksheet: ExcelJS.Worksheet, bannerGroups: BannerGroup[]): void {
    // First column: labels
    worksheet.getColumn(1).width = COLUMN_WIDTHS.label;

    // Data columns
    let colIndex = 2;
    for (const group of bannerGroups) {
      for (const _col of group.columns) {
        worksheet.getColumn(colIndex).width = COLUMN_WIDTHS.data;
        colIndex++;
      }
    }
  }

  /**
   * Format from file path
   */
  async formatFromFile(jsonPath: string): Promise<ExcelJS.Workbook> {
    const jsonContent = await fs.readFile(jsonPath, 'utf-8');
    const tablesJson = JSON.parse(jsonContent) as TablesJson;
    return this.formatFromJson(tablesJson);
  }

  /**
   * Save workbook to file
   */
  async saveToFile(outputPath: string): Promise<void> {
    await this.workbook.xlsx.writeFile(outputPath);
    console.log(`[ExcelFormatter] Saved workbook to: ${outputPath}`);
  }

  /**
   * Whether a second workbook was generated (separate workbooks mode)
   */
  hasSecondWorkbook(): boolean {
    return this.secondWorkbook !== null;
  }

  /**
   * Save second workbook to file (only exists when separateWorkbooks=true and displayMode='both')
   */
  async saveSecondWorkbook(outputPath: string): Promise<void> {
    if (!this.secondWorkbook) {
      throw new Error('No second workbook to save. Only generated when separateWorkbooks=true and displayMode=both.');
    }
    await this.secondWorkbook.xlsx.writeFile(outputPath);
    console.log(`[ExcelFormatter] Saved second workbook to: ${outputPath}`);
  }

  /**
   * Get workbook as buffer (for HTTP response)
   */
  async getBuffer(): Promise<Buffer> {
    return Buffer.from(await this.workbook.xlsx.writeBuffer());
  }

  /**
   * Get second workbook as buffer (counts variant when separateWorkbooks=true and displayMode='both').
   * Throws if no second workbook was generated.
   */
  async getSecondWorkbookBuffer(): Promise<Buffer> {
    if (!this.secondWorkbook) {
      throw new Error('No second workbook to export. Only generated when separateWorkbooks=true and displayMode=both.');
    }
    return Buffer.from(await this.secondWorkbook.xlsx.writeBuffer());
  }
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Format tables.json file to Excel workbook
 */
export async function formatTablesToExcel(
  jsonPath: string,
  outputPath?: string,
  options?: ExcelFormatOptions
): Promise<{ workbook: ExcelJS.Workbook; outputPath: string }> {
  const formatter = new ExcelFormatter(options);
  const workbook = await formatter.formatFromFile(jsonPath);

  const finalOutputPath = outputPath || jsonPath.replace('.json', '.xlsx');
  await formatter.saveToFile(finalOutputPath);

  return { workbook, outputPath: finalOutputPath };
}

/**
 * Format tables.json data to Excel buffer (for HTTP response)
 */
export async function formatTablesToBuffer(
  tablesJson: TablesJson,
  options?: ExcelFormatOptions
): Promise<Buffer> {
  const formatter = new ExcelFormatter(options);
  await formatter.formatFromJson(tablesJson);
  return formatter.getBuffer();
}

/**
 * Load tables.json and format to buffer
 */
export async function formatTablesFileToBuffer(
  jsonPath: string,
  options?: ExcelFormatOptions
): Promise<Buffer> {
  const formatter = new ExcelFormatter(options);
  await formatter.formatFromFile(jsonPath);
  return formatter.getBuffer();
}
