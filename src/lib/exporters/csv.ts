/**
 * CSV exporter
 * Purpose: Emit a flattened CSV from a CutTable for quick inspection and Excel import
 * Notes: Escapes quotes and flattens multi-line fields
 */
import type { CutTable } from '@/lib/tables/CutTable';

export function exportCutTableToCSV(table: CutTable): string {
  const header = ['groupName', 'name', 'expression', 'confidence', 'reason'];
  const rows = table.groups.flatMap((group) =>
    group.columns.map((column) => [
      group.groupName,
      column.name,
      column.expression.replace(/\r?\n/g, ' ').trim(),
      column.confidence.toFixed(3),
      column.reason.replace(/\r?\n/g, ' ').trim(),
    ]),
  );
  const lines = [header, ...rows].map((cols) =>
    cols.map((value) => `"${String(value).replace(/\"/g, '""')}"`).join(','),
  );
  return lines.join('\n');
}


