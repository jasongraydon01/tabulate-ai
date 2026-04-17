"use client";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { AnalysisTableCard } from "@/lib/analysis/types";

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

export function GroundedTableCard({ card }: { card: AnalysisTableCard }) {
  return (
    <Card className="mt-3 overflow-hidden border-border/80 bg-background/60">
      <CardHeader className="gap-3 border-b border-border/70 bg-muted/20">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <CardTitle className="font-serif text-xl tracking-tight">
              {card.title}
            </CardTitle>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="font-mono">
                {card.tableId}
              </Badge>
              {card.questionId ? (
                <Badge variant="outline" className="font-mono">
                  {card.questionId}
                </Badge>
              ) : null}
              <Badge variant="secondary">
                {valueModeLabel(card.valueMode)}
              </Badge>
            </div>
          </div>

          <div className="text-right text-xs text-muted-foreground">
            <div>{card.totalRows} row{card.totalRows === 1 ? "" : "s"}</div>
            <div>{card.totalColumns} cut{card.totalColumns === 1 ? "" : "s"}</div>
          </div>
        </div>

        {(card.baseText || card.tableSubtitle || card.userNote) ? (
          <div className="space-y-1 text-sm text-muted-foreground">
            {card.baseText ? <p>{card.baseText}</p> : null}
            {card.tableSubtitle ? <p>{card.tableSubtitle}</p> : null}
            {card.userNote ? <p>{card.userNote}</p> : null}
          </div>
        ) : null}
      </CardHeader>

      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-border/70 bg-muted/10 text-left">
                <th className="min-w-[220px] px-4 py-3 font-medium text-foreground/90">Row</th>
                {card.columns.map((column) => (
                  <th key={column.cutName} className="min-w-[138px] px-3 py-3 align-bottom">
                    <div className="space-y-1">
                      <div className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                        {column.groupName ?? "Cut"}
                      </div>
                      <div className="font-medium leading-5">{column.cutName}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {column.statLetter ? `${column.statLetter} · ` : ""}
                        {column.baseN !== null ? `n=${column.baseN}` : "n=—"}
                      </div>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {card.rows.map((row) => (
                <tr key={row.rowKey} className="border-b border-border/50 last:border-b-0">
                  <td className="px-4 py-3 align-top">
                    <div
                      className={cn(
                        "leading-6",
                        row.isNet ? "font-medium text-foreground" : "text-foreground/90",
                      )}
                      style={{ paddingLeft: `${row.indent * 0.875}rem` }}
                    >
                      {row.label}
                    </div>
                  </td>
                  {row.values.map((value) => (
                    <td key={`${row.rowKey}-${value.cutName}`} className="px-3 py-3 align-top">
                      <div className="font-mono text-[13px]">{value.displayValue}</div>
                      {(value.sigHigherThan.length > 0 || value.sigVsTotal) ? (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          {value.sigHigherThan.length > 0 ? `>${value.sigHigherThan.join(", ")}` : ""}
                          {value.sigHigherThan.length > 0 && value.sigVsTotal ? " · " : ""}
                          {value.sigVsTotal ? `vs total: ${value.sigVsTotal}` : ""}
                        </div>
                      ) : null}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-border/70 bg-muted/10 px-4 py-3 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {card.significanceTest ? (
              <span>{card.significanceTest}</span>
            ) : null}
            {card.significanceLevel !== null ? (
              <span>alpha {card.significanceLevel}</span>
            ) : null}
            {card.truncatedRows > 0 ? (
              <span>+{card.truncatedRows} more row{card.truncatedRows === 1 ? "" : "s"} not shown</span>
            ) : null}
            {card.truncatedColumns > 0 ? (
              <span>+{card.truncatedColumns} more cut{card.truncatedColumns === 1 ? "" : "s"} not shown</span>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
