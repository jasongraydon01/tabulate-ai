/**
 * @deprecated Legacy Review Tables UI removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not import from active code.
 */
'use client';

import { useEffect, useRef, useCallback } from 'react';
import { TableCard } from './TableCard';
import type { TableData } from '@/lib/excel/ExcelFormatter';
import type { BannerGroup } from '@/lib/r/RScriptGeneratorV2';
import type { TableDisplayMode } from '@/lib/tableReview/displayMode';

interface TableFeedProps {
  tables: TableData[];
  bannerGroups: BannerGroup[];
  displayMode: TableDisplayMode;
  onActiveTableChange?: (tableId: string) => void;
  onInclude?: (tableId: string) => void;
  onExclude?: (tableId: string) => void;
  /** Phase 2: regeneration */
  queuedTableIds?: Set<string>;
  regeneratedTableIds?: Set<string>;
  onRegenerate?: (tableId: string) => void;
  onViewHistory?: (tableId: string) => void;
}

/**
 * Renders a scrollable feed of TableCards with IntersectionObserver
 * to track which table is currently visible (for sidebar sync).
 */
export function TableFeed({
  tables,
  bannerGroups,
  displayMode,
  onActiveTableChange,
  onInclude,
  onExclude,
  queuedTableIds,
  regeneratedTableIds,
  onRegenerate,
  onViewHistory,
}: TableFeedProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleTablesRef = useRef(new Set<string>());

  const handleVisibilityChange = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      for (const entry of entries) {
        const tableId = entry.target.id.replace('table-', '');
        if (entry.isIntersecting) {
          visibleTablesRef.current.add(tableId);
        } else {
          visibleTablesRef.current.delete(tableId);
        }
      }

      // Report the first visible table (topmost in the feed)
      if (onActiveTableChange && visibleTablesRef.current.size > 0) {
        // Find the topmost visible table by checking order in tables array
        for (const t of tables) {
          if (visibleTablesRef.current.has(t.tableId)) {
            onActiveTableChange(t.tableId);
            break;
          }
        }
      }
    },
    [tables, onActiveTableChange],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(handleVisibilityChange, {
      root: null,
      rootMargin: '-100px 0px -60% 0px',
      threshold: 0,
    });

    const cards = container.querySelectorAll('[id^="table-"]');
    cards.forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, [tables, handleVisibilityChange]);

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        No tables match the current filters.
      </div>
    );
  }

  return (
    <div ref={containerRef} className="space-y-6">
      {tables.map((table) => (
        <TableCard
          key={table.tableId}
          table={table}
          bannerGroups={bannerGroups}
          displayMode={displayMode}
          onInclude={onInclude}
          onExclude={onExclude}
          isQueued={queuedTableIds?.has(table.tableId)}
          hasRevisions={regeneratedTableIds?.has(table.tableId)}
          onRegenerate={onRegenerate}
          onViewHistory={onViewHistory}
        />
      ))}
    </div>
  );
}
