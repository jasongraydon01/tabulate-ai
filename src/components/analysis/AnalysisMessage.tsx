"use client";

import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import { toast } from "sonner";
import {
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { Check, ChevronDown, Copy, Link2, Pencil, ThumbsDown, ThumbsUp } from "lucide-react";

import { GroundedTableCard } from "@/components/analysis/GroundedTableCard";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  getAnalysisMessageFollowUpSuggestions,
  getAnalysisMessageMetadata,
  getAnalysisUIMessageText,
} from "@/lib/analysis/messages";
import { buildAnalysisRenderableBlocks } from "@/lib/analysis/renderAnchors";
import { getAnalysisToolActivityLabel } from "@/lib/analysis/toolLabels";
import {
  isAnalysisTableCard,
  type AnalysisEvidenceItem,
  type AnalysisMessageFeedbackRecord,
  type AnalysisMessageFeedbackVote,
} from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

/**
 * Coalesces rapid value updates to one per animation frame while `enabled` is
 * true, and flushes the latest value immediately when `enabled` flips to false.
 * Used to smooth streaming markdown rendering without dropping the final text.
 */
function useAnimationFrameThrottle<T>(value: T, enabled: boolean): T {
  const [throttledValue, setThrottledValue] = useState(value);
  const latestValueRef = useRef(value);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    latestValueRef.current = value;

    if (!enabled) {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      setThrottledValue(value);
      return;
    }

    if (frameRef.current !== null) return;

    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setThrottledValue(latestValueRef.current);
    });
  }, [value, enabled]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        cancelAnimationFrame(frameRef.current);
      }
    };
  }, []);

  return throttledValue;
}

function StreamingMarkdown({ text, isStreaming }: { text: string; isStreaming: boolean }) {
  const throttledText = useAnimationFrameThrottle(text, isStreaming);
  return <Streamdown>{throttledText}</Streamdown>;
}

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

