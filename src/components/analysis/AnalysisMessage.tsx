"use client";

import Markdown from "react-markdown";
import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";

import { GroundedTableCard } from "@/components/analysis/GroundedTableCard";
import { Badge } from "@/components/ui/badge";
import { isAnalysisTableCard } from "@/lib/analysis/types";
import { cn } from "@/lib/utils";

export function AnalysisMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={cn("flex w-full", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[88%] rounded-2xl border px-4 py-3",
          isUser
            ? "border-primary/20 bg-primary/10"
            : "border-border/80 bg-card/80",
        )}
      >
        <div className="mb-2 flex items-center gap-2">
          <Badge variant={isUser ? "secondary" : "outline"} className="text-[10px] uppercase tracking-[0.16em]">
            {isUser ? "You" : "TabulateAI"}
          </Badge>
        </div>

        {isUser ? (
          <p className="whitespace-pre-wrap text-sm leading-6">
            {message.parts.filter(isTextUIPart).map((part) => part.text).join("")}
          </p>
        ) : (
          <div className="space-y-3">
            {message.parts.map((part, index) => {
              if (isTextUIPart(part)) {
                return (
                  <div
                    key={`${message.id}-text-${index}`}
                    className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2"
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
