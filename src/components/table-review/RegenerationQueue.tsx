/**
 * @deprecated Legacy Review Tables UI removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not import from active code.
 */
'use client';

import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Sparkles,
  X,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export interface QueuedRegeneration {
  tableId: string;
  feedback: string;
  includeRelated: boolean;
  questionText?: string;
}

export interface RegenerationStatus {
  tableId: string;
  status: 'pending' | 'running' | 'success' | 'failed';
  changeSummary?: string;
  error?: string;
}

interface RegenerationQueueProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  queue: QueuedRegeneration[];
  onRemoveFromQueue: (tableId: string) => void;
  onClearQueue: () => void;
  onProcess: () => void;
  isProcessing: boolean;
  processingStatuses: RegenerationStatus[];
}

export function RegenerationQueue({
  open,
  onOpenChange,
  queue,
  onRemoveFromQueue,
  onClearQueue,
  onProcess,
  isProcessing,
  processingStatuses,
}: RegenerationQueueProps) {
  const hasResults = processingStatuses.length > 0;
  const successCount = processingStatuses.filter(
    (s) => s.status === 'success',
  ).length;
  const failedCount = processingStatuses.filter(
    (s) => s.status === 'failed',
  ).length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-[400px] sm:w-[450px] overflow-hidden">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-tab-indigo" />
            Regeneration Queue
          </SheetTitle>
          <SheetDescription>
            {isProcessing
              ? 'Processing regenerations...'
              : hasResults
                ? `${successCount} succeeded, ${failedCount} failed`
                : `${queue.length} ${queue.length === 1 ? 'table' : 'tables'} queued`}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          <ScrollArea className="mt-4 min-h-0 flex-1">
            <div className="space-y-3 pr-2">
              {/* Processing results */}
              {hasResults &&
                processingStatuses.map((status) => (
                  <div
                    key={`result-${status.tableId}`}
                    className="border rounded-md p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs">
                        {status.tableId}
                      </span>
                      <StatusIcon status={status.status} />
                    </div>
                    {status.changeSummary && (
                      <p className="text-xs text-muted-foreground">
                        {status.changeSummary}
                      </p>
                    )}
                    {status.error && (
                      <p className="text-xs text-tab-rose">{status.error}</p>
                    )}
                  </div>
                ))}

              {/* Queued items */}
              {!hasResults &&
                queue.map((item) => (
                  <div
                    key={item.tableId}
                    className="border rounded-md p-3 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-mono text-xs">{item.tableId}</p>
                        {item.questionText && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {item.questionText}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => onRemoveFromQueue(item.tableId)}
                        className="shrink-0 text-muted-foreground hover:text-foreground p-0.5"
                        disabled={isProcessing}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <p className="text-xs bg-muted px-2 py-1.5 rounded">
                      {item.feedback}
                    </p>
                    {item.includeRelated && (
                      <p className="text-[10px] text-tab-indigo">
                        + related tables
                      </p>
                    )}
                  </div>
                ))}

              {!hasResults && queue.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">
                  No tables queued for regeneration.
                </p>
              )}
            </div>
          </ScrollArea>

          {/* Actions */}
          <div className="mt-4 shrink-0 border-t pt-4 flex gap-2">
            {hasResults ? (
              <Button
                className="flex-1"
                variant="outline"
                onClick={() => {
                  onClearQueue();
                  onOpenChange(false);
                }}
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClearQueue}
                  disabled={queue.length === 0 || isProcessing}
                >
                  Clear
                </Button>
                <Button
                  className="flex-1"
                  size="sm"
                  onClick={onProcess}
                  disabled={queue.length === 0 || isProcessing}
                >
                  {isProcessing ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5 mr-1" />
                  )}
                  Process {queue.length}{' '}
                  {queue.length === 1 ? 'Regeneration' : 'Regenerations'}
                </Button>
              </>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case 'success':
      return <CheckCircle2 className="h-4 w-4 text-tab-teal" />;
    case 'failed':
      return <AlertCircle className="h-4 w-4 text-tab-rose" />;
    case 'running':
      return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
    default:
      return (
        <span className="h-2 w-2 rounded-full bg-muted-foreground inline-block" />
      );
  }
}
