/**
 * Extract Streamlined Data
 *
 * Utility to extract only the calculated data values from tables.json,
 * stripping metadata and table-level fields.
 *
 * Used for:
 * - Creating data-expected.json golden datasets
 * - Auto-output in pipeline alongside tables.json
 */

// Fields to keep for each row (the actual data)
const DATA_FIELDS = ['n', 'count', 'pct', 'mean', 'median', 'sd', 'sig_higher_than', 'sig_vs_total'];

// Fields to skip at the cut level
const CUT_META_FIELDS = ['stat_letter'];

export interface StreamlinedRowData {
  n?: number;
  count?: number;
  pct?: number;
  mean?: number;
  median?: number;
  sd?: number;
  sig_higher_than?: string[];
  sig_vs_total?: string | null;
}

export interface StreamlinedData {
  [tableId: string]: {
    [cutName: string]: {
      [rowKey: string]: StreamlinedRowData;
    };
  };
}

export interface TablesJsonInput {
  metadata?: Record<string, unknown>;
  tables: {
    [tableId: string]: {
      title?: string;
      tableType?: string;
      isDerived?: boolean;
      data: {
        [cutName: string]: {
          stat_letter?: string;
          [rowKey: string]: unknown;
        };
      };
    };
  };
}

/**
 * Extract streamlined data from tables.json structure.
 * Removes metadata, table-level fields, and row-level presentation fields.
 * Keeps only: n, count, pct, mean, median, sd, sig_higher_than, sig_vs_total
 */
export function extractStreamlinedData(tablesJson: TablesJsonInput): StreamlinedData {
  const result: StreamlinedData = {};

  for (const [tableId, table] of Object.entries(tablesJson.tables)) {
    if (!table.data) continue;

    result[tableId] = {};

    for (const [cutName, cutData] of Object.entries(table.data)) {
      result[tableId][cutName] = {};

      for (const [key, value] of Object.entries(cutData)) {
        // Skip cut-level metadata
        if (CUT_META_FIELDS.includes(key)) continue;

        // This should be a row
        if (typeof value === 'object' && value !== null) {
          const rowData: StreamlinedRowData = {};

          // Extract only the data fields we care about
          for (const field of DATA_FIELDS) {
            if (field in value) {
              const fieldValue = (value as Record<string, unknown>)[field];

              // Normalize sig_higher_than to array
              if (field === 'sig_higher_than') {
                if (Array.isArray(fieldValue)) {
                  rowData.sig_higher_than = fieldValue;
                } else if (typeof fieldValue === 'string' && fieldValue) {
                  rowData.sig_higher_than = fieldValue.split('');
                } else {
                  rowData.sig_higher_than = [];
                }
              }
              // Normalize sig_vs_total
              else if (field === 'sig_vs_total') {
                if (fieldValue === null || fieldValue === undefined) {
                  rowData.sig_vs_total = null;
                } else if (typeof fieldValue === 'object' && Object.keys(fieldValue as object).length === 0) {
                  rowData.sig_vs_total = null;
                } else if (typeof fieldValue === 'string') {
                  rowData.sig_vs_total = fieldValue;
                } else {
                  rowData.sig_vs_total = null;
                }
              }
              // Keep numeric fields as-is
              else {
                (rowData as Record<string, unknown>)[field] = fieldValue as number;
              }
            }
          }

          // Only add if we have actual data
          if (Object.keys(rowData).length > 0) {
            result[tableId][cutName][key] = rowData;
          }
        }
      }
    }
  }

  return result;
}

/**
 * Count total data rows in streamlined data
 */
export function countStreamlinedRows(data: StreamlinedData): number {
  let total = 0;
  for (const table of Object.values(data)) {
    for (const cut of Object.values(table)) {
      total += Object.keys(cut).length;
    }
  }
  return total;
}
