"use client";

import { Square, ArrowUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onStop: () => void;
  isBusy: boolean;
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  onStop,
  isBusy,
}: PromptComposerProps) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card/90 p-4">
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Ask a question about how you want to analyze this run, interpret a result, or plan the next cut..."
        className="min-h-28 resize-none border-border/80 bg-background/70"
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
            event.preventDefault();
            void onSubmit();
          }
        }}
      />
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {isBusy ? "Streaming response..." : "Press Enter to send, Shift+Enter for new line"}
        </p>
        {isBusy ? (
          <Button type="button" variant="outline" onClick={onStop}>
            <Square className="mr-2 h-4 w-4" />
            Stop
          </Button>
        ) : (
          <Button
            type="button"
            onClick={() => {
              void onSubmit();
            }}
            disabled={value.trim().length === 0}
          >
            <ArrowUp className="mr-2 h-4 w-4" />
            Send
          </Button>
        )}
      </div>
    </div>
  );
}
