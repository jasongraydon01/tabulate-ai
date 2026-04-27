"use client";

import type { ComponentProps } from "react";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

export type ToolProps = ComponentProps<"div">;

export function Tool({ className, ...props }: ToolProps) {
  return (
    <div
      className={cn("not-prose min-w-0", className)}
      {...props}
    />
  );
}

export type ToolHeaderProps = ComponentProps<"div"> & {
  title: string;
  state: "running" | "completed" | "pending";
};

export function ToolHeader({
  title,
  state,
  className,
  ...props
}: ToolHeaderProps) {
  const Icon = state === "running" ? Loader2 : state === "completed" ? CheckCircle2 : Circle;

  return (
    <div
      className={cn("flex min-w-0 items-center gap-2 text-[11px] leading-5 text-muted-foreground", className)}
      {...props}
    >
      <Icon
        className={cn(
          "h-3 w-3 shrink-0",
          state === "running" && "animate-spin text-ct-blue",
          state === "completed" && "text-ct-emerald",
          state === "pending" && "text-muted-foreground/60",
        )}
      />
      <span className="min-w-0 truncate">{title}</span>
    </div>
  );
}
