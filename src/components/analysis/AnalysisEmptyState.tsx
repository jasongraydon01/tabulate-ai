import { Loader2, MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";

interface AnalysisEmptyStateProps {
  onCreateSession: () => Promise<void>;
  isCreating: boolean;
}

export function AnalysisEmptyState({
  onCreateSession,
  isCreating,
}: AnalysisEmptyStateProps) {
  return (
    <div className="relative flex min-h-[calc(100vh-12rem)] flex-1 flex-col overflow-hidden rounded-[2rem] bg-[radial-gradient(circle_at_top,_rgba(96,165,250,0.08),_transparent_34%),linear-gradient(180deg,_rgba(255,255,255,0.92),_rgba(255,255,255,0.98))] px-6 py-6 dark:bg-[radial-gradient(circle_at_top,_rgba(96,165,250,0.10),_transparent_30%),linear-gradient(180deg,_rgba(10,10,10,0.88),_rgba(10,10,10,0.98))] sm:px-8 sm:py-8">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-border/60 to-transparent" />

      <div className="flex flex-1 items-center justify-center">
        <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
          <div className="space-y-4">
            <h1 className="font-serif text-4xl tracking-tight text-foreground sm:text-5xl">
              Start an analysis session for this run
            </h1>
            <p className="mx-auto max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
              TabulateAI keeps each chat tied to this run, so your questions and grounded answers stay attached to the same set of tabs.
            </p>
          </div>

          <Button
            size="lg"
            className="mt-8 h-11 rounded-full px-5 text-sm font-medium"
            onClick={() => { void onCreateSession(); }}
            disabled={isCreating}
          >
            {isCreating ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Starting chat
              </>
            ) : (
              <>
                <MessageSquarePlus className="mr-2 h-4 w-4" />
                New Chat
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
