/**
 * Message List Parser
 *
 * Parses an uploaded message list file (Excel/CSV) containing full-text
 * MaxDiff messages. Used to replace truncated .sav labels with complete text.
 *
 * Also exports `validateVariantOfGraph()` for checking variant references.
 *
 * Expected file formats:
 *   - Excel (.xlsx, .xls): first sheet, header row + data rows
 *   - CSV (.csv): standard comma-separated
 *
 * Expected columns (flexible matching):
 *   - message_id / code / id: message identifier (e.g., "I1", "E1")
 *   - message / text / description: full message text
 *
 * If no header is recognized, assumes column A = code, column B = text.
 */

import ExcelJS from 'exceljs';
import fs from 'fs/promises';
import path from 'path';
import type { MaxDiffWarning } from './warnings';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MessageListEntry {
  /** Message identifier/code (e.g., "I1", "E1", "D4") */
  code: string;
  /** Full message text */
  text: string;
  /** Row number in the source file (1-based) */
  sourceRow: number;
  /** Code of the primary message this is a variant of (e.g., "I1" for alternate "I1A") */
  variantOf?: string;
}

export interface MessageListParseResult {
  /** Parsed messages */
  messages: MessageListEntry[];
  /** Number of rows skipped (empty or unparseable) */
  skippedRows: number;
  /** Source file format */
  format: 'xlsx' | 'xls' | 'csv';
  /** Message codes that appear more than once (case-insensitive) */
  duplicateCodes: string[];
  /** 1-based row numbers where code was empty (auto-generated as ROW_N) */
  emptyCodeRows: number[];
}

// ─── Column Detection ────────────────────────────────────────────────────────

const CODE_COLUMN_PATTERNS = [
  /^message[_\s-]?id$/i,
  /^code$/i,
  /^id$/i,
  /^msg[_\s-]?id$/i,
  /^message[_\s-]?code$/i,
];

const TEXT_COLUMN_PATTERNS = [
  /^message$/i,
  /^text$/i,
  /^description$/i,
  /^message[_\s-]?text$/i,
  /^full[_\s-]?text$/i,
  /^content$/i,
];

const VARIANT_OF_COLUMN_PATTERNS = [
  /^variant[_\s-]?of$/i,
  /^alt[_\s-]?of$/i,
  /^alternate[_\s-]?of$/i,
];

