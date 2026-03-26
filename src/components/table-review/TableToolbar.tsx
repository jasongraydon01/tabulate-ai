/**
 * @deprecated Legacy Review Tables UI removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not import from active code.
 */
'use client';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Info } from 'lucide-react';
import type { TableDisplayMode } from '@/lib/tableReview/displayMode';

interface TableToolbarProps {
  activeVariant: string;
  availableVariants: string[];
  onVariantChange: (variant: string) => void;
  hasMultipleVariants: boolean;
  activeDisplayMode: TableDisplayMode;
  availableDisplayModes: TableDisplayMode[];
  onDisplayModeChange: (mode: TableDisplayMode) => void;
}

export function TableToolbar({
  activeVariant,
  availableVariants,
  onVariantChange,
  hasMultipleVariants,
  activeDisplayMode,
  availableDisplayModes,
  onDisplayModeChange,
}: TableToolbarProps) {
  const showVariantSwitcher = hasMultipleVariants;
  const showDisplaySwitcher = availableDisplayModes.length > 1;

  if (!showVariantSwitcher && !showDisplaySwitcher) {
    return (
      <div className="flex items-center gap-2">
        <Badge variant="outline" className="text-xs">
          Showing: {activeDisplayMode === 'counts' ? 'Counts' : 'Percentages'}
        </Badge>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {showVariantSwitcher && (
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          {availableVariants.map((variant) => (
            <Button
              key={variant}
              variant={activeVariant === variant ? 'default' : 'ghost'}
              size="xs"
              onClick={() => onVariantChange(variant)}
            >
              {variant === 'default'
                ? 'Default'
                : variant === 'weighted'
                  ? 'Weighted'
                  : 'Unweighted'}
            </Button>
          ))}
        </div>
      )}
      {showDisplaySwitcher ? (
        <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
          {availableDisplayModes.map((mode) => (
            <Button
              key={mode}
              variant={activeDisplayMode === mode ? 'default' : 'ghost'}
              size="xs"
              onClick={() => onDisplayModeChange(mode)}
            >
              {mode === 'counts' ? 'Counts' : 'Percentages'}
            </Button>
          ))}
        </div>
      ) : (
        <Badge variant="outline" className="text-xs">
          Showing: {activeDisplayMode === 'counts' ? 'Counts' : 'Percentages'}
        </Badge>
      )}
      {showVariantSwitcher && (
        <Badge variant="outline" className="text-xs gap-1">
          <Info className="h-3 w-3" />
          Changes apply to all variants
        </Badge>
      )}
    </div>
  );
}
