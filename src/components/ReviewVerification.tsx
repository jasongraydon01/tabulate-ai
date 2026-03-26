'use client';

import { useState } from 'react';
import { ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ReviewDiffSummary } from '@/lib/api/types';

interface ReviewVerificationProps {
  reviewDiff: ReviewDiffSummary;
}

export function ReviewVerification({ reviewDiff }: ReviewVerificationProps) {
  const [expanded, setExpanded] = useState(false);

  const summaryParts: string[] = [];
  if (reviewDiff.approved > 0) {
    summaryParts.push(`${reviewDiff.approved} approved`);
  }
  if (reviewDiff.hinted > 0) {
    const changedNote = reviewDiff.expressionsChanged > 0
      ? ` (${reviewDiff.expressionsChanged} changed)`
      : '';
    summaryParts.push(`${reviewDiff.hinted} hinted${changedNote}`);
  }
  if (reviewDiff.alternativesSelected > 0) {
    summaryParts.push(`${reviewDiff.alternativesSelected} alternatives`);
  }
  if (reviewDiff.edited > 0) {
    summaryParts.push(`${reviewDiff.edited} edited`);
  }
  if (reviewDiff.skipped > 0) {
    summaryParts.push(`${reviewDiff.skipped} skipped`);
  }

  return (
    <div className="mt-2 space-y-1">
      <p className="text-xs text-muted-foreground">
        {reviewDiff.totalColumns} banner column{reviewDiff.totalColumns !== 1 ? 's' : ''} reviewed
      </p>
      <div className="text-xs text-muted-foreground space-y-0.5 ml-2">
        {summaryParts.map((part, i) => (
          <div key={i} className="flex items-start gap-1.5">
            <span className={cn(
              'mt-0.5',
              i === summaryParts.length - 1 ? 'text-muted-foreground/60' : ''
            )}>
              {i < summaryParts.length - 1 ? '\u251C\u2500' : '\u2514\u2500'}
            </span>
            <span>{part}</span>
          </div>
        ))}
      </div>
      {reviewDiff.errors > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-tab-amber mt-1 ml-2">
          <AlertTriangle className="h-3 w-3" />
          <span>{reviewDiff.errors} hint{reviewDiff.errors !== 1 ? 's' : ''} could not be applied</span>
        </div>
      )}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" />
        ) : (
          <ChevronRight className="h-3 w-3" />
        )}
        {expanded ? 'Hide details' : 'View details'}
      </button>
      {expanded && (
        <div className="text-xs text-muted-foreground mt-1 ml-2 p-2 bg-muted/50 rounded space-y-1">
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span>Approved as-is:</span>
            <span className="font-mono">{reviewDiff.approved}</span>
            <span>Re-processed with hints:</span>
            <span className="font-mono">{reviewDiff.hinted}</span>
            <span>Alternatives selected:</span>
            <span className="font-mono">{reviewDiff.alternativesSelected}</span>
            <span>User-edited:</span>
            <span className="font-mono">{reviewDiff.edited}</span>
            <span>Skipped:</span>
            <span className="font-mono">{reviewDiff.skipped}</span>
            <span className="border-t border-border pt-1 mt-1">Expressions changed:</span>
            <span className="font-mono border-t border-border pt-1 mt-1">{reviewDiff.expressionsChanged}</span>
            <span>Expressions unchanged:</span>
            <span className="font-mono">{reviewDiff.expressionsUnchanged}</span>
            {reviewDiff.errors > 0 && (
              <>
                <span className="text-tab-amber">Errors / fallbacks:</span>
                <span className="font-mono text-tab-amber">{reviewDiff.errors}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
