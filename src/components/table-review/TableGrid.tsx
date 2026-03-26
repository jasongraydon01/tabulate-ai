/**
 * @deprecated Legacy Review Tables UI removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not import from active code.
 */
'use client';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { TableData } from '@/lib/excel/ExcelFormatter';
import type { BannerGroup } from '@/lib/r/RScriptGeneratorV2';
import type { TableDisplayMode } from '@/lib/tableReview/displayMode';

interface TableGridProps {
  table: TableData;
  bannerGroups: BannerGroup[];
  displayMode: TableDisplayMode;
}

/** Row data shape for frequency tables (matches FrequencyRowData in Excel renderers) */
interface FrequencyRow {
  label: string;
  n: number | null;
  count: number | null;
  pct: number | null;
  sig_higher_than?: string[] | string;
  isNet?: boolean;
  indent?: number;
  isCategoryHeader?: boolean;
}

/** Row data shape for mean_rows tables (matches MeanRowData in Excel renderers) */
interface MeanRow {
  label: string;
  n: number;
  mean: number | null;
  median: number | null;
  sd: number | null;
  sig_higher_than?: string[] | string;
  isNet?: boolean;
  indent?: number;
}

/** A cut object: stat_letter + row entries keyed by row key */
type CutObject = {
  stat_letter: string;
  [rowKey: string]: FrequencyRow | MeanRow | string; // string for stat_letter
};

/**
 * Renders a crosstab data grid from tables.json table data.
 * Phase 1: clean, functional — no sticky columns or significance coloring yet.
 */
function formatCountValue(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

export function TableGrid({ table, bannerGroups, displayMode }: TableGridProps) {
  const data = table.data as Record<string, CutObject>;
  const isMean = table.tableType === 'mean_rows';
  const isCountMode = !isMean && displayMode === 'counts';

  // Build statLetter → cutDisplayName map, and ordered cut list from banner groups
  const cuts: { name: string; statLetter: string; groupName: string; cutKey: string }[] = [];

  // Map stat letters to their cut display names in the data
  const statLetterToCutKey = new Map<string, string>();
  for (const [cutName, cutData] of Object.entries(data)) {
    if (cutData && typeof cutData === 'object' && 'stat_letter' in cutData) {
      statLetterToCutKey.set(cutData.stat_letter, cutName);
    }
  }

  for (const group of bannerGroups) {
    for (const col of group.columns) {
      const cutKey = statLetterToCutKey.get(col.statLetter) ?? col.name;
      cuts.push({ name: col.name, statLetter: col.statLetter, groupName: group.groupName, cutKey });
    }
  }

  // Extract row keys from the first cut that has data (filter out stat_letter)
  const firstCutData = cuts.length > 0 ? data[cuts[0].cutKey] : Object.values(data)[0];
  const rowKeys = firstCutData
    ? Object.keys(firstCutData).filter((k) => k !== 'stat_letter')
    : [];

  if (rowKeys.length === 0) {
    return (
      <p className="text-sm text-muted-foreground italic py-4">
        No data rows available for this table.
      </p>
    );
  }

  return (
    <div className="rounded-md border overflow-hidden">
      <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          {/* Banner group spanning row */}
          <TableRow className="border-b-0">
            <TableHead className="w-[200px] min-w-[200px]" />
            {bannerGroups.map((group) => (
              <TableHead
                key={group.groupName}
                colSpan={group.columns.length}
                className="text-center text-xs font-medium text-muted-foreground border-l"
              >
                {group.groupName}
              </TableHead>
            ))}
          </TableRow>
          {/* Cut name row */}
          <TableRow>
            <TableHead className="w-[200px] min-w-[200px] font-medium" />
            {cuts.map((cut) => (
              <TableHead
                key={cut.statLetter}
                className="text-center text-xs font-mono min-w-[70px] border-l"
              >
                {cut.name}
              </TableHead>
            ))}
          </TableRow>
          {/* Base row */}
          <TableRow className="bg-muted/50">
            <TableHead className="text-xs font-medium">Base</TableHead>
            {cuts.map((cut) => {
              const cutData = data[cut.cutKey];
              // Get n from the first row entry in this cut
              const firstRowKey = cutData
                ? Object.keys(cutData).find((k) => k !== 'stat_letter')
                : undefined;
              const firstRow = firstRowKey
                ? (cutData[firstRowKey] as FrequencyRow | MeanRow)
                : undefined;
              const base = firstRow?.n ?? '-';

              return (
                <TableHead
                  key={`base-${cut.statLetter}`}
                  className="text-center text-xs font-mono border-l"
                >
                  {base}
                </TableHead>
              );
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rowKeys.map((rowKey) => {
            // Read row properties from first available cut to get label/isNet/indent
            const sampleRow = (() => {
              for (const cut of cuts) {
                const row = data[cut.cutKey]?.[rowKey];
                if (row && typeof row === 'object') return row as FrequencyRow | MeanRow;
              }
              return undefined;
            })();

            const label = sampleRow?.label ?? rowKey;
            const isNet = sampleRow?.isNet ?? false;
            const indent = sampleRow?.indent ?? 0;

            return (
              <TableRow
                key={rowKey}
                className={isNet ? 'font-semibold bg-muted/30' : ''}
              >
                <TableCell
                  className={`text-sm ${indent > 0 && !isNet ? 'pl-6' : ''} ${isNet ? 'font-semibold' : ''}`}
                >
                  {label}
                </TableCell>
                {cuts.map((cut) => {
                  const cellData = data[cut.cutKey]?.[rowKey];
                  if (!cellData || typeof cellData !== 'object') {
                    return (
                      <TableCell
                        key={`${rowKey}-${cut.statLetter}`}
                        className="text-center font-mono text-sm border-l tabular-nums"
                      >
                        <span className="text-muted-foreground">-</span>
                      </TableCell>
                    );
                  }

                  const row = cellData as FrequencyRow & MeanRow;
                  const value = isMean ? row.mean : isCountMode ? row.count : row.pct;

                  // Format significance letters
                  const sig = row.sig_higher_than;
                  const sigText = Array.isArray(sig) ? sig.join('') : sig || '';

                  return (
                    <TableCell
                      key={`${rowKey}-${cut.statLetter}`}
                      className="text-center font-mono text-sm border-l tabular-nums"
                    >
                      {value !== null && value !== undefined ? (
                        <span>
                          {isMean
                            ? (typeof value === 'number' ? value.toFixed(2) : value)
                            : isCountMode
                              ? (typeof value === 'number' ? formatCountValue(value) : value)
                              : `${typeof value === 'number' ? value.toFixed(0) : value}%`}
                          {sigText && (
                            <span className="ml-1 text-xs text-muted-foreground">
                              {sigText}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                  );
                })}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>
    </div>
  );
}
