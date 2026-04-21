"use client";

import { useEffect, useRef, useState } from "react";
import { Streamdown } from "streamdown";
import {
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { ChevronDown, Link2 } from "lucide-react";

import { GroundedTableCard } from "@/components/analysis/GroundedTableCard";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { getAnalysisMessageMetadata } from "@/lib/analysis/messages";
import { getAnalysisToolActivityLabel } from "@/lib/analysis/toolLabels";
import { isAnalysisTableCard, type AnalysisEvidenceItem } from "@/lib/analysis/types";
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
}: {
  message: UIMessage;
  isStreaming?: boolean;
}) {
  const [isThinkingExpanded, setIsThinkingExpanded] = useState(false);
  const isUser = message.role === "user";
  const hasGroundedTableCard = !isUser && message.parts.some(
    (part) => isToolUIPart(part) && part.type === "tool-getTableCard",
  );
  const [isEvidenceOpen, setIsEvidenceOpen] = useState(false);

  const traceEntries = getAnalysisTraceEntries(message);
  const evidenceItems = getAnalysisMessageEvidenceItems(message);

  const hasTrace = traceEntries.length > 0;

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

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0",
          hasGroundedTableCard ? "w-full max-w-full" : "max-w-[88%]",
          isUser
            ? "rounded-2xl bg-primary/10 px-4 py-2.5"
            : "",
        )}
      >
        {isUser ? (
          <p className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 [overflow-wrap:anywhere]">
            {message.parts.filter(isTextUIPart).map((part) => part.text).join("")}
          </p>
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

            {message.parts.map((part, index) => {
              if (isTextUIPart(part)) {
                return (
                  <div
                    key={`${message.id}-text-${index}`}
                    className="prose-analysis min-w-0 max-w-none break-words [overflow-wrap:anywhere]"
                  >
                    <StreamingMarkdown text={part.text} isStreaming={isStreaming} />
                  </div>
                );
              }

              if (isToolUIPart(part) && part.type === "tool-getTableCard") {
                if (part.state === "output-available" && isAnalysisTableCard(part.output)) {
                  return (
                    <div
                      key={`${message.id}-${part.toolCallId}`}
                      id={getAnalysisEvidenceAnchorId(part.toolCallId)}
                      className="scroll-mt-24 rounded-xl transition-shadow duration-300"
                    >
                      <GroundedTableCard
                        card={part.output}
                      />
                    </div>
                  );
                }

                return (
                  <div
                    key={`${message.id}-${part.toolCallId}`}
                    className="rounded-xl border border-dashed border-border/80 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
                  >
                    Loading table...
                  </div>
                );
              }

              return null;
            })}

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
          </div>
        )}
      </div>
    </div>
  );
}
