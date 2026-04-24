"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronDown, Expand } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { buildAnalysisCellId } from "@/lib/analysis/types";
import type {
  AnalysisTableCard,
  AnalysisTableCardCell,
  AnalysisTableCardColumn,
  AnalysisTableCardColumnGroup,
  AnalysisTableCardRowFormat,
  AnalysisTableCardRow,
} from "@/lib/analysis/types";

// Kept in sync with getAnalysisCellAnchorId in AnalysisMessage.tsx. Both
// sanitize cellId to CSS-safe chars (`|`, `%`, `:`, `.` → `-`).
function cellAnchorId(cellId: string): string {
  return `analysis-cell-${cellId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

const TOTAL_GROUP_KEY = "__total__";

function ScrollableTableContainer({ children }: { children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [isScrolledToEnd, setIsScrolledToEnd] = useState(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const check = () => {
      const overflowed = el.scrollWidth > el.clientWidth + 1;
      setHasOverflow(overflowed);
      const atEnd = !overflowed
        || Math.ceil(el.scrollLeft + el.clientWidth) >= el.scrollWidth - 1;
      setIsScrolledToEnd(atEnd);
    };

    check();
    el.addEventListener("scroll", check, { passive: true });

    const resizeObserver = new ResizeObserver(check);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener("scroll", check);
      resizeObserver.disconnect();
    };
  }, []);

  const showFade = hasOverflow && !isScrolledToEnd;

  return (
    <div className="relative">
      <div ref={scrollRef} className="w-full overflow-x-auto">
        {children}
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-background via-background/50 to-transparent transition-opacity duration-150 dark:from-card dark:via-card/50",
          showFade ? "opacity-100" : "opacity-0",
        )}
      />
    </div>
  );
}

function valueModeLabel(valueMode: AnalysisTableCard["valueMode"]): string {
  switch (valueMode) {
    case "pct":
      return "Percent";
    case "count":
      return "Count";
    case "n":
      return "Base n";
    case "mean":
      return "Mean";
    default:
      return valueMode;
  }
}

function buildQuestionHeading(card: AnalysisTableCard): string {
  if (card.questionId && card.questionText) {
    const questionId = card.questionId.replace(/[.:]\s*$/, "").trim();
    return `${questionId}. ${card.questionText}`;
  }

  return card.questionText ?? card.title;
}

function getColumnHeaderLabel(column: AnalysisTableCardColumn): string {
  return column.cutName;
}

function getColumnHeaderStatLetter(column: AnalysisTableCardColumn): string | null {
  if (!column.statLetter || column.statLetter.trim().length === 0) {
    return null;
  }

  return `(${column.statLetter})`;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function deriveLegacyGroupKey(column: AnalysisTableCardColumn): string {
  const isTotal = column.isTotal ?? normalizeText(column.cutName) === "total";
  if (isTotal) return TOTAL_GROUP_KEY;

  const normalizedGroup = normalizeText(column.groupName);
  if (normalizedGroup) return `group:${normalizedGroup}`;

  return `cut:${normalizeText(column.cutName) || column.cutName.toLowerCase()}`;
}

function deriveLegacyCutKey(column: AnalysisTableCardColumn): string {
  return `${deriveLegacyGroupKey(column)}::${normalizeText(column.cutName) || column.cutName.toLowerCase()}`;
}

export function normalizeGroundedTableCardGroups(card: AnalysisTableCard): AnalysisTableCardColumnGroup[] {
  if (card.columnGroups && card.columnGroups.length > 0) {
    return card.columnGroups.map((group) => ({
      ...group,
      columns: group.columns.map((column) => ({
        ...column,
        cutKey: column.cutKey ?? deriveLegacyCutKey(column),
        isTotal: column.isTotal ?? group.groupKey === TOTAL_GROUP_KEY,
      })),
    }));
  }

  const groups: AnalysisTableCardColumnGroup[] = [];
  let currentGroup: AnalysisTableCardColumnGroup | null = null;

  for (const column of card.columns) {
    const groupKey = deriveLegacyGroupKey(column);
    if (!currentGroup || currentGroup.groupKey !== groupKey) {
      currentGroup = {
        groupKey,
        groupName: groupKey === TOTAL_GROUP_KEY ? "Total" : column.groupName,
        columns: [],
      };
      groups.push(currentGroup);
    }

    currentGroup.columns.push({
      ...column,
      cutKey: column.cutKey ?? deriveLegacyCutKey(column),
      isTotal: column.isTotal ?? groupKey === TOTAL_GROUP_KEY,
    });
  }

  return groups;
}

export function getGroundedTableCardVisibleGroups(
  card: AnalysisTableCard,
  showAllGroups: boolean,
  focus?: {
    focusedGroupKeys?: string[] | null;
  },
): AnalysisTableCardColumnGroup[] {
  const groups = normalizeGroundedTableCardGroups({
    ...card,
    focusedGroupKeys: focus?.focusedGroupKeys ?? card.focusedGroupKeys ?? null,
  });
  const hasPreviewState = typeof card.initialVisibleGroupCount === "number"
    || typeof card.hiddenGroupCount === "number"
    || typeof card.defaultScope === "string";

  if (showAllGroups || !hasPreviewState) {
    return groups;
  }

  const totalGroups = groups.filter((group) => group.groupKey === TOTAL_GROUP_KEY);
  const nonTotalGroups = groups.filter((group) => group.groupKey !== TOTAL_GROUP_KEY);

  // Render focus narrows the compact view only; it must not reshuffle the
  // underlying contract order.
  const focusedGroupKeys = new Set<string>(focus?.focusedGroupKeys ?? card.focusedGroupKeys ?? []);
  if (focusedGroupKeys.size === 0 && card.focusedCutIds && card.focusedCutIds.length > 0) {
    const focusedCuts = new Set(card.focusedCutIds);
    for (const group of nonTotalGroups) {
      if (group.columns.some((column) => column.cutKey && focusedCuts.has(column.cutKey))) {
        focusedGroupKeys.add(group.groupKey);
      }
    }
  }

  if (focusedGroupKeys.size > 0) {
    const focusedGroups = nonTotalGroups.filter((group) =>
      focusedGroupKeys.has(group.groupKey),
    );
    if (focusedGroups.length > 0) {
      return [...totalGroups, ...focusedGroups];
    }
  }

  const defaultScope = card.defaultScope ?? "matched_groups";
  const visibleNonTotalCount = defaultScope === "total_only"
    ? 0
    : Math.max(card.initialVisibleGroupCount ?? 1, 0);

  return [
    ...totalGroups,
    ...nonTotalGroups.slice(0, visibleNonTotalCount),
  ];
}

export function getGroundedTableCardVisibleRows(
  card: AnalysisTableCard,
  showAllRows: boolean,
  _focus?: {
    focusedRowKeys?: string[] | null;
  },
): AnalysisTableCardRow[] {
  const sourceRows = card.rows;
  const hasPreviewState = typeof card.initialVisibleRowCount === "number"
    || typeof card.hiddenRowCount === "number";

  if (showAllRows || !hasPreviewState) {
    return sourceRows;
  }

  const visibleCount = Math.max(card.initialVisibleRowCount ?? sourceRows.length, 0);
  return sourceRows.slice(0, visibleCount);
}

export function getGroundedTableCardCell(
  row: AnalysisTableCardRow,
  column: AnalysisTableCardColumn,
): AnalysisTableCardCell | null {
  const cutKey = column.cutKey ?? deriveLegacyCutKey(column);
  if (row.cellsByCutKey?.[cutKey]) {
    return row.cellsByCutKey[cutKey];
  }

  return row.values.find((value) =>
    (value.cutKey && value.cutKey === cutKey)
    || value.cutName === column.cutName) ?? null;
}

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, "$1");
}

function formatDisplayValue(
  value: number | null,
  format: AnalysisTableCardRowFormat | null | undefined,
): string {
  if (value === null || !Number.isFinite(value)) return "—";

  if (format?.kind === "percent") {
    return `${formatNumber(value, format.decimals)}%`;
  }

  return formatNumber(value, format?.decimals ?? 0);
}

function getRenderedCellDisplayValue(
  row: AnalysisTableCardRow,
  cell: AnalysisTableCardCell,
): string {
  if (row.format) {
    return formatDisplayValue(cell.rawValue, row.format);
  }

  return cell.displayValue;
}

export function getGroundedTableCardSignificanceMarkers(
  row: AnalysisTableCardRow,
  column: AnalysisTableCardColumn,
  columns: AnalysisTableCardColumn[],
): string[] {
  const cell = getGroundedTableCardCell(row, column);
  if (!cell) return [];

  const markers = [...cell.sigHigherThan];

  if (column.isTotal) {
    for (const comparisonColumn of columns) {
      if ((comparisonColumn.cutKey ?? comparisonColumn.cutName) === (column.cutKey ?? column.cutName)) {
        continue;
      }

      const comparisonCell = getGroundedTableCardCell(row, comparisonColumn);
      if (comparisonCell?.sigVsTotal === "lower" && comparisonColumn.statLetter) {
        markers.push(comparisonColumn.statLetter);
      }
    }
  } else if (cell.sigVsTotal === "higher") {
    markers.push("T");
  }

  return [...new Set(markers.filter((marker) => marker.trim().length > 0))];
}

export function GroundedTableCard({
  card,
  focus,
  displayState = "ready",
}: {
  card: AnalysisTableCard;
  focus?: {
    focusedRowKeys?: string[] | null;
    focusedGroupKeys?: string[] | null;
  };
  displayState?: "ready" | "shell";
}) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isDiveDeeperOpen, setIsDiveDeeperOpen] = useState(false);

  const allGroups = normalizeGroundedTableCardGroups(card);
  const visibleGroups = getGroundedTableCardVisibleGroups(card, false, {
    focusedGroupKeys: focus?.focusedGroupKeys ?? card.focusedGroupKeys ?? null,
  });
  const visibleRows = getGroundedTableCardVisibleRows(card, false, {
    focusedRowKeys: focus?.focusedRowKeys ?? card.focusedRowKeys ?? null,
  });
  const hiddenRowCount = card.hiddenRowCount ?? card.truncatedRows;
  const previewHiddenRowCount = Math.max(card.rows.length - visibleRows.length, 0);
  const totalNonTotalCuts = allGroups
    .filter((group) => group.groupKey !== TOTAL_GROUP_KEY)
    .reduce((sum, group) => sum + group.columns.length, 0);
  const visibleNonTotalCuts = visibleGroups
    .filter((group) => group.groupKey !== TOTAL_GROUP_KEY)
    .reduce((sum, group) => sum + group.columns.length, 0);
  const hiddenCutCount = Math.max(totalNonTotalCuts - visibleNonTotalCuts, 0);
  const nonTotalColumnGroups = allGroups.filter((group) => group.groupKey !== TOTAL_GROUP_KEY);
  const questionHeading = buildQuestionHeading(card);
  const hasMetadata = Boolean(
    card.tableId
    || card.baseText
    || card.tableSubtitle
    || card.userNote
    || card.significanceTest
    || card.comparisonGroups.length > 0
    || nonTotalColumnGroups.length > 0,
  );

  if (displayState === "shell") {
    return (
      <Card
        data-analysis-table-shell="true"
        className="mt-3 max-w-full overflow-hidden border-border/70 bg-background/70"
      >
        <CardHeader className="gap-2 px-5 pb-2 pt-3">
          <div className="space-y-2">
            <div className="h-5 w-48 rounded-full bg-muted/50" />
            <div className="h-4 w-64 rounded-full bg-muted/35" />
          </div>
        </CardHeader>
        <CardContent className="space-y-3 px-5 pb-5 pt-2">
          <div className="grid gap-2 sm:grid-cols-4">
            <div className="h-8 rounded-lg bg-muted/40 sm:col-span-1" />
            <div className="h-8 rounded-lg bg-muted/30" />
            <div className="h-8 rounded-lg bg-muted/30" />
            <div className="h-8 rounded-lg bg-muted/30" />
          </div>
          <div className="space-y-2">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={`shell-row-${index}`} className="grid gap-2 sm:grid-cols-4">
                <div className="h-7 rounded-md bg-muted/35 sm:col-span-1" />
                <div className="h-7 rounded-md bg-muted/20" />
                <div className="h-7 rounded-md bg-muted/20" />
                <div className="h-7 rounded-md bg-muted/20" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  function renderTableContent({
    groups,
    rows,
    density = "comfortable",
    focusedRowKeys,
  }: {
    groups: AnalysisTableCardColumnGroup[];
    rows: AnalysisTableCardRow[];
    density?: "compact" | "comfortable";
    focusedRowKeys?: string[] | null;
  }) {
    const columns = groups.flatMap((group) => group.columns);
    const showGroupHeaderInTable = groups.some((group) => group.groupKey !== TOTAL_GROUP_KEY);
    const isCompact = density === "compact";
    const rowHeaderLabel = isCompact ? "" : "Row";

    return (
      <ScrollableTableContainer>
        <table className={cn("w-max min-w-full border-collapse", isCompact ? "text-[13px]" : "text-sm")}>
          <thead>
            {showGroupHeaderInTable ? (
              <>
                <tr className="border-b border-border/60 bg-muted/10 text-left">
                  <th
                    rowSpan={2}
                    className={cn(
                      "font-medium text-foreground/90",
                      isCompact ? "min-w-[200px] px-3 py-1.5" : "min-w-[220px] px-4 py-3",
                    )}
                  >
                    {rowHeaderLabel ? rowHeaderLabel : <span className="sr-only">Row</span>}
                  </th>
                  {groups.map((group) => (
                    <th
                      key={group.groupKey}
                      colSpan={group.columns.length}
                      className={cn(
                        "uppercase tracking-[0.14em] text-muted-foreground",
                        isCompact ? "px-2.5 py-1 text-[10px]" : "px-3 py-2 text-xs",
                      )}
                    >
                      {group.groupName ?? "Cuts"}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-border/60 bg-muted/5 text-left">
                  {columns.map((column) => (
                    <th
                      key={column.cutKey ?? column.cutName}
                      className={cn(
                        "font-medium",
                        isCompact ? "min-w-[112px] px-2.5 py-1.5" : "min-w-[132px] px-3 py-3",
                      )}
                    >
                      <div className="space-y-0.5">
                        <div>{getColumnHeaderLabel(column)}</div>
                        {getColumnHeaderStatLetter(column) ? (
                          <div className={cn("font-mono text-tab-teal", isCompact ? "text-[10px]" : "text-xs")}>
                            {getColumnHeaderStatLetter(column)}
                          </div>
                        ) : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </>
            ) : (
              <tr className="border-b border-border/60 bg-muted/10 text-left">
                <th
                  className={cn(
                    "font-medium text-foreground/90",
                    isCompact ? "min-w-[200px] px-3 py-1.5" : "min-w-[220px] px-4 py-3",
                  )}
                >
                  {rowHeaderLabel ? rowHeaderLabel : <span className="sr-only">Row</span>}
                </th>
                {columns.map((column) => (
                  <th
                    key={column.cutKey ?? column.cutName}
                    className={cn(
                      "font-medium",
                      isCompact ? "min-w-[112px] px-2.5 py-1.5" : "min-w-[132px] px-3 py-3",
                    )}
                  >
                    <div className="space-y-0.5">
                      <div>{getColumnHeaderLabel(column)}</div>
                      {getColumnHeaderStatLetter(column) ? (
                        <div className={cn("font-mono text-tab-teal", isCompact ? "text-[10px]" : "text-xs")}>
                          {getColumnHeaderStatLetter(column)}
                        </div>
                      ) : null}
                    </div>
                  </th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            <tr className="border-b border-border/60 bg-muted/5">
              <td className={cn("align-middle text-muted-foreground", isCompact ? "px-3 py-1" : "px-4 py-2")}>
                <div className={cn(isCompact ? "text-xs" : "text-sm")}>
                  Base
                </div>
              </td>
              {columns.map((column) => (
                <td key={`base-${column.cutKey ?? column.cutName}`} className={cn("align-middle font-mono text-muted-foreground", isCompact ? "px-2.5 py-1 text-xs" : "px-3 py-2 text-[13px]")}>
                  {column.baseN !== null ? `n=${column.baseN}` : "—"}
                </td>
              ))}
            </tr>
            {rows.map((row) => {
              const isHighlighted = Boolean(focusedRowKeys?.includes(row.rowKey));

              return (
                <tr key={row.rowKey} className={cn("border-b border-border/40 last:border-b-0", isHighlighted && "bg-emerald-500/5")}>
                  <td className={cn("align-middle", isCompact ? "px-3 py-1.5" : "px-4 py-3", isHighlighted && "border-l-2 border-emerald-500/40")}>
                    <div
                      className={cn(
                        isCompact ? "leading-[1.125rem]" : "leading-6",
                        row.isNet ? "font-medium text-foreground" : "text-foreground/90",
                      )}
                      style={{ paddingLeft: `${row.indent * 0.875}rem` }}
                    >
                      {row.label}
                    </div>
                  </td>
                  {columns.map((column) => {
                    const cell = getGroundedTableCardCell(row, column);
                    const markers = getGroundedTableCardSignificanceMarkers(row, column, columns);
                    const resolvedCutKey = column.cutKey ?? column.cutName;
                    const anchorCellId = buildAnalysisCellId({
                      tableId: card.tableId,
                      rowKey: row.rowKey,
                      cutKey: resolvedCutKey,
                    });

                    return (
                      <td
                        key={`${row.rowKey}-${resolvedCutKey}`}
                        id={cellAnchorId(anchorCellId)}
                        className={cn("scroll-mt-24 align-middle transition-shadow duration-300", isCompact ? "px-2.5 py-1.5" : "px-3 py-3")}
                      >
                        {cell ? (
                          <div
                            className={cn(
                              "inline-flex items-center gap-0.5 font-mono",
                              isCompact ? "text-xs" : "text-[13px]",
                              markers.length > 0
                                ? "font-semibold text-tab-teal"
                                : "text-foreground",
                            )}
                          >
                            <span>{getRenderedCellDisplayValue(row, cell)}</span>
                            {markers.length > 0 ? (
                              <sup className={cn("font-mono leading-none text-tab-teal", isCompact ? "text-[9px]" : "text-[10px]")}>
                                {markers.join("")}
                              </sup>
                            ) : null}
                          </div>
                        ) : (
                          <div className={cn("font-mono text-muted-foreground", isCompact ? "text-xs" : "text-[13px]")}>—</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTableContainer>
    );
  }

  return (
    <>
      <Card className="mt-3 max-w-full overflow-hidden border-border/70 bg-background/70">
        <CardHeader className="gap-0 px-5 pb-0 pt-1.5">
          <Collapsible open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
            <CardTitle className="font-serif text-lg font-normal leading-snug tracking-tight text-foreground/90">
              {questionHeading}
            </CardTitle>
            {card.tableSubtitle ? (
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {card.tableSubtitle}
              </p>
            ) : null}

            {hasMetadata ? (
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="xs" className="h-5 px-1.5 text-[11px]">
                  Details
                  <ChevronDown
                    className={cn("h-3.5 w-3.5 transition-transform", isDetailsOpen && "rotate-180")}
                  />
                </Button>
              </CollapsibleTrigger>
            ) : null}

            {hasMetadata ? (
              <CollapsibleContent className="mt-1.5 space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                  <div className="space-y-2">
                    {card.baseText ? <p><span className="text-foreground/80">Base:</span> {card.baseText}</p> : null}
                    {card.tableSubtitle ? <p><span className="text-foreground/80">Subtitle:</span> {card.tableSubtitle}</p> : null}
                    {card.userNote ? <p className="leading-6"><span className="text-foreground/80">Note:</span> {card.userNote}</p> : null}
                  </div>
                  <div className="space-y-2">
                    {card.tableId ? <p><span className="text-foreground/80">Source table:</span> {card.tableId}</p> : null}
                    <p><span className="text-foreground/80">Value type:</span> {valueModeLabel(card.valueMode)}</p>
                    {card.significanceTest ? <p><span className="text-foreground/80">Significance:</span> {card.significanceTest}</p> : null}
                    {card.comparisonGroups.length > 0 ? (
                      <p className="leading-6">
                        <span className="text-foreground/80">Comparison groups:</span> {card.comparisonGroups.join(", ")}
                      </p>
                    ) : null}
                  </div>
                </div>

                {allGroups.length > 0 ? (
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.16em] text-foreground/70">
                      Column Details
                    </p>
                    <div className="overflow-x-auto rounded-lg border border-border/50 bg-background/60">
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b border-border/50 bg-muted/10 text-left">
                            <th className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-foreground/70">Group</th>
                            <th className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-foreground/70">Cut</th>
                            <th className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-foreground/70">Letter</th>
                            <th className="px-3 py-1.5 text-[11px] uppercase tracking-[0.14em] text-foreground/70">n</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allGroups.map((group) =>
                            group.columns.map((column, columnIndex) => (
                              <tr key={column.cutKey ?? column.cutName} className="border-b border-border/40 last:border-b-0">
                                {columnIndex === 0 ? (
                                  <td
                                    rowSpan={group.columns.length}
                                    className="border-r border-border/40 px-3 py-1.5 align-top font-medium text-foreground/80"
                                  >
                                    {group.groupName ?? "—"}
                                  </td>
                                ) : null}
                                <td className="px-3 py-1.5 text-foreground">{column.cutName}</td>
                                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{column.statLetter ?? "—"}</td>
                                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">{column.baseN !== null ? column.baseN : "—"}</td>
                              </tr>
                            )),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : null}
              </CollapsibleContent>
            ) : null}
          </Collapsible>
        </CardHeader>

        <CardContent className="p-0">
          {renderTableContent({
            groups: visibleGroups,
            rows: visibleRows,
            density: "compact",
            focusedRowKeys: focus?.focusedRowKeys ?? card.focusedRowKeys ?? null,
          })}

          <div className="border-t border-border/40 px-2 py-1">
            <Button variant="ghost" size="xs" className="h-auto gap-1.5 px-2 py-0.5 text-[11px] italic text-muted-foreground" onClick={() => setIsDiveDeeperOpen(true)}>
              <Expand className="h-3 w-3 shrink-0" />
              {hiddenRowCount > 0 ? "Answer options truncated. " : ""}
              {hiddenRowCount === 0 && previewHiddenRowCount > 0 ? "Additional rows available. " : ""}
              {hiddenCutCount > 0 ? `Showing ${visibleNonTotalCuts} of ${totalNonTotalCuts} cuts. ` : ""}
              Expand table for deeper analysis.
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={isDiveDeeperOpen} onOpenChange={setIsDiveDeeperOpen}>
        <DialogContent className="flex h-[90vh] w-[96vw] max-w-[96vw] flex-col overflow-hidden p-0 sm:h-[88vh] sm:w-[82vw] sm:max-w-[82vw] xl:w-[78vw] xl:max-w-[78vw]">
          <DialogHeader className="shrink-0 border-b border-border/60 px-6 py-5">
            <DialogTitle className="font-serif text-2xl tracking-tight">
              {questionHeading}
            </DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-5">
            {hasMetadata ? (
              <div className="shrink-0 grid gap-x-6 gap-y-2 rounded-xl border border-border/60 bg-muted/10 p-4 text-sm text-muted-foreground md:grid-cols-2">
                <div className="space-y-2">
                  {card.baseText ? <p><span className="text-foreground/80">Base:</span> {card.baseText}</p> : null}
                  {card.tableSubtitle ? <p><span className="text-foreground/80">Subtitle:</span> {card.tableSubtitle}</p> : null}
                  {card.userNote ? <p><span className="text-foreground/80">Note:</span> {card.userNote}</p> : null}
                </div>
                <div className="space-y-2">
                  {card.significanceTest ? <p><span className="text-foreground/80">Significance:</span> {card.significanceTest}</p> : null}
                  {card.comparisonGroups.length > 0 ? <p><span className="text-foreground/80">Comparison groups:</span> {card.comparisonGroups.join(", ")}</p> : null}
                </div>
              </div>
            ) : null}

            <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-border/60">
              {renderTableContent({
                groups: allGroups,
                rows: getGroundedTableCardVisibleRows(card, true, {
                  focusedRowKeys: focus?.focusedRowKeys ?? card.focusedRowKeys ?? null,
                }),
                density: "comfortable",
                focusedRowKeys: focus?.focusedRowKeys ?? card.focusedRowKeys ?? null,
              })}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
