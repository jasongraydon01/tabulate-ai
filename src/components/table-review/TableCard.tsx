/**
 * @deprecated Legacy Review Tables UI removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not import from active code.
 */
'use client';

import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Sparkles, History } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { TableGrid } from './TableGrid';
import type { TableData } from '@/lib/excel/ExcelFormatter';
import type { BannerGroup } from '@/lib/r/RScriptGeneratorV2';
import type { TableDisplayMode } from '@/lib/tableReview/displayMode';

interface TableCardProps {
  table: TableData;
  bannerGroups: BannerGroup[];
  displayMode: TableDisplayMode;
  onInclude?: (tableId: string) => void;
  onExclude?: (tableId: string) => void;
  /** Phase 2: regeneration */
  isQueued?: boolean;
  hasRevisions?: boolean;
  onRegenerate?: (tableId: string) => void;
  onViewHistory?: (tableId: string) => void;
}

export function TableCard({
  table,
  bannerGroups,
  displayMode,
  onInclude,
  onExclude,
  isQueued,
  hasRevisions,
  onRegenerate,
  onViewHistory,
}: TableCardProps) {
  return (
    <Card
      id={`table-${table.tableId}`}
      className={`group transition-opacity ${table.excluded ? 'opacity-50 border-l-4 border-l-tab-rose' : ''}`}
    >
      {/* Excluded banner */}
      {table.excluded && (
        <div className="bg-tab-rose/10 border-b px-4 py-2 flex items-center justify-between">
          <span className="text-sm text-tab-rose font-medium">
            Excluded{table.excludeReason ? `: ${table.excludeReason}` : ''}
          </span>
          {onInclude && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => onInclude(table.tableId)}
              className="text-tab-rose hover:text-tab-rose"
            >
              <Eye className="h-3 w-3 mr-1" />
              Include
            </Button>
          )}
        </div>
      )}

      <CardHeader className="pb-3">
        <div className="space-y-1">
          {/* Title + exclude action */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-serif text-lg font-semibold leading-tight">
              {table.questionText || table.questionId}
            </h3>
            {/* Action buttons — appear on hover */}
            <div className="flex items-center gap-1 shrink-0">
              {/* Queued badge */}
              {isQueued && (
                <Badge variant="outline" className="text-tab-indigo border-tab-indigo/30 text-[10px] px-1.5 py-0">
                  Queued
                </Badge>
              )}
              {/* Regenerated badge */}
              {hasRevisions && !isQueued && (
                <Badge variant="outline" className="text-tab-teal border-tab-teal/30 text-[10px] px-1.5 py-0">
                  Regenerated
                </Badge>
              )}
              {/* History button */}
              {hasRevisions && onViewHistory && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onViewHistory(table.tableId)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground shrink-0"
                >
                  <History className="h-3.5 w-3.5" />
                </Button>
              )}
              {/* Regenerate button */}
              {onRegenerate && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onRegenerate(table.tableId)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-tab-indigo shrink-0"
                >
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  Regenerate
                </Button>
              )}
              {/* Exclude button */}
              {!table.excluded && onExclude && (
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => onExclude(table.tableId)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-tab-rose shrink-0"
                >
                  <EyeOff className="h-3.5 w-3.5 mr-1" />
                  Exclude
                </Button>
              )}
            </div>
          </div>

          {/* Subtitle for derived tables */}
          {table.tableSubtitle && (
            <p className="text-sm text-muted-foreground">{table.tableSubtitle}</p>
          )}

          {/* Metadata row */}
          <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
            <span>
              <span className="font-medium">Table:</span>{' '}
              <span className="font-mono">{table.tableId}</span>
            </span>
            {table.baseText && (
              <span>
                <span className="font-medium">Base:</span> {table.baseText}
              </span>
            )}
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <TableGrid
          table={table}
          bannerGroups={bannerGroups}
          displayMode={displayMode}
        />
      </CardContent>
    </Card>
  );
}
