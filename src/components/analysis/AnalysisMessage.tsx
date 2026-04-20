"use client";

import { useState } from "react";
import Markdown from "react-markdown";
import {
  isReasoningUIPart,
  isTextUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";
import { ChevronDown } from "lucide-react";

import { GroundedTableCard } from "@/components/analysis/GroundedTableCard";
import { getAnalysisToolActivityLabel } from "@/lib/analysis/toolLabels";
import { isAnalysisTableCard } from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

function truncateReasoning(text: string, maxLength = 120): string {
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength).trim()}...`;
}

type TraceEntry =
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; label: string; state: string };

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

  const traceEntries: TraceEntry[] = !isUser
    ? message.parts.flatMap((part, index): TraceEntry[] => {
        if (isReasoningUIPart(part)) {
          return [{
            kind: "reasoning",
            id: `${message.id}-reasoning-${index}`,
            text: part.text,
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
      })
    : [];

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
                    {isThinkingExpanded ? "Thinking" : (collapsedSummary ?? "Thinking")}
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
                    className="prose prose-sm min-w-0 max-w-none break-words dark:prose-invert prose-p:my-2 prose-p:whitespace-pre-wrap prose-ul:my-2 prose-ol:my-2 [overflow-wrap:anywhere]"
                  >
                    <Markdown>{part.text}</Markdown>
                  </div>
                );
              }

              if (isToolUIPart(part) && part.type === "tool-getTableCard") {
                if (part.state === "output-available" && isAnalysisTableCard(part.output)) {
                  return (
                    <GroundedTableCard
                      key={`${message.id}-${part.toolCallId}`}
                      card={part.output}
                    />
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
          </div>
        )}
      </div>
    </div>
  );
}