function truncateReasoning(text: string, maxLength = 120): string {
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength).trim()}...`;
}

type TraceEntry =
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; label: string; state: string };

export function getAnalysisTraceEntries(message: UIMessage): TraceEntry[] {
  if (message.role === "user") {
    return [];
  }

  return message.parts.flatMap((part, index): TraceEntry[] => {
    if (isReasoningUIPart(part)) {
      const text = part.text.trim();
      if (!text) return [];

      return [{
        kind: "reasoning",
        id: `${message.id}-reasoning-${index}`,
        text,
      }];
    }
    if (isToolUIPart(part) && part.type !== "tool-getTableCard") {
      const label = getAnalysisToolActivityLabel(part.type);
      if (!label) return [];
      return [{
        kind: "tool",
        id: part.toolCallId,
        label,
        state: part.state,
      }];
    }
    return [];
  });
}

export function getAnalysisTraceHeaderLabel(
  traceEntries: TraceEntry[],
  collapsedSummary: string | null,
  isExpanded: boolean,
): string {
  const hasReasoningSummary = traceEntries.some((entry) => entry.kind === "reasoning");
  if (hasReasoningSummary) {
    return isExpanded ? "Reasoning" : (collapsedSummary ?? "Reasoning");
  }

  return isExpanded ? "Analysis steps" : (collapsedSummary ?? "Analysis steps");
}

export function getAnalysisMessageEvidenceItems(message: UIMessage): AnalysisEvidenceItem[] {
  return getAnalysisMessageMetadata(message)?.evidence ?? [];
}

export function getAnalysisMessageFollowUpItems(message: UIMessage): string[] {
  return getAnalysisMessageFollowUpSuggestions(message);
}

function getAnalysisEvidenceAnchorId(anchorId: string): string {
  return `analysis-evidence-${anchorId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

function scrollToEvidenceAnchor(anchorId: string) {
  const target = document.getElementById(getAnalysisEvidenceAnchorId(anchorId));
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  window.setTimeout(() => {
    target.classList.remove("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  }, 1200);
}

export function AnalysisMessage({
  message,
  isStreaming = false,
  onSelectFollowUpSuggestion,
  feedback = null,
  onSubmitFeedback,
  onEditUserMessage,
}: {
  message: UIMessage;
  isStreaming?: boolean;
  // Only passed when the thread is idle AND this is the tail assistant
  // message — so this prop doubles as the "show chips" signal.
  onSelectFollowUpSuggestion?: (suggestion: string) => void | Promise<void>;
  feedback?: AnalysisMessageFeedbackRecord | null;
  onSubmitFeedback?: (input: {
    messageId: string;
    vote: AnalysisMessageFeedbackVote;
    correctionText?: string | null;
  }) => Promise<void>;
  // Passed on persisted user messages when editing is available. Called with
  // the new text — the thread owns the stop / truncate / resend choreography
  // so this can be invoked at any time, including during streaming.
  onEditUserMessage?: (input: { messageId: string; text: string }) => Promise<void>;
}) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const isUser = message.role === "user";
  const hasGroundedTableCard = !isUser && message.parts.some(
    (part) => isToolUIPart(part) && part.type === "tool-getTableCard",
  );
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);
  const [draftCorrectionText, setDraftCorrectionText] = useState(feedback?.correctionText ?? "");
  const [optimisticFeedback, setOptimisticFeedback] = useState<AnalysisMessageFeedbackRecord | null>(feedback ?? null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draftEditText, setDraftEditText] = useState("");
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const traceEntries = getAnalysisTraceEntries(message);
  const evidenceItems = getAnalysisMessageEvidenceItems(message);
  const followUpSuggestions = getAnalysisMessageFollowUpItems(message);
  const effectiveFeedback = optimisticFeedback ?? feedback ?? null;
  const isDownvoteOpen = effectiveFeedback?.vote === "down";
  const renderableBlocks = buildAnalysisRenderableBlocks(message, { isStreaming });

  const hasTrace = traceEntries.length > 0;

  useEffect(() => {
    setOptimisticFeedback(feedback ?? null);
    setDraftCorrectionText(feedback?.correctionText ?? "");
  }, [feedback]);

  function openEditor() {
    if (!onEditUserMessage) return;
    setDraftEditText(getAnalysisUIMessageText(message));
    setIsEditing(true);
  }

  function cancelEdit() {
    setIsEditing(false);
    setDraftEditText("");
  }

  async function saveEdit() {
    if (!onEditUserMessage) return;
    const nextText = draftEditText.trim();
    const currentText = getAnalysisUIMessageText(message);
    if (!nextText || nextText === currentText) {
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

  const collapsedSummary = (() => {
    if (!hasTrace) return null;
    for (let index = traceEntries.length - 1; index >= 0; index -= 1) {
      const entry = traceEntries[index];
      if (entry.kind === "reasoning" && entry.text.trim().length > 0) {
        return truncateReasoning(entry.text);
      }
    }
    for (let index = traceEntries.length - 1; index >= 0; index -= 1) {
      const entry = traceEntries[index];
      if (entry.kind === "tool") {
        const inProgress = isStreaming && entry.state !== "output-available";
        return `${entry.label}${inProgress ? "..." : ""}`;
      }
    }
    return null;
  })();

  async function submitFeedback(vote: AnalysisMessageFeedbackVote, correctionText?: string | null) {
    if (!onSubmitFeedback || isSubmittingFeedback) return;

    const trimmedCorrectionText = correctionText?.trim() || null;
    const nextFeedback: AnalysisMessageFeedbackRecord = {
      messageId: message.id,
      vote,
      correctionText: vote === "down" ? trimmedCorrectionText : null,
      updatedAt: Date.now(),
    };

    const previousFeedback = effectiveFeedback;
    setOptimisticFeedback(nextFeedback);
    setIsSubmittingFeedback(true);

    try {
      await onSubmitFeedback({
        messageId: message.id,
        vote,
        correctionText: vote === "down" ? trimmedCorrectionText : null,
      });
    } catch (_error) {
      setOptimisticFeedback(previousFeedback ?? null);
    } finally {
      setIsSubmittingFeedback(false);
    }
  }

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0",
          hasGroundedTableCard ? "w-full max-w-full" : "max-w-[88%]",
        )}
      >
        {isUser ? (
          isEditing ? (
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
          ) : (
            <div className="flex flex-col items-end gap-0.5">
              <p className="min-w-0 whitespace-pre-wrap break-words rounded-2xl bg-primary/10 px-4 py-2 text-sm leading-6 [overflow-wrap:anywhere]">
                {message.parts.filter(isTextUIPart).map((part) => part.text).join("")}
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
                  text={getAnalysisUIMessageText(message)}
                  label="Copy message"
                />
              </div>
            </div>
          )
        ) : (
          <div className="min-w-0 space-y-3">
            {hasTrace ? (
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => setIsThinkingExpanded((open) => !open)}
                  className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground/70"
                >
                  <ChevronDown
                    className={cn(
                      "h-3 w-3 transition-transform",
                      !isThinkingExpanded && "-rotate-90",
                    )}
                  />
                  <span className="italic">
                    {getAnalysisTraceHeaderLabel(traceEntries, collapsedSummary, isThinkingExpanded)}
                  </span>
                </button>

                {isThinkingExpanded ? (
                  <div className="ml-4.5 space-y-2 border-l border-border/40 pl-3 text-xs leading-relaxed text-muted-foreground">
                    {traceEntries.map((entry) => {
                      if (entry.kind === "reasoning") {
                        return (
                          <div
                            key={entry.id}
                            className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                          >
                            {entry.text}
                          </div>
                        );
                      }

                      const inProgress = isStreaming && entry.state !== "output-available";
                      return (
                        <div
                          key={entry.id}
                          className="flex items-center gap-2"
                        >
                          <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                          <span>
                            {entry.label}
                            {inProgress ? "..." : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}

            {renderableBlocks.map((block) => {
              if (block.kind === "text") {
                return (
                  <div
                    key={block.key}
                    className="prose-analysis min-w-0 max-w-none break-words [overflow-wrap:anywhere]"
                  >
                    <StreamingMarkdown text={block.text} isStreaming={isStreaming} />
                  </div>
                );
              }

              if (block.kind === "placeholder") {
                return (
                  <div
                    key={block.key}
                    className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                  >
                    Loading table...
                  </div>
                );
              }

              if (block.kind === "table" && block.part.state === "output-available" && isAnalysisTableCard(block.part.output)) {
                return (
                  <div
                    key={block.key}
                    id={getAnalysisEvidenceAnchorId(block.part.toolCallId)}
                    className="scroll-mt-24 rounded-xl transition-shadow duration-300"
                  >
                    <GroundedTableCard
                      card={block.part.output}
                    />
                  </div>
                );
              }

              return (
                <div
                  key={block.key}
                  className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                >
                  Loading table...
                </div>
              );
            })}

            {!isStreaming && getAnalysisUIMessageText(message).length > 0 ? (
              <div className="-mt-2 flex justify-start">
                <CopyMessageButton
                  text={getAnalysisUIMessageText(message)}
                  label="Copy response"
                />
              </div>
            ) : null}

            {evidenceItems.length > 0 ? (
              <Collapsible open={isEvidenceOpen} onOpenChange={setIsEvidenceOpen}>
                <div className="pt-1">
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground/70"
                    >
                      <ChevronDown
                        className={cn("h-3 w-3 transition-transform", isEvidenceOpen && "rotate-180")}
                      />
                      <span>Evidence ({evidenceItems.length})</span>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2">
                    <div className="rounded-xl border border-border/60 bg-muted/15 px-3 py-2">
                      <div className="space-y-1.5">
                        {evidenceItems.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            onClick={() => item.anchorId ? scrollToEvidenceAnchor(item.anchorId) : undefined}
                            className={cn(
                              "flex w-full items-center gap-2 text-left text-[11px] leading-5 text-muted-foreground",
                              item.anchorId ? "hover:text-foreground/80" : "cursor-default",
                            )}
                          >
                            <Link2 className="h-3 w-3 shrink-0" />
                            <span className="truncate">{item.label}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ) : null}

            {message.role === "assistant" && !isStreaming && onSubmitFeedback ? (
              <div className="space-y-3 pt-1">
                <div className="flex justify-center">
                  <div className="flex items-center gap-2 rounded-full border border-border/70 bg-background/90 px-2 py-1 shadow-[0_8px_24px_rgba(15,23,42,0.14)]">
                    <button
                      type="button"
                      disabled={isSubmittingFeedback}
                      onClick={() => {
                        void submitFeedback("up");
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors",
                        effectiveFeedback?.vote === "up"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/80",
                      )}
                    >
                      <ThumbsUp className="h-3 w-3" />
                      <span>Helpful</span>
                    </button>
                    <button
                      type="button"
                      disabled={isSubmittingFeedback}
                      onClick={() => {
                        void submitFeedback("down", draftCorrectionText);
                      }}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] transition-colors",
                        effectiveFeedback?.vote === "down"
                          ? "bg-amber-500/10 text-amber-700 dark:text-amber-300"
                          : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/80",
                      )}
                    >
                      <ThumbsDown className="h-3 w-3" />
                      <span>Needs work</span>
                    </button>
                  </div>
                </div>

                {isDownvoteOpen ? (
                  <div className="mx-auto max-w-xl space-y-2 rounded-2xl border border-border/60 bg-background/90 p-3 shadow-[0_14px_36px_rgba(15,23,42,0.12)]">
                    <p className="text-[11px] leading-5 text-muted-foreground">
                      Optional: what should TabulateAI have said instead?
                    </p>
                    <Textarea
                      value={draftCorrectionText}
                      onChange={(event) => setDraftCorrectionText(event.target.value)}
                      disabled={isSubmittingFeedback}
                      className="min-h-20 resize-y text-sm"
                      placeholder="Add a correction or a better framing."
                      maxLength={1000}
                    />
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-muted-foreground">
                        {draftCorrectionText.trim().length}/1000
                      </span>
                      <button
                        type="button"
                        disabled={isSubmittingFeedback}
                        onClick={() => {
                          void submitFeedback("down", draftCorrectionText);
                        }}
                        className="rounded-full border border-border/70 px-3 py-1 text-[11px] text-foreground/85 transition-colors hover:border-foreground/20 hover:bg-muted/25 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        Save feedback
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}

            {followUpSuggestions.length > 0 && onSelectFollowUpSuggestion ? (
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {followUpSuggestions.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      void onSelectFollowUpSuggestion(suggestion);
                    }}
                    className="rounded-full border border-border/70 bg-background/90 px-3 py-1.5 text-xs text-foreground/85 shadow-[0_8px_24px_rgba(15,23,42,0.12)] transition-colors hover:border-foreground/20 hover:bg-muted/20"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
