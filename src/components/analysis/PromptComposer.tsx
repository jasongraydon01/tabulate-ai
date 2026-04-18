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
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex items-center gap-2 rounded-2xl border border-border/60 bg-white px-4 py-2 shadow-sm dark:bg-card">
        <Textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Ask anything"
          rows={1}
          className="min-h-[36px] max-h-[140px] resize-none border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.metaKey && !event.ctrlKey) {
              event.preventDefault();
              void onSubmit();
            }
          }}
        />
        {isBusy ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            onClick={onStop}
          >
            <Square className="h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button
            type="button"
            size="icon"
            className="h-8 w-8 shrink-0 rounded-full"
            onClick={() => { void onSubmit(); }}
            disabled={value.trim().length === 0}
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  );
}
