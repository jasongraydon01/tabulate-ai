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

function formatSessionTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
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
                const isPending = pendingSessionAction === session._id;

                return (
                  <div
                    key={session._id}
                    className={cn(
                      "mb-1 flex items-start gap-1 rounded-lg px-1.5 py-1 transition-colors",
                      isSelected ? "bg-primary/8" : "hover:bg-muted/50",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectSession(session._id)}
                      className="min-w-0 flex-1 rounded-md px-1 py-1 text-left"
                    >
                      <p className="truncate text-sm font-medium">{session.title}</p>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {formatSessionTime(session.lastMessageAt)}
                      </p>
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
