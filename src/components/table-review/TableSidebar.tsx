/**
 * @deprecated Legacy Review Tables UI removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not import from active code.
 */
'use client';

import { useState, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Search, RefreshCw, Undo2, Eye, EyeOff, Sparkles } from 'lucide-react';
import type { TableData } from '@/lib/excel/ExcelFormatter';

export type StatusFilter = 'all' | 'included' | 'excluded';

interface PendingUpdate {
  tableId: string;
  exclude: boolean;
  excludeReason?: string;
}

interface TableSidebarProps {
  tables: TableData[];
  activeTableId: string | null;
  pendingUpdates: Map<string, PendingUpdate>;
  isRebuilding: boolean;
  statusFilter: StatusFilter;
  onStatusFilterChange: (filter: StatusFilter) => void;
  onScrollToTable: (tableId: string) => void;
  onToggleExclude: (tableId: string, exclude: boolean) => void;
  onRebuild: () => void;
  onDiscard: () => void;
  /** Phase 2: regeneration queue state */
  regenerationQueueSize?: number;
  queuedTableIds?: Set<string>;
  onOpenRegenerateDialog?: (tableId: string) => void;
  onOpenRegenerationQueue?: () => void;
}

export function TableSidebar({
  tables,
  activeTableId,
  pendingUpdates,
  isRebuilding,
  statusFilter,
  onStatusFilterChange,
  onScrollToTable,
  onToggleExclude,
  onRebuild,
  onDiscard,
  regenerationQueueSize = 0,
  queuedTableIds,
  onOpenRegenerateDialog,
  onOpenRegenerationQueue,
}: TableSidebarProps) {
  const [searchQuery, setSearchQuery] = useState('');

  // Compute effective excluded state (pending overrides current)
  const getEffectiveExcluded = (table: TableData): boolean => {
    const pending = pendingUpdates.get(table.tableId);
    if (pending) return pending.exclude;
    return table.excluded ?? false;
  };

  // Filter tables
  const filteredTables = useMemo(() => {
    return tables.filter((table) => {
      // Search filter
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          table.tableId.toLowerCase().includes(q) ||
          table.questionText?.toLowerCase().includes(q) ||
          table.questionId?.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      // Status filter
      const isExcluded = getEffectiveExcluded(table);
      if (statusFilter === 'included' && isExcluded) return false;
      if (statusFilter === 'excluded' && !isExcluded) return false;

      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tables, searchQuery, statusFilter, pendingUpdates]);

  const pendingCount = pendingUpdates.size;

  return (
    <div className="flex flex-col h-full">
      {/* Search + filters */}
      <div className="p-3 space-y-3 border-b">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tables..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-9"
          />
        </div>

        {/* Status filter chips */}
        <div className="flex gap-1.5 flex-wrap">
          {(['all', 'included', 'excluded'] as StatusFilter[]).map((status) => (
            <button
              key={status}
              className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                statusFilter === status
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-transparent text-muted-foreground border-border hover:border-foreground/50'
              }`}
              onClick={() => onStatusFilterChange(status)}
            >
              {status === 'all' ? 'All' : status === 'included' ? 'Included' : 'Excluded'}
            </button>
          ))}
        </div>

        {/* Counter */}
        <p className="text-xs text-muted-foreground">
          Showing {filteredTables.length} of {tables.length}
        </p>
      </div>

      {/* Table list — min-h-0 lets flex-1 shrink below content height so ScrollArea scrolls */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1">
          {filteredTables.map((table) => {
            const isActive = table.tableId === activeTableId;
            const isExcluded = getEffectiveExcluded(table);
            const hasPending = pendingUpdates.has(table.tableId);

            return (
              <div
                key={table.tableId}
                className={`
                  flex items-center gap-2 p-2 rounded-md cursor-pointer transition-colors
                  ${isActive ? 'bg-accent' : 'hover:bg-muted/50'}
                  ${isExcluded ? 'opacity-60' : ''}
                `}
                onClick={() => onScrollToTable(table.tableId)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">
                    {table.questionText || table.questionId}
                  </p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="font-mono text-[10px] text-muted-foreground">
                      {table.tableId}
                    </span>
                    {hasPending && (
                      <span className="h-1.5 w-1.5 rounded-full bg-tab-amber inline-block" />
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Regenerate button */}
                  {onOpenRegenerateDialog && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenRegenerateDialog(table.tableId);
                      }}
                      className={`p-1 rounded transition-colors ${
                        queuedTableIds?.has(table.tableId)
                          ? 'text-tab-indigo'
                          : 'text-muted-foreground/40 hover:text-tab-indigo'
                      }`}
                      aria-label="Regenerate table"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* Icon toggle: green Eye = included, red EyeOff = excluded */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleExclude(table.tableId, !isExcluded);
                    }}
                    className={`p-1 rounded transition-colors ${
                      isExcluded
                        ? 'text-tab-rose hover:text-tab-rose/80'
                        : 'text-tab-teal hover:text-tab-teal/80'
                    }`}
                    aria-label={isExcluded ? 'Include table' : 'Exclude table'}
                  >
                    {isExcluded ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Bottom action bar — shrink-0 keeps it always visible */}
      <div className="border-t p-3 space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {pendingCount > 0 && (
              <>
                <span className="h-2 w-2 rounded-full bg-tab-amber inline-block" />
                <span className="text-xs text-muted-foreground">
                  {pendingCount} pending {pendingCount === 1 ? 'change' : 'changes'}
                </span>
              </>
            )}
          </div>
          {regenerationQueueSize > 0 && onOpenRegenerationQueue && (
            <button
              onClick={onOpenRegenerationQueue}
              className="flex items-center gap-1.5 text-xs text-tab-indigo hover:text-tab-indigo/80 transition-colors"
            >
              <Sparkles className="h-3 w-3" />
              {regenerationQueueSize} queued
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1"
            onClick={onDiscard}
            disabled={pendingCount === 0 || isRebuilding}
          >
            <Undo2 className="h-3.5 w-3.5 mr-1" />
            Discard
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={onRebuild}
            disabled={pendingCount === 0 || isRebuilding}
          >
            {isRebuilding ? (
              <RefreshCw className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
            )}
            Rebuild Excel
          </Button>
        </div>
      </div>
    </div>
  );
}
