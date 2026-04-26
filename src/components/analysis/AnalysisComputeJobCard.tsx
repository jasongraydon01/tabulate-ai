"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clock3,
  ExternalLink,
  Loader2,
  PlayCircle,
  RefreshCcw,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import type { AnalysisComputeJobView } from "@/lib/analysis/computeLane/jobView";
import { cn } from "@/lib/utils";

interface AnalysisComputeJobCardProps {
  job: AnalysisComputeJobView;
  onConfirm: (job: AnalysisComputeJobView) => Promise<void>;
  onCancel: (job: AnalysisComputeJobView) => Promise<void>;
  onContinue: (job: AnalysisComputeJobView) => Promise<void>;
  onRevise: (requestText: string) => void;
}

function formatConfidence(value: number | undefined): string | null {
  if (typeof value !== "number") return null;
  return `${Math.round(value * 100)}%`;
}

function statusLabel(job: AnalysisComputeJobView): string {
  switch (job.effectiveStatus) {
    case "proposed":
      return "Proposal ready";
    case "needs_clarification":
      return "Needs clarification";
    case "confirmed":
      return "Confirmed";
    case "queued":
      return "Queued";
    case "running":
      return "Creating derived run";
    case "success":
      return "Derived run ready";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
    default:
      return "Checking request";
  }
}

function StatusIcon({ status }: { status: AnalysisComputeJobView["effectiveStatus"] }) {
  if (status === "success") return <CheckCircle2 className="h-4 w-4 text-ct-emerald" />;
  if (status === "failed" || status === "expired") return <XCircle className="h-4 w-4 text-ct-red" />;
  if (status === "cancelled") return <CircleStop className="h-4 w-4 text-muted-foreground" />;
  if (status === "needs_clarification") return <AlertCircle className="h-4 w-4 text-ct-amber" />;
  if (status === "queued" || status === "running" || status === "confirmed") return <Loader2 className="h-4 w-4 animate-spin text-ct-blue" />;
  return <Clock3 className="h-4 w-4 text-ct-violet" />;
}

export function AnalysisComputeJobCard({
  job,
  onConfirm,
  onCancel,
  onContinue,
  onRevise,
}: AnalysisComputeJobCardProps) {
  const [pendingAction, setPendingAction] = useState<"confirm" | "cancel" | "continue" | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const isPending = pendingAction !== null;
  const canConfirm = job.effectiveStatus === "proposed" && Boolean(job.confirmToken);
  const canCancel = ["proposed", "needs_clarification", "confirmed", "queued", "running"].includes(job.effectiveStatus);
  const showProgress = job.childRun && (job.effectiveStatus === "queued" || job.effectiveStatus === "running");
  const progress = typeof job.childRun?.progress === "number"
    ? Math.max(0, Math.min(100, job.childRun.progress))
    : job.effectiveStatus === "queued"
      ? 8
      : 45;

  async function runAction(action: "confirm" | "cancel" | "continue", fn: () => Promise<void>) {
    if (pendingAction) return;
    setPendingAction(action);
    try {
      await fn();
    } finally {
      setPendingAction(null);
    }
  }

  return (
    <div className="flex w-full justify-start">
      <div className="w-full max-w-2xl rounded-xl border border-border/70 bg-background/95 p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <StatusIcon status={job.effectiveStatus} />
              <span>{statusLabel(job)}</span>
            </div>
            <h3 className="text-sm font-medium text-foreground">
              {job.proposedGroup?.groupName ?? "Derived banner group"}
            </h3>
          </div>
          <div className="shrink-0 rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
            Derived run
          </div>
        </div>

        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/85 [overflow-wrap:anywhere]">
          {job.requestText}
        </p>

        {job.proposedGroup ? (
          <div className="mt-3 space-y-2">
            {job.proposedGroup.cuts.map((cut) => (
              <div
                key={`${job.id}-${cut.name}`}
                className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{cut.name}</p>
                    <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                      {cut.userSummary ?? cut.original}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                    {cut.expressionType ? <span>{cut.expressionType}</span> : null}
                    {formatConfidence(cut.confidence) ? (
                      <span className="rounded-full bg-ct-blue-dim px-2 py-0.5 font-mono text-ct-blue">
                        {formatConfidence(cut.confidence)}
                      </span>
                    ) : null}
                  </div>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Requested as: {cut.original}
                </p>
              </div>
            ))}

            <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground/80"
                >
                  <ChevronDown className={cn("h-3 w-3 transition-transform", detailsOpen && "rotate-180")} />
                  Validation details
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                {detailsOpen ? (
                  <div className="space-y-2 rounded-lg border border-border/60 bg-muted/15 p-3">
                    {job.proposedGroup.cuts.map((cut) => (
                      <div key={`${job.id}-${cut.name}-raw`} className="space-y-1">
                        <p className="text-[11px] font-medium text-muted-foreground">{cut.name}</p>
                        <code className="block whitespace-pre-wrap rounded bg-background/80 px-2 py-1 font-mono text-[11px] leading-5 text-foreground [overflow-wrap:anywhere]">
                          {cut.rawExpression ?? "No executable expression available."}
                        </code>
                        {cut.validatedSummary ? (
                          <p className="text-[11px] leading-5 text-muted-foreground">{cut.validatedSummary}</p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </CollapsibleContent>
            </Collapsible>
          </div>
        ) : null}

        {job.reviewFlags?.reasons.length ? (
          <div className="mt-3 rounded-lg border border-ct-amber/30 bg-ct-amber-dim px-3 py-2 text-xs leading-5 text-foreground/85">
            {job.reviewFlags.reasons.map((reason) => (
              <p key={reason}>{reason}</p>
            ))}
          </div>
        ) : null}

        {showProgress ? (
          <div className="mt-3 space-y-2">
            <Progress value={progress} className="h-1.5" />
            <p className="text-xs leading-5 text-muted-foreground">
              {job.childRun?.message ?? (job.effectiveStatus === "queued" ? "Queued for worker pickup." : "Running compute for the derived run.")}
            </p>
          </div>
        ) : null}

        {job.effectiveStatus === "failed" && job.error ? (
          <p className="mt-3 rounded-lg border border-ct-red/30 bg-ct-red-dim px-3 py-2 text-xs leading-5 text-foreground/85">
            {job.error}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {canConfirm ? (
            <Button
              type="button"
              size="sm"
              onClick={() => { void runAction("confirm", () => onConfirm(job)); }}
              disabled={isPending}
            >
              {pendingAction === "confirm" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}
              Confirm
            </Button>
          ) : null}

          {job.effectiveStatus === "success" && job.childRun ? (
            <Button
              type="button"
              size="sm"
              onClick={() => { void runAction("continue", () => onContinue(job)); }}
              disabled={isPending}
            >
              {pendingAction === "continue" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              Continue in derived run
            </Button>
          ) : null}

          {["needs_clarification", "failed", "cancelled", "expired"].includes(job.effectiveStatus) ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => onRevise(job.requestText)}
            >
              <RefreshCcw className="h-3.5 w-3.5" />
              Revise request
            </Button>
          ) : null}

          {canCancel ? (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => { void runAction("cancel", () => onCancel(job)); }}
              disabled={isPending}
            >
              {pendingAction === "cancel" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleStop className="h-3.5 w-3.5" />}
              Cancel
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
