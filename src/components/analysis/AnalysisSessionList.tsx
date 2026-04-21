"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface SessionListItem {
  _id: string;
  title: string;
  titleSource: "default" | "generated" | "manual";
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
  onRenameSession: (sessionId: string, title: string) => Promise<void>;
  onDeleteSession: (sessionId: string) => Promise<void>;
}

export function formatSessionTime(timestampMs: number, now = new Date()): string {
  const date = new Date(timestampMs);
  const startOfNow = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((startOfNow - startOfDate) / 86_400_000);

  if (diffDays === 0) {
    return `Today · ${date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  if (diffDays === 1) {
    return `Yesterday · ${date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    })}`;
  }

  if (diffDays >= 2 && diffDays <= 6) {
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
  });
}

export function AnalysisDeleteSessionDialogContent({
  sessionTitle,
  isPending,
  onCancel,
  onConfirm,
}: {
  sessionTitle: string;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Delete chat?</DialogTitle>
        <DialogDescription>
          Delete <span className="font-medium text-foreground">{sessionTitle}</span> and all of its
          messages and grounded analysis artifacts. This cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={onCancel}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          variant="destructive"
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Deleting...
            </>
          ) : (
            "Delete Chat"
          )}
        </Button>
      </DialogFooter>
    </>
  );
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
  onRenameSession,
  onDeleteSession,
}: AnalysisSessionListProps) {
  const [renameTarget, setRenameTarget] = useState<SessionListItem | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<SessionListItem | null>(null);
  const [pendingSessionAction, setPendingSessionAction] = useState<string | null>(null);

  useEffect(() => {
    if (!renameTarget) {
      setRenameTitle("");
      return;
    }

    setRenameTitle(renameTarget.title);
  }, [renameTarget]);

  async function handleRenameConfirm() {
    if (!renameTarget) return;
    setPendingSessionAction(renameTarget._id);
    try {
      await onRenameSession(renameTarget._id, renameTitle);
      setRenameTarget(null);
    } finally {
      setPendingSessionAction(null);
    }
  }

  async function handleDeleteConfirm() {
    if (!deleteTarget) return;
    setPendingSessionAction(deleteTarget._id);
    try {
      await onDeleteSession(deleteTarget._id);
      setDeleteTarget(null);
    } finally {
      setPendingSessionAction(null);
    }
  }

  if (!isOpen) {
    return (
      <div className="flex h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-border/60 py-3">
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
    <>
      <aside className="flex h-full w-[260px] shrink-0 flex-col overflow-hidden border-r border-border/60">
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
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-4 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading chats...
                </div>
                <p className="mt-2 leading-5">
                  TabulateAI is loading prior analysis sessions for this run.
                </p>
              </div>
            ) : sessions.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border/60 bg-muted/20 px-3 py-4">
                <p className="text-sm font-medium text-foreground">
                  No chats yet
                </p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Start a run-scoped chat to keep questions, grounded answers, and table evidence together.
                </p>
              </div>
            ) : (
              sessions.map((session) => {
                const isSelected = session._id === selectedSessionId;
                const isPending = pendingSessionAction === session._id;

                return (
                  <div
                    key={session._id}
                    className={cn(
                      "mb-1 flex items-start gap-1 rounded-xl border px-1.5 py-1 transition-colors",
                      isSelected
                        ? "border-primary/20 bg-primary/8 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                        : "border-transparent hover:border-border/60 hover:bg-muted/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(session._id)}
                      className="min-w-0 flex-1 rounded-md px-1 py-1 text-left"
                    >
                      <div className="flex min-w-0 flex-col items-start gap-1">
                        <p className="w-full break-words text-sm font-medium leading-snug whitespace-normal text-foreground">
                          {session.title}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
                          {formatSessionTime(session.lastMessageAt)}
                        </p>
                      </div>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="xs"
                          className="mt-0.5 h-7 w-7 p-0 text-muted-foreground"
                          disabled={isPending}
                        >
                          {isPending ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <MoreHorizontal className="h-4 w-4" />
                          )}
                          <span className="sr-only">Session actions</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setRenameTarget(session)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Rename
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => setDeleteTarget(session)}
                          className="text-destructive focus:text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                );
              })
            )}
          </div>
        </ScrollArea>
      </aside>

      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open && pendingSessionAction === null) {
            setRenameTarget(null);
          }
        }}
      >
        <DialogContent showCloseButton={pendingSessionAction === null}>
          <DialogHeader>
            <DialogTitle>Rename Chat</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Input
              value={renameTitle}
              onChange={(event) => setRenameTitle(event.target.value)}
              placeholder="Chat title"
              maxLength={120}
              disabled={pendingSessionAction !== null}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRenameTarget(null)}
              disabled={pendingSessionAction !== null}
            >
              Cancel
            </Button>
            <Button
              onClick={() => { void handleRenameConfirm(); }}
              disabled={renameTitle.trim().length === 0 || pendingSessionAction !== null}
            >
              {pendingSessionAction !== null ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                "Save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && pendingSessionAction === null) {
            setDeleteTarget(null);
          }
        }}
      >
        <DialogContent showCloseButton={pendingSessionAction === null}>
          <AnalysisDeleteSessionDialogContent
            sessionTitle={deleteTarget?.title ?? "this chat"}
            isPending={pendingSessionAction !== null}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => { void handleDeleteConfirm(); }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
