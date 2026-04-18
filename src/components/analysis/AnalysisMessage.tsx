"use client";

import Markdown from "react-markdown";
import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";

import { GroundedTableCard } from "@/components/analysis/GroundedTableCard";
import { isAnalysisTableCard } from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

export function AnalysisMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const hasGroundedTableCard = !isUser && message.parts.some(
    (part) => isToolUIPart(part) && part.type === "tool-getTableCard",
  );

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
                    Loading grounded table card...
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
