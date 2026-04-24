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
import { buildAnalysisCiteSegments } from "@/lib/analysis/citeAnchors";
import { buildAnalysisRenderableBlocks } from "@/lib/analysis/renderAnchors";
import { getAnalysisToolActivityLabel } from "@/lib/analysis/toolLabels";
import {
  buildAnalysisCellId,
  isAnalysisCellSummary,
  isAnalysisTableCard,
  parseAnalysisCellId,
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

interface CitationChipMeta {
  chipLabel: string;
  title: string;
}

function buildCitationChipMetaByCellId(parts: UIMessage["parts"]): Map<string, CitationChipMeta> {
  const metaByCellId = new Map<string, CitationChipMeta>();

  for (const part of parts) {
    if (
      !isToolUIPart(part)
      || part.type !== "tool-confirmCitation"
      || part.state !== "output-available"
    ) {
      continue;
    }

    const output = part.output;
    if (!isAnalysisCellSummary(output)) {
      continue;
    }

    const chipLabel = output.questionId?.trim() || output.tableId;
    const title = `${output.tableTitle} — ${output.rowLabel} / ${output.cutName}`;
    metaByCellId.set(output.cellId, {
      chipLabel,
      title,
    });
  }

  return metaByCellId;
}

function InlineCitationText({
  text,
  citeMetaByCellId,
}: {
  text: string;
  citeMetaByCellId: Map<string, CitationChipMeta>;
}) {
  const segments = buildAnalysisCiteSegments(text);

  return (
    <p className="min-w-0 whitespace-pre-wrap break-words text-[0.9375rem] leading-[1.65] [overflow-wrap:anywhere]">
      {segments.map((segment, segmentIndex) => {
        if (segment.kind === "text") {
          return (
            <span key={`text-${segmentIndex}`}>
              {segment.text}
            </span>
          );
        }

        return (
          <CiteChip
            key={`cite-${segmentIndex}`}
            index={segment.indexWithinMessage}
            cellIds={segment.cellIds}
            citeMetaByCellId={citeMetaByCellId}
          />
        );
      })}
    </p>
  );
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

// Strip common markdown markers from reasoning summary text. OpenAI's
// Responses API emits reasoning-summary chunks containing things like
// `**Filtering bank data**` and `- step`, but the UI renders reasoning as
// plain text, so the markers show literally. Stripping is deterministic —
// keep the prompt out of this.
function stripReasoningMarkdown(text: string): string {
  return text
    // Images first (dropped entirely, including alt text).
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Links → keep label, drop url.
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    // Code fences and inline code → keep inner text.
    .replace(/```[\s\S]*?```/g, (match) => match.replace(/```[a-zA-Z]*\n?|```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    // Bold / italic via asterisk or underscore — strip the markers, keep text.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(?<!\*)\*(?!\*)([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_(?!_)([^_\n]+)_(?!_)/g, "$1")
    // Strikethrough.
    .replace(/~~([^~]+)~~/g, "$1")
    // ATX headings at the start of a line.
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    // Blockquote markers.
    .replace(/^\s*>\s?/gm, "")
    // Unordered list bullets at the start of a line (only spaces/tabs, never
    // newlines — otherwise a leading blank line gets folded into the bullet).
    .replace(/^[ \t]*[-*+]\s+/gm, "")
    // Ordered list numerals at the start of a line.
    .replace(/^[ \t]*\d+\.\s+/gm, "")
    // Horizontal rules on their own line.
    .replace(/^\s*(?:[-*_]\s*){3,}\s*$/gm, "");
}

function truncateReasoning(text: string, maxLength = 120): string {
  const stripped = stripReasoningMarkdown(text);
  const firstLine = stripped.split("\n")[0].trim();
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
      const text = stripReasoningMarkdown(part.text).trim();
      if (!text) return [];

      return [{
        kind: "reasoning",
        id: `${message.id}-reasoning-${index}`,
        text,
      }];
    }
    if (isToolUIPart(part)) {
      // `tool-fetchTable` plays two roles: it surfaces as a "Fetching table"
      // chip in the thinking trace here, AND its output data is resolved
      // inline wherever the prose emits a `[[render tableId=…]]` marker.
      // `buildAnalysisRenderableBlocks` handles the render path separately.
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

// Cell anchors live on each rendered cell `<td>` in GroundedTableCard. cellIds
// contain `|`, `%`, and URL-encoded punctuation; sanitize to CSS-safe chars.
export function getAnalysisCellAnchorId(cellId: string): string {
  return `analysis-cell-${cellId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

function scrollToCellAnchor(cellId: string) {
  const target = document.getElementById(getAnalysisCellAnchorId(cellId));
  if (!target) return;

  target.scrollIntoView({ behavior: "smooth", block: "center" });
  target.classList.add("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  window.setTimeout(() => {
    target.classList.remove("ring-2", "ring-tab-teal/40", "ring-offset-2", "ring-offset-background");
  }, 1200);
}

const SUPERSCRIPT_DIGITS = ["⁰", "¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

function toSuperscript(index: number): string {
  return String(index)
    .split("")
    .map((digit) => SUPERSCRIPT_DIGITS[Number(digit)] ?? digit)
    .join("");
}

function CiteChip({
  index,
  cellIds,
  citeMetaByCellId,
}: {
  index: number;
  cellIds: string[];
  citeMetaByCellId: Map<string, CitationChipMeta>;
}) {
  if (cellIds.length === 0) return null;

  const primaryCellId = cellIds[0]!;
  const labels = [...new Set(cellIds.map((cellId) => {
    const meta = citeMetaByCellId.get(cellId);
    if (meta?.chipLabel) return meta.chipLabel;
    const parsed = parseAnalysisCellId(cellId);
    return parsed?.tableId ?? cellId;
  }))];
  const chipLabel = labels.join(",");
  const title = cellIds
    .map((cellId) => {
      const meta = citeMetaByCellId.get(cellId);
      if (meta?.title) return meta.title;
      const parsed = parseAnalysisCellId(cellId);
      if (!parsed) return cellId;
      return `${parsed.tableId} — ${parsed.rowKey} / ${parsed.cutKey}`;
    })
    .join("\n");

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        scrollToCellAnchor(primaryCellId);
      }}
      title={title}
      className="mx-0.5 inline-flex items-baseline gap-0.5 align-super text-[0.65em] font-mono text-tab-teal/90 hover:text-tab-teal underline-offset-2 hover:underline"
      aria-label={`Citation ${chipLabel} ${index}`}
    >
      <span>{chipLabel}</span>
      <span>{toSuperscript(index)}</span>
    </button>
  );
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
    (part) => isToolUIPart(part) && part.type === "tool-fetchTable",
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
  const citeMetaByCellId = buildCitationChipMetaByCellId(message.parts);

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
                const segments = buildAnalysisCiteSegments(block.text);
                const hasCiteMarkers = segments.some((segment) => segment.kind === "cite");

                if (!hasCiteMarkers) {
                  return (
                    <div
                      key={block.key}
                      className="prose-analysis min-w-0 max-w-none break-words [overflow-wrap:anywhere]"
                    >
                      <StreamingMarkdown text={block.text} isStreaming={isStreaming} />
                    </div>
                  );
                }

                // Render each segment — markdown for text, inline chip for cite.
                // Streamdown handles one prose block at a time; chips render as
                // inline siblings via a shared wrapper that preserves flow.
                return (
                  <div
                    key={block.key}
                    className="prose-analysis min-w-0 max-w-none break-words [overflow-wrap:anywhere]"
                  >
                    <InlineCitationText
                      text={block.text}
                      citeMetaByCellId={citeMetaByCellId}
                    />
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

              if (block.kind === "missing") {
                return (
                  <div
                    key={block.key}
                    className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                  >
                    Referenced table not available.
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
                      focus={block.focus}
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
                        {evidenceItems.map((item) => {
                          const cellAnchorCellId = item.evidenceKind === "cell"
                            && item.sourceTableId
                            && item.rowKey
                            && item.cutKey
                            ? buildAnalysisCellId({
                                tableId: item.sourceTableId,
                                rowKey: item.rowKey,
                                cutKey: item.cutKey,
                                // evidenceItems don't carry valueMode; the cell's
                                // anchor id on the rendered card uses the card's
                                // valueMode. Try pct first (most common), fall
                                // back to the card anchor on miss.
                                valueMode: "pct",
                              })
                            : null;

                          const handleClick = () => {
                            if (cellAnchorCellId) {
                              scrollToCellAnchor(cellAnchorCellId);
                              return;
                            }
                            if (item.anchorId) {
                              scrollToEvidenceAnchor(item.anchorId);
                            }
                          };

                          const clickable = Boolean(cellAnchorCellId || item.anchorId);

                          return (
                            <button
                              key={item.key}
                              type="button"
                              onClick={clickable ? handleClick : undefined}
                              className={cn(
                                "flex w-full items-center gap-2 text-left text-[11px] leading-5 text-muted-foreground",
                                clickable ? "hover:text-foreground/80" : "cursor-default",
                              )}
                            >
                              <Link2 className="h-3 w-3 shrink-0" />
                              <span className="truncate">{item.label}</span>
                            </button>
                          );
                        })}
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
