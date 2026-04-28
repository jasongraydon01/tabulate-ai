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
  const isDerivedTable = job.jobType === "table_rollup_derivation" || job.jobType === "selected_table_cut_derivation";
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
      return isDerivedTable ? "Creating derived table" : "Creating derived run";
    case "success":
      return isDerivedTable ? "Derived table ready" : "Derived run ready";
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

function computeJobTypeLabel(job: AnalysisComputeJobView): string {
  if (job.jobType === "table_rollup_derivation" || job.jobType === "selected_table_cut_derivation") {
    return "Session-only derived table";
  }
  return "Derived run";
}

function computeJobTitle(job: AnalysisComputeJobView): string {
  return job.proposedGroup?.groupName
    ?? job.proposedTableRollup?.sourceTables.map((table) => table.title).join(", ")
    ?? job.proposedSelectedTableCut?.sourceTable.title
    ?? "Derived table";
}

function isTerminalStatus(status: AnalysisComputeJobView["effectiveStatus"]): boolean {
  return status === "failed" || status === "cancelled" || status === "expired";
}

function terminalStatusLabel(status: AnalysisComputeJobView["effectiveStatus"]): string {
  if (status === "failed") return "Failed";
  if (status === "cancelled") return "Cancelled";
  if (status === "expired") return "Expired";
  return "Stopped";
}

function lifecycleStepState(params: {
  stepIndex: number;
  activeIndex: number;
  completedThroughIndex: number;
}): "complete" | "active" | "pending" {
  if (params.stepIndex <= params.completedThroughIndex) return "complete";
  if (params.stepIndex === params.activeIndex) return "active";
  return "pending";
}

