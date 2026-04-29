"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, Check, Copy, Link2, ThumbsDown, ThumbsUp, X } from "lucide-react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import {
  getAnalysisCellAnchorId,
  getAnalysisEvidenceAnchorId,
} from "@/lib/analysis/anchors";
import { getSettledAnalysisEvidenceItemCellId } from "@/lib/analysis/settledAnswer";
import type {
  AnalysisEvidenceItem,
  AnalysisMessageFeedbackRecord,
  AnalysisMessageFeedbackVote,
} from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

const MAX_FOOTER_SUGGESTIONS = 3;

export function getAnalysisFooterSuggestions(suggestions: string[], composerHasDraft: boolean): string[] {
  if (composerHasDraft) return [];
  return suggestions.slice(0, MAX_FOOTER_SUGGESTIONS);
}

function highlightAnchor(target: HTMLElement) {
  target.classList.add("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  window.setTimeout(() => {
    target.classList.remove("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  }, 1200);
}

function scrollToCellAnchors(cellIds: string[]) {
  const targets = cellIds
    .map((cellId) => document.getElementById(getAnalysisCellAnchorId(cellId)))
    .filter((target): target is HTMLElement => target instanceof HTMLElement);
  if (targets.length === 0) return;

  targets[0].scrollIntoView({ behavior: "smooth", block: "center" });
  for (const target of targets) {
    highlightAnchor(target);
  }
}

function scrollToEvidenceAnchor(anchorId: string) {
  const target = document.getElementById(getAnalysisEvidenceAnchorId(anchorId));
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  highlightAnchor(target);
}

function CopyResponseButton({ text }: { text: string }) {
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
      aria-label="Copy response"
      title="Copy response"
      className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/80"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

function canNavigateSourceItem(item: AnalysisEvidenceItem): boolean {
  const cellId = getSettledAnalysisEvidenceItemCellId(item);
  return Boolean((item.renderedInCurrentMessage && cellId) || item.anchorId);
}

function navigateSourceItem(item: AnalysisEvidenceItem) {
  const cellId = getSettledAnalysisEvidenceItemCellId(item);
  if (item.renderedInCurrentMessage && cellId) {
    scrollToCellAnchors([cellId]);
    return;
  }

  if (item.anchorId) {
    scrollToEvidenceAnchor(item.anchorId);
  }
}

export function AnalysisAnswerFooter({
  isReady,
  reserveSpace,
  messageText,
  messageId,
  sourceItems,
  feedback = null,
  onSubmitFeedback,
  followUpSuggestions: _followUpSuggestions,
  onSelectFollowUpSuggestion: _onSelectFollowUpSuggestion,
  composerHasDraft: _composerHasDraft = false,
}: {
  isReady: boolean;
  reserveSpace: boolean;
  messageText: string;
  messageId: string;
  sourceItems: AnalysisEvidenceItem[];
  feedback?: AnalysisMessageFeedbackRecord | null;
  onSubmitFeedback?: (input: {
    messageId: string;
    vote: AnalysisMessageFeedbackVote | null;
    correctionText?: string | null;
  }) => Promise<void>;
  followUpSuggestions: string[];
  onSelectFollowUpSuggestion?: (suggestion: string) => void | Promise<void>;
  composerHasDraft?: boolean;
}) {
  const [isSourcesOpen, setIsSourcesOpen] = useState(false);
  const [draftCorrectionText, setDraftCorrectionText] = useState(feedback?.correctionText ?? "");
  const [optimisticFeedback, setOptimisticFeedback] = useState<AnalysisMessageFeedbackRecord | null>(feedback ?? null);
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState(false);
  const [isCorrectionPanelOpen, setIsCorrectionPanelOpen] = useState(false);

  const effectiveFeedback = optimisticFeedback ?? feedback ?? null;
  const canShowCopy = messageText.trim().length > 0;
  const canShowSources = sourceItems.length > 0;
  const canShowFeedback = Boolean(onSubmitFeedback);
  const hasFooterContent = canShowCopy || canShowSources || canShowFeedback;
  const reservedHeightClass = "min-h-8";

  useEffect(() => {
    setOptimisticFeedback(feedback ?? null);
    setDraftCorrectionText(feedback?.correctionText ?? "");
  }, [feedback]);

  async function submitFeedback(vote: AnalysisMessageFeedbackVote | null, correctionText?: string | null) {
    if (!onSubmitFeedback || isSubmittingFeedback) return;

    const trimmedCorrectionText = correctionText?.trim() || null;
    const nextFeedback: AnalysisMessageFeedbackRecord | null = vote === null
      ? null
      : {
          messageId,
          vote,
          correctionText: vote === "down" ? trimmedCorrectionText : null,
          updatedAt: Date.now(),
        };

    const previousFeedback = effectiveFeedback;
    setOptimisticFeedback(nextFeedback);
    setIsSubmittingFeedback(true);

    try {
      await onSubmitFeedback({
        messageId,
        vote,
        correctionText: vote === "down" ? trimmedCorrectionText : null,
      });
    } catch (_error) {
      setOptimisticFeedback(previousFeedback ?? null);
    } finally {
      setIsSubmittingFeedback(false);
    }
  }

  function handleThumbClick(vote: AnalysisMessageFeedbackVote) {
    const isToggleOff = effectiveFeedback?.vote === vote;
    if (isToggleOff) {
      setIsCorrectionPanelOpen(false);
      void submitFeedback(null);
      return;
    }
    if (vote === "down") {
      setIsCorrectionPanelOpen(true);
      void submitFeedback("down", draftCorrectionText);
    } else {
      setIsCorrectionPanelOpen(false);
      void submitFeedback("up");
    }
  }

  if (!reserveSpace && !isReady) {
    return null;
  }

  if (!isReady) {
    return (
      <div
        aria-hidden="true"
        data-analysis-answer-footer-state="reserved"
        className={cn("pt-1", reservedHeightClass)}
      />
    );
  }

  if (!hasFooterContent) {
    return null;
  }

  return (
    <div
      data-analysis-answer-footer-state="ready"
      className={cn("space-y-2 pt-1 transition-opacity duration-200", reservedHeightClass)}
    >
      <div className="flex flex-wrap items-center justify-start gap-1">
        {canShowCopy ? <CopyResponseButton text={messageText} /> : null}

        {canShowFeedback ? (
          <>
            <button
              type="button"
              disabled={isSubmittingFeedback}
              onClick={() => handleThumbClick("up")}
              aria-pressed={effectiveFeedback?.vote === "up"}
              aria-label={effectiveFeedback?.vote === "up" ? "Remove helpful feedback" : "Mark response as helpful"}
              title={effectiveFeedback?.vote === "up" ? "Remove helpful feedback" : "Helpful"}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                effectiveFeedback?.vote === "up"
                  ? "bg-muted/60 text-foreground/85"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/80",
              )}
            >
              <ThumbsUp className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={isSubmittingFeedback}
              onClick={() => handleThumbClick("down")}
              aria-pressed={effectiveFeedback?.vote === "down"}
              aria-label={effectiveFeedback?.vote === "down" ? "Remove needs-work feedback" : "Mark response as needing work"}
              title={effectiveFeedback?.vote === "down" ? "Remove needs-work feedback" : "Needs work"}
              className={cn(
                "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                effectiveFeedback?.vote === "down"
                  ? "bg-muted/60 text-foreground/85"
                  : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/80",
              )}
            >
              <ThumbsDown className="h-3.5 w-3.5" />
            </button>
          </>
        ) : null}

        {canShowSources ? (
          <Popover open={isSourcesOpen} onOpenChange={setIsSourcesOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={`Evidence (${sourceItems.length})`}
                title={`Evidence (${sourceItems.length})`}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-full transition-colors",
                  isSourcesOpen
                    ? "bg-muted/60 text-foreground/85"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground/80",
                )}
              >
                <BookOpen className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-80">
              <div className="space-y-1.5">
                <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Additional sources ({sourceItems.length})
                </p>
                {sourceItems.map((item) => {
                  const clickable = canNavigateSourceItem(item);

                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={clickable ? () => navigateSourceItem(item) : undefined}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] leading-5 text-muted-foreground",
                        clickable
                          ? "hover:bg-muted/40 hover:text-foreground/80"
                          : "cursor-default",
                      )}
                    >
                      <Link2 className="h-3 w-3 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </PopoverContent>
          </Popover>
        ) : null}
      </div>

      {isCorrectionPanelOpen && effectiveFeedback?.vote === "down" ? (
        <div className="relative max-w-xl space-y-2 rounded-2xl border border-border/60 bg-background/90 p-3 pr-9 shadow-sm">
          <button
            type="button"
            onClick={() => setIsCorrectionPanelOpen(false)}
            aria-label="Close feedback note"
            title="Close"
            className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground/80"
          >
            <X className="h-3.5 w-3.5" />
          </button>
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
              onClick={async () => {
                await submitFeedback("down", draftCorrectionText);
                setIsCorrectionPanelOpen(false);
              }}
              className="rounded-full border border-border/70 px-3 py-1 text-[11px] text-foreground/85 transition-colors hover:border-foreground/20 hover:bg-muted/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Save feedback
            </button>
          </div>
        </div>
      ) : null}

    </div>
  );
}