function findColumnIndex(headers: string[], patterns: RegExp[]): number {
  for (const pattern of patterns) {
    const idx = headers.findIndex(h => pattern.test(h.trim()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function cellToString(cell: ExcelJS.CellValue): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell !== 'object') return String(cell);

  const obj = cell as unknown as Record<string, unknown>;

  // Rich text: concatenate all text segments
  if ('richText' in obj && Array.isArray(obj.richText)) {
    return (obj.richText as Array<{ text: string }>).map(rt => rt.text).join('');
  }

  // Hyperlink: extract visible text
  if ('text' in obj && typeof obj.text === 'string') {
    return obj.text;
  }

  // Formula / shared formula: use the computed result
  if ('formula' in obj || 'sharedFormula' in obj) {
    const result = obj.result;
    if (result === null || result === undefined) return '';
    if (typeof result === 'object' && 'error' in (result as Record<string, unknown>)) {
      return ''; // Excel error value (#N/A, #REF!, etc.)
    }
    return String(result);
  }

  // Error cell
  if ('error' in obj && typeof obj.error === 'string') {
    return '';
  }

  // Unknown object type — return empty rather than [object Object]
  return '';
}

// ─── Parser ──────────────────────────────────────────────────────────────────

/**
 * Parse a message list file into structured entries.
 *
 * @param filePath - Absolute path to the message list file
 * @returns Parsed messages with source metadata
 * @throws If the file cannot be read or parsed
 */
export async function parseMessageListFile(filePath: string): Promise<MessageListParseResult> {
  const ext = path.extname(filePath).toLowerCase();
  const format = ext === '.csv' ? 'csv' : ext === '.xls' ? 'xls' : 'xlsx';

  const workbook = new ExcelJS.Workbook();

  if (format === 'csv') {
    const content = await fs.readFile(filePath, 'utf-8');
    const worksheet = workbook.addWorksheet('Sheet1');
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      if (line.trim()) {
        // Simple CSV parsing — handles quoted fields
        const cells = parseCSVLine(line);
        worksheet.addRow(cells);
      }
    }
  } else {
    try {
      await workbook.xlsx.readFile(filePath);
    } catch (readError) {
      // .xls (legacy BIFF format) is not supported by ExcelJS — give a clear message
      if (format === 'xls') {
        throw new Error(
          'Legacy .xls format is not supported. Please re-save the file as .xlsx in Excel and try again.'
        );
      }
      throw readError;
    }
  }

  const sheet = workbook.worksheets[0];
  if (!sheet || sheet.rowCount === 0) {
    return { messages: [], skippedRows: 0, format, duplicateCodes: [], emptyCodeRows: [] };
  }

  // Read all rows as string arrays
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells = row.values as ExcelJS.CellValue[];
    // ExcelJS row.values is 1-indexed (index 0 is undefined)
    const stringCells = cells.slice(1).map(cellToString);
    rows.push(stringCells);
  });

  if (rows.length === 0) {
    return { messages: [], skippedRows: 0, format, duplicateCodes: [], emptyCodeRows: [] };
  }

  // Detect header row and column positions
  const headers = rows[0];
  let codeCol = findColumnIndex(headers, CODE_COLUMN_PATTERNS);
  let textCol = findColumnIndex(headers, TEXT_COLUMN_PATTERNS);
  let variantOfCol = findColumnIndex(headers, VARIANT_OF_COLUMN_PATTERNS);
  let dataStartRow = 1; // After header

  // If no header match, assume col A = code, col B = text, no header row
  if (codeCol === -1 && textCol === -1) {
    codeCol = 0;
    textCol = headers.length > 1 ? 1 : -1;
    variantOfCol = -1; // No header detected — can't detect variant_of column
    dataStartRow = 0; // No header detected — all rows are data
  } else if (codeCol === -1) {
    codeCol = 0; // Default code to column A
  } else if (textCol === -1) {
    textCol = codeCol === 0 ? 1 : 0; // Default text to the other column
  }

  const messages: MessageListEntry[] = [];
  let skippedRows = 0;
  const emptyCodeRows: number[] = [];

  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    const code = (row[codeCol] ?? '').trim();
    const text = textCol >= 0 ? (row[textCol] ?? '').trim() : '';

    if (!code && !text) {
      skippedRows++;
      continue;
    }

    // Track rows where code was empty (auto-generated)
    if (!code) {
      emptyCodeRows.push(i + 1);
    }

    // Parse variantOf column if detected
    let variantOf: string | undefined;
    if (variantOfCol >= 0) {
      const val = (row[variantOfCol] ?? '').trim();
      if (val) variantOf = val;
    }

    messages.push({
      code: code || `ROW_${i + 1}`,
      text: text || code,
      sourceRow: i + 1,
      ...(variantOf !== undefined && { variantOf }),
    });
  }

  // Detect duplicate codes (case-insensitive)
  const codeCountMap = new Map<string, number>();
  for (const msg of messages) {
    const upper = msg.code.toUpperCase();
    codeCountMap.set(upper, (codeCountMap.get(upper) ?? 0) + 1);
  }
  const duplicateCodes = [...codeCountMap.entries()]
    .filter(([, count]) => count > 1)
    .map(([code]) => code);

  return { messages, skippedRows, format, duplicateCodes, emptyCodeRows };
}

// ─── Variant-Of Graph Validation ────────────────────────────────────────────

/**
 * Validate the variantOf references in a set of message entries.
 *
 * Checks for:
 *   - Unknown references (variantOf points to a code that doesn't exist)
 *   - Self-references (variantOf points to the same code)
 *   - Cycles (A → B → A, or longer chains)
 *
 * @param entries - Message entries with optional variantOf fields
 * @returns Array of warnings (empty if graph is valid)
 */
export function validateVariantOfGraph(entries: MessageListEntry[]): MaxDiffWarning[] {
  const warnings: MaxDiffWarning[] = [];
  const codeSet = new Set(entries.map(e => e.code.toUpperCase()));
  const variantMap = new Map<string, string>(); // code → variantOf (uppercase)

  for (const entry of entries) {
    if (!entry.variantOf) continue;

    const code = entry.code.toUpperCase();
    const ref = entry.variantOf.toUpperCase();

    // Self-reference
    if (code === ref) {
      warnings.push({
        code: 'variantof_self_ref',
        message: `Message "${entry.code}" references itself as variantOf`,
      });
      continue;
    }

    // Unknown reference
    if (!codeSet.has(ref)) {
      warnings.push({
        code: 'variantof_unknown_ref',
        message: `Message "${entry.code}" references unknown code "${entry.variantOf}" as variantOf`,
      });
      continue;
    }

    variantMap.set(code, ref);
  }

  // Cycle detection via DFS
  const visited = new Set<string>();
  const inStack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (inStack.has(node)) {
      const cycleStart = path.indexOf(node);
      const cycle = path.slice(cycleStart).concat(node);
      warnings.push({
        code: 'variantof_cycle',
        message: `Circular variantOf reference detected: ${cycle.join(' → ')}`,
      });
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    inStack.add(node);

    const next = variantMap.get(node);
    if (next) {
      dfs(next, [...path, node]);
    }

    inStack.delete(node);
  }

  for (const code of variantMap.keys()) {
    if (!visited.has(code)) {
      dfs(code, []);
    }
  }

  return warnings;
}

/**
 * Simple CSV line parser that handles quoted fields.
 */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++; // Skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        result.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
  }

  result.push(current);
  return result;
}
