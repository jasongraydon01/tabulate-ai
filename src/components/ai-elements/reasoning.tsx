"use client";

import type { ComponentProps, ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

export type ReasoningProps = ComponentProps<typeof Collapsible>;

export function Reasoning({ className, ...props }: ReasoningProps) {
  return (
    <Collapsible
      className={cn("not-prose min-w-0", className)}
      {...props}
    />
  );
}

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  icon?: ReactNode;
};

export function ReasoningTrigger({
  className,
  icon,
  children,
  ...props
}: ReasoningTriggerProps) {
  return (
    <CollapsibleTrigger
      className={cn(
        "flex w-full min-w-0 items-center justify-between gap-3 text-left text-muted-foreground transition-colors hover:text-foreground/80",
        className,
      )}
      {...props}
    >
      <span className="flex min-w-0 items-center gap-2">
        {icon}
        {children}
      </span>
    </CollapsibleTrigger>
  );
}

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent>;

export function ReasoningContent({
  className,
  ...props
}: ReasoningContentProps) {
  return (
    <CollapsibleContent
      className={cn(
        "data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:slide-in-from-top-1 outline-none data-[state=closed]:animate-out data-[state=open]:animate-in",
        className,
      )}
      {...props}
    />
  );
}
