"use client";

import { Loader2, MessageSquarePlus, PanelLeftClose, PanelLeftOpen } from "lucide-react";

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
  isOpen: boolean;
  onToggle: () => void;
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
  isOpen,
  onToggle,
  onCreateSession,
  onSelectSession,
}: AnalysisSessionListProps) {
  if (!isOpen) {
    return (
      <div className="flex w-12 shrink-0 flex-col items-center gap-2 border-r border-border/60 py-3">
        <Button
          variant="ghost"
          size="xs"
          className="h-8 w-8 p-0"
          onClick={onToggle}
        >
          <PanelLeftOpen className="h-4 w-4" />
          <span className="sr-only">Open chat list</span>
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="h-8 w-8 p-0"
          onClick={() => { void onCreateSession(); }}
          disabled={isCreating}
        >
          {isCreating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquarePlus className="h-4 w-4" />
          )}
          <span className="sr-only">New chat</span>
        </Button>
      </div>
    );
  }

  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-border/60">
      <div className="flex items-center justify-between gap-2 px-3 py-2.5">
        <Button
          variant="ghost"
          size="xs"
          className="h-7 w-7 p-0"
          onClick={onToggle}
        >
          <PanelLeftClose className="h-4 w-4" />
          <span className="sr-only">Close chat list</span>
        </Button>
        <Button
          size="sm"
          className="h-7 gap-1.5 px-2.5 text-xs"
          onClick={() => { void onCreateSession(); }}
          disabled={isCreating}
        >
          {isCreating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <MessageSquarePlus className="h-3.5 w-3.5" />
          )}
          New Chat
        </Button>
      </div>

      <ScrollArea className="flex-1">
        <div className="px-2 pb-2">
          {isLoading ? (
            <div className="flex items-center gap-2 px-2 py-4 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Loading chats...
            </div>
          ) : sessions.length === 0 ? (
            <p className="px-2 py-4 text-xs text-muted-foreground">
              No chats yet. Start one to explore your data.
            </p>
          ) : (
            sessions.map((session) => {
              const isSelected = session._id === selectedSessionId;
              return (
                <button
                  key={session._id}
                  type="button"
                  onClick={() => onSelectSession(session._id)}
                  className={cn(
                    "mb-1 w-full rounded-lg px-2.5 py-2 text-left transition-colors",
                    isSelected
                      ? "bg-primary/8"
                      : "hover:bg-muted/50",
                  )}
                >
                  <p className="truncate text-sm font-medium">{session.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {formatSessionTime(session.lastMessageAt)}
                  </p>
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </aside>
  );
}
