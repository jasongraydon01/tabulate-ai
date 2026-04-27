"use client";

import { ChevronDown } from "lucide-react";

import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Tool,
  ToolHeader,
} from "@/components/ai-elements/tool";
import { GridLoader } from "@/components/ui/grid-loader";
import { cn } from "@/lib/utils";

export type AnalysisWorkActivityEntry =
  | { kind: "reasoning"; id: string; text: string }
  | { kind: "tool"; id: string; label: string; state: string };

function toolStateToDisplayState(state: string, isStreaming: boolean): "running" | "completed" | "pending" {
  if (state === "output-available") return "completed";
  if (isStreaming) return "running";
  return "pending";
}

export function AnalysisWorkDisclosure({
  entries,
  statusLabel,
  isOpen,
  onOpenChange,
  showLoader = false,
  ariaLive = "polite",
  className,
}: {
  entries: AnalysisWorkActivityEntry[];
  statusLabel: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  showLoader?: boolean;
  ariaLive?: "off" | "polite";
  className?: string;
}) {
  const toolEntries = entries.filter((entry): entry is Extract<AnalysisWorkActivityEntry, { kind: "tool" }> => (
    entry.kind === "tool"
  ));
  const reasoningEntries = entries.filter((entry): entry is Extract<AnalysisWorkActivityEntry, { kind: "reasoning" }> => (
    entry.kind === "reasoning"
  ));
  const hasDetails = entries.length > 0;

  return (
    <div
      className={cn("min-w-0 max-w-full", className)}
      role="status"
      aria-live={ariaLive}
    >
      <Reasoning
        open={isOpen && hasDetails}
        onOpenChange={(nextOpen) => {
          if (hasDetails) onOpenChange(nextOpen);
        }}
      >
        <ReasoningTrigger
          disabled={!hasDetails}
          className={cn(
            "inline-flex w-auto max-w-full justify-start gap-1.5 text-[11px]",
            !hasDetails && "cursor-default hover:text-muted-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            {showLoader ? <GridLoader size="sm" /> : null}
            <span className="min-w-0 truncate italic">{statusLabel}</span>
          </span>
          {hasDetails ? (
            <ChevronDown
              className={cn(
                "h-3 w-3 shrink-0 transition-transform",
                isOpen ? "rotate-180" : "-rotate-90",
              )}
            />
          ) : null}
        </ReasoningTrigger>

        {isOpen && hasDetails ? (
          <ReasoningContent className="pt-2">
            <div className="space-y-2 border-l border-border/40 pl-2.5">
              {toolEntries.length > 0 ? (
                <div className="space-y-1">
                  {toolEntries.map((entry) => (
                    <Tool key={entry.id}>
                      <ToolHeader
                        title={entry.label}
                        state={toolStateToDisplayState(entry.state, showLoader)}
                      />
                    </Tool>
                  ))}
                </div>
              ) : null}

              {reasoningEntries.length > 0 ? (
                <div className="space-y-1 text-[11px] leading-5 text-muted-foreground">
                  {reasoningEntries.map((entry) => (
                    <p
                      key={entry.id}
                      className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]"
                    >
                      {entry.text}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
          </ReasoningContent>
        ) : null}
      </Reasoning>
    </div>
  );
}
