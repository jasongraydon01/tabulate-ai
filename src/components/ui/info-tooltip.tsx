'use client';

import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface InfoTooltipProps {
  text: string;
  className?: string;
}

/**
 * Small "i" icon that shows a tooltip on hover.
 * Used to move helper descriptions out of the main UI flow.
 */
export function InfoTooltip({ text, className }: InfoTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info
            className={cn(
              'inline h-3.5 w-3.5 text-muted-foreground/60 hover:text-muted-foreground cursor-help shrink-0',
              className,
            )}
          />
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
