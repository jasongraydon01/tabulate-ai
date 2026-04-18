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
import { isAnalysisTableCard } from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  "tool-searchRunCatalog": "Searching run catalog",
  "tool-viewTable": "Inspecting table",
  "tool-getQuestionContext": "Checking question metadata",
  "tool-listBannerCuts": "Listing available cuts",
  "tool-scratchpad": "Reasoning",
};

function getToolActivityLabel(toolType: string): string | null {
  return TOOL_ACTIVITY_LABELS[toolType] ?? null;
}

function truncateReasoning(text: string, maxLength = 120): string {
  const firstLine = text.split("\n")[0].trim();
  if (firstLine.length <= maxLength) return firstLine;
  return `${firstLine.slice(0, maxLength).trim()}...`;
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

  const reasoningParts = !isUser
    ? message.parts.filter(isReasoningUIPart)
    : [];
  const hasReasoning = reasoningParts.length > 0;
  const reasoningText = reasoningParts.map((part) => part.text).join("\n\n");
  const hasTextContent = message.parts.some(isTextUIPart);

  const toolActivityParts = !isUser
    ? message.parts
        .filter((part) => isToolUIPart(part) && part.type !== "tool-getTableCard")
        .map((part) => {
          if (!isToolUIPart(part)) return null;
          const label = getToolActivityLabel(part.type);
          if (!label) return null;
          return { key: `${part.toolCallId}`, label, state: part.state };
        })
        .filter(Boolean)
    : [];

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
            {hasReasoning ? (
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
                    {isThinkingExpanded ? "Thinking" : truncateReasoning(reasoningText)}
                  </span>
                </button>

                {isThinkingExpanded ? (
                  <div className="ml-4.5 border-l border-border/40 pl-3 text-xs leading-relaxed text-muted-foreground">
                    {reasoningText}
                  </div>
                ) : null}
              </div>
            ) : null}

            {isStreaming && !hasTextContent && toolActivityParts.length > 0 ? (
              <div className="space-y-1">
                {toolActivityParts.map((activity) => activity ? (
                  <div
                    key={activity.key}
                    className="flex items-center gap-2 text-xs text-muted-foreground"
                  >
                    <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
                    {activity.label}
                    {activity.state !== "output-available" ? "..." : ""}
                  </div>
                ) : null)}
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
