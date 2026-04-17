"use client";

import Markdown from "react-markdown";
import { type UIMessage } from "ai";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getAnalysisUIMessageText } from "@/lib/analysis/messages";

export function AnalysisMessage({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";
  const text = getAnalysisUIMessageText(message);

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
          <p className="whitespace-pre-wrap text-sm leading-6">{text}</p>
        ) : (
          <div className="prose prose-sm max-w-none dark:prose-invert prose-p:my-2 prose-ul:my-2 prose-ol:my-2">
            <Markdown>{text}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
