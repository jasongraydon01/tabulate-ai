"use client";

import { cn } from "@/lib/utils";

export function AnalysisTitleBadge({
  className,
}: {
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border border-ct-violet/30 bg-ct-violet-dim px-2 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-ct-violet",
        className,
      )}
    >
      Generated
    </span>
  );
}
