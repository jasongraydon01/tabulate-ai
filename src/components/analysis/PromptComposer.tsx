"use client";

import { Square, ArrowUp, GitBranchPlus, Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Textarea } from "@/components/ui/textarea";

interface PromptComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => Promise<void>;
  onComputeSubmit: () => Promise<void>;
  onStop: () => void;
  isBusy: boolean;
  isComputeBusy: boolean;
}

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  onComputeSubmit,
  onStop,
  isBusy,
  isComputeBusy,
}: PromptComposerProps) {
  const isInputEmpty = value.trim().length === 0;
  const isLocked = isBusy || isComputeBusy;

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="flex flex-col gap-2 rounded-2xl border border-border/60 bg-white px-4 py-2 shadow-sm dark:bg-card">
        {isComputeBusy ? (
          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>TabulateAI is checking the run for a derived banner group...</span>
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:text-foreground"
                disabled={isLocked}
                title="More actions"
                aria-label="More actions"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" side="top" className="w-56">
              <DropdownMenuItem
                disabled={isInputEmpty || isLocked}
                onSelect={(event) => {
                  if (isInputEmpty || isLocked) {
                    event.preventDefault();
                    return;
                  }
                  void onComputeSubmit();
                }}
              >
                <GitBranchPlus className="h-4 w-4" />
                <span>Create derived run</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Ask anything"
            rows={1}
            className="min-h-[36px] max-h-[140px] resize-none border-0 bg-transparent p-0 text-sm shadow-none placeholder:text-muted-foreground/60 focus-visible:ring-0"
            disabled={isComputeBusy}
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
              disabled={isInputEmpty || isLocked}
              title="Send message"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