function buildLifecycleSteps(job: AnalysisComputeJobView): Array<{
  key: string;
  label: string;
  state: "complete" | "active" | "pending";
  terminal?: boolean;
}> {
  const status = job.effectiveStatus;
  const terminal = isTerminalStatus(status);
  const reachedCompute = Boolean(job.confirmedAt || job.childRun);
  const activeIndex = (() => {
    if (status === "proposed" || status === "needs_clarification") return 0;
    if (status === "confirmed") return 1;
    if (status === "queued" || status === "running") return 2;
    return 3;
  })();
  const completedThroughIndex = terminal
    ? (reachedCompute ? 2 : 0)
    : activeIndex - 1;
  const computeLabel = status === "running" ? "Computing" : "Queued";
  const readyLabel = terminal ? terminalStatusLabel(status) : "Ready";
  const labels = ["Proposed", "Confirmed", computeLabel, readyLabel];

  return labels.map((label, index) => ({
    key: `${index}-${label}`,
    label,
    state: lifecycleStepState({ stepIndex: index, activeIndex, completedThroughIndex }),
    ...(terminal && index === activeIndex ? { terminal: true } : {}),
  }));
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
  const isTableRollup = job.jobType === "table_rollup_derivation";
  const isSelectedTableCut = job.jobType === "selected_table_cut_derivation";
  const isDerivedTable = isTableRollup || isSelectedTableCut;
  const showProgress = (job.childRun || isDerivedTable) && (job.effectiveStatus === "queued" || job.effectiveStatus === "running");
  const childRunProgress = job.childRun?.progress;
  const progress = typeof childRunProgress === "number"
    ? Math.max(0, Math.min(100, childRunProgress))
    : null;
  const lifecycleSteps = buildLifecycleSteps(job);
  const title = computeJobTitle(job);
  const typeLabel = computeJobTypeLabel(job);
  const showArtifactSaved = isDerivedTable && job.effectiveStatus === "success" && Boolean(job.derivedArtifactId);

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
              {title}
            </h3>
          </div>
          <div className="shrink-0 rounded-full border border-border/70 px-2 py-1 text-[11px] text-muted-foreground">
            {typeLabel}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-4 gap-1.5 text-[11px]">
          {lifecycleSteps.map((step) => (
            <div
              key={step.key}
              className={cn(
                "min-w-0 rounded-md border px-2 py-1.5 text-center font-medium",
                step.state === "complete" && "border-ct-emerald/25 bg-ct-emerald-dim text-ct-emerald",
                step.state === "active" && !step.terminal && "border-ct-blue/30 bg-ct-blue-dim text-ct-blue",
                step.state === "active" && step.terminal && "border-ct-red/30 bg-ct-red-dim text-ct-red",
                step.state === "pending" && "border-border/60 bg-muted/15 text-muted-foreground",
              )}
            >
              <span className="block truncate">{step.label}</span>
            </div>
          ))}
        </div>

        <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-foreground/85 [overflow-wrap:anywhere]">
          {job.requestText}
        </p>

        {isDerivedTable ? (
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            TabulateAI will add this derived table to the current analysis session only.
          </p>
        ) : null}

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

        {job.proposedTableRollup ? (
          <div className="mt-3 space-y-2">
            {job.proposedTableRollup.sourceTables.map((table) => (
              <div
                key={`${job.id}-${table.tableId}`}
                className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2"
              >
                <p className="text-sm font-medium text-foreground">{table.title}</p>
                {table.questionText ? (
                  <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{table.questionText}</p>
                ) : null}
                <div className="mt-2 space-y-2">
                  {table.rollups.map((rollup) => (
                    <div key={`${table.tableId}-${rollup.label}`} className="rounded-md bg-background/70 px-2 py-2">
                      <p className="text-xs font-medium text-foreground">{rollup.label}</p>
                      <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                        Combines {rollup.components.map((component) => component.label).join(", ")}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        {job.proposedSelectedTableCut ? (
          <div className="mt-3 space-y-2">
            <div className="rounded-lg border border-border/60 bg-muted/15 px-3 py-2">
              <p className="text-sm font-medium text-foreground">{job.proposedSelectedTableCut.sourceTable.title}</p>
              {job.proposedSelectedTableCut.sourceTable.questionText ? (
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{job.proposedSelectedTableCut.sourceTable.questionText}</p>
              ) : null}
              <div className="mt-2 rounded-md bg-background/70 px-2 py-2">
                <p className="text-xs font-medium text-foreground">{job.proposedSelectedTableCut.groupName}</p>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                  Adds {job.proposedSelectedTableCut.cuts.map((cut) => cut.name).join(", ")}
                </p>
              </div>
              <div className="mt-2 space-y-2">
                {job.proposedSelectedTableCut.cuts.map((cut) => (
                  <div key={`${job.id}-${cut.name}`} className="rounded-md bg-background/70 px-2 py-2">
                    <p className="text-xs font-medium text-foreground">{cut.name}</p>
                    <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                      {cut.userSummary ?? cut.original}
                    </p>
                  </div>
                ))}
              </div>
            </div>
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
            {progress !== null ? <Progress value={progress} className="h-1.5" /> : null}
            {progress === null && job.effectiveStatus === "running" ? (
              <div className="h-1.5 overflow-hidden rounded-full bg-primary/15">
                <div className="h-full w-1/3 animate-pulse rounded-full bg-ct-blue/70" />
              </div>
            ) : null}
            <p className="text-xs leading-5 text-muted-foreground">
              {job.childRun?.message ?? (job.effectiveStatus === "queued"
                ? "Queued for worker pickup."
                : isDerivedTable
                  ? "Computing the derived table."
                  : "Running compute for the derived run.")}
            </p>
          </div>
        ) : null}

        {job.effectiveStatus === "success" ? (
          <div className="mt-3 rounded-lg border border-ct-emerald/25 bg-ct-emerald-dim px-3 py-2 text-xs leading-5 text-foreground/85">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {isDerivedTable
                  ? "Derived table added to this analysis session."
                  : "Child run ready for analysis."}
              </span>
              {showArtifactSaved ? (
                <span className="rounded-full border border-ct-emerald/30 px-2 py-0.5 text-[11px] font-medium text-ct-emerald">
                  Artifact saved
                </span>
              ) : null}
            </div>
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
              Confirm compute
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
