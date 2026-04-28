"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Pencil } from "lucide-react";

import { Textarea } from "@/components/ui/textarea";
import { getAnalysisUIMessageText } from "@/lib/analysis/messages";
import type { AnalysisUIMessage } from "@/lib/analysis/ui";

function CopyMessageButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimerRef.current !== null) {
      window.clearTimeout(resetTimerRef.current);
    }
  }, []);

  async function handleCopy() {
    const payload = text.trim();
    if (!payload) return;

    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      toast.success("Copied to clipboard");
      if (resetTimerRef.current !== null) {
        window.clearTimeout(resetTimerRef.current);
      }
      resetTimerRef.current = window.setTimeout(() => {
        setCopied(false);
        resetTimerRef.current = null;
      }, 1500);
    } catch {
      toast.error("Copy failed");
    }
  }

  return (
    <button
      type="button"
      onClick={() => { void handleCopy(); }}
      aria-label={label}
      title={label}
      className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/80"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

export function AnalysisUserMessage({
  message,
  onEditUserMessage,
}: {
  message: AnalysisUIMessage;
  onEditUserMessage?: (input: { messageId: string; text: string }) => Promise<void>;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draftEditText, setDraftEditText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const messageText = getAnalysisUIMessageText(message);

  function openEditor() {
    if (!onEditUserMessage) return;
    setDraftEditText(messageText);
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setDraftEditText("");
  }

  async function saveEdit() {
    if (!onEditUserMessage) return;
    const nextText = draftEditText.trim();
    if (!nextText || nextText === messageText) {
      cancelEdit();
      return;
    }

    setIsSavingEdit(true);
    try {
      await onEditUserMessage({ messageId: message.id, text: nextText });
      setIsEditing(false);
      setDraftEditText("");
    } catch (_error) {
      // Parent surfaces the error toast; keep the editor open so the user can retry.
    } finally {
      setIsSavingEdit(false);
    }
  }

  if (isEditing) {
    return (
      <div className="flex w-full flex-col items-stretch gap-2">
        <Textarea
          value={draftEditText}
          onChange={(event) => setDraftEditText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              cancelEdit();
              return;
            }
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void saveEdit();
            }
          }}
          autoFocus
          disabled={isSavingEdit}
          className="min-h-24 resize-y rounded-2xl bg-primary/10 px-4 py-2 text-sm leading-6"
          placeholder="Edit your message"
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={cancelEdit}
            disabled={isSavingEdit}
            className="rounded-full border border-border/70 px-3 py-1 text-[11px] text-muted-foreground transition-colors hover:border-foreground/20 hover:bg-muted/25 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void saveEdit(); }}
            disabled={isSavingEdit || draftEditText.trim().length === 0}
            className="rounded-full bg-primary px-3 py-1 text-[11px] text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSavingEdit ? "Saving..." : "Save & resend"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <p className="min-w-0 whitespace-pre-wrap break-words rounded-2xl bg-primary/10 px-4 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
        {messageText}
      </p>
      <div className="flex items-center gap-0.5">
        {onEditUserMessage ? (
          <button
            type="button"
            onClick={openEditor}
            aria-label="Edit message"
            title="Edit message"
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/80"
          >
            <Pencil className="h-3 w-3" />
          </button>
        ) : null}
        <CopyMessageButton
          text={messageText}
          label="Copy message"
        />
      </div>
    </div>
  );
}
