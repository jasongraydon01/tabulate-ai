/**
 * @deprecated Legacy Review Tables UI removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not import from active code.
 */
'use client';

import { useState, useEffect } from 'react';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, CheckCircle2, AlertCircle, Clock } from 'lucide-react';

interface Revision {
  _id: string;
  tableId: string;
  feedback: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  startedAt?: number;
  completedAt?: number;
  changeSummary?: string;
  error?: string;
  requestedBy: string;
}

interface RevisionHistoryProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string;
  tableId: string;
  questionText?: string;
}

export function RevisionHistory({
  open,
  onOpenChange,
  runId,
  tableId,
  questionText,
}: RevisionHistoryProps) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    const fetchRevisions = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/runs/${encodeURIComponent(runId)}/tables/${encodeURIComponent(tableId)}/revisions`,
        );
        if (!res.ok) {
          throw new Error(`Failed to fetch revisions (${res.status})`);
        }
        const data = await res.json();
        setRevisions(data.revisions ?? []);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load revisions');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRevisions();
  }, [open, runId, tableId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[450px]">
        <SheetHeader>
          <SheetTitle>Revision History</SheetTitle>
          <SheetDescription>
            <span className="font-mono text-xs">{tableId}</span>
            {questionText && (
              <span className="block text-xs truncate mt-0.5">
                {questionText}
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <ScrollArea className="flex-1 mt-4">
          {isLoading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <p className="text-sm text-tab-rose text-center py-8">{error}</p>
          )}

          {!isLoading && !error && revisions.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-8">
              No regeneration history for this table.
            </p>
          )}

          <div className="space-y-3 pr-2">
            {revisions.map((rev) => (
              <div
                key={rev._id}
                className="border rounded-md p-3 space-y-2"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RevisionStatusIcon status={rev.status} />
                    <span className="text-xs font-medium capitalize">
                      {rev.status}
                    </span>
                  </div>
                  {rev.startedAt && (
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {formatRelativeTime(rev.startedAt)}
                    </span>
                  )}
                </div>

                {/* Feedback */}
                <div className="text-xs bg-muted px-2 py-1.5 rounded">
                  <p className="text-[10px] text-muted-foreground mb-0.5">
                    Feedback:
                  </p>
                  <p>{rev.feedback}</p>
                </div>

                {/* Change summary */}
                {rev.changeSummary && (
                  <p className="text-xs text-muted-foreground">
                    {rev.changeSummary}
                  </p>
                )}

                {/* Error */}
                {rev.error && (
                  <p className="text-xs text-tab-rose">{rev.error}</p>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}

function RevisionStatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-3.5 w-3.5 text-tab-teal" />;
    case 'failed':
      return <AlertCircle className="h-3.5 w-3.5 text-tab-rose" />;
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />;
    default:
      return (
        <span className="h-2 w-2 rounded-full bg-muted-foreground inline-block" />
      );
  }
}

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
