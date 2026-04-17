"use client";

import { Loader2, MessageSquarePlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

interface SessionListItem {
  _id: string;
  title: string;
  status: "active" | "archived";
  createdAt: number;
  lastMessageAt: number;
}

interface AnalysisSessionListProps {
  sessions: SessionListItem[];
  selectedSessionId: string | null;
  isLoading: boolean;
  isCreating: boolean;
  onCreateSession: () => Promise<void>;
  onSelectSession: (sessionId: string) => void;
}

function formatSessionTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function AnalysisSessionList({
  sessions,
  selectedSessionId,
  isLoading,
  isCreating,
  onCreateSession,
  onSelectSession,
}: AnalysisSessionListProps) {
  return (
    <aside className="rounded-2xl border border-border/80 bg-card/80 backdrop-blur">
      <div className="border-b border-border/80 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium">Sessions</p>
            <p className="text-xs text-muted-foreground">
              Durable run-scoped threads for this analysis workspace.
            </p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void onCreateSession();
            }}
            disabled={isCreating}
          >
            {isCreating ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <MessageSquarePlus className="mr-2 h-4 w-4" />
            )}
            New Session
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[420px]">
        <div className="p-2">
          {isLoading ? (
            <div className="flex items-center gap-2 rounded-xl border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading analysis sessions...
            </div>
          ) : sessions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border/80 px-3 py-4 text-sm text-muted-foreground">
              No sessions yet. Create the first session for this run.
            </div>
          ) : (
            sessions.map((session) => {
              const isSelected = session._id === selectedSessionId;
              return (
                <button
                  key={session._id}
                  type="button"
                  onClick={() => onSelectSession(session._id)}
                  className={cn(
                    "mb-2 w-full rounded-xl border px-3 py-3 text-left transition-colors",
                    isSelected
                      ? "border-primary/40 bg-primary/8"
                      : "border-transparent bg-muted/35 hover:border-border hover:bg-muted/55",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{session.title}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Updated {formatSessionTime(session.lastMessageAt)}
                      </p>
                    </div>
                    <span className="rounded-full border border-border/80 px-2 py-0.5 text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                      {session.status}
                    </span>
                  </div>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
