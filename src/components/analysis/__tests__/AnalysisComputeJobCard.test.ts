import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AnalysisComputeJobCard } from "@/components/analysis/AnalysisComputeJobCard";
import type { AnalysisComputeJobView } from "@/lib/analysis/computeLane/jobView";

const noop = async () => {};

function renderCard(job: AnalysisComputeJobView) {
  return renderToStaticMarkup(
    React.createElement(AnalysisComputeJobCard, {
      job,
      onConfirm: noop,
      onCancel: noop,
      onContinue: noop,
      onRevise: () => {},
    }),
  );
}

function lifecycleStepClass(markup: string, label: string): string {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = markup.match(
    new RegExp(`<div class="([^"]*)"><span class="block truncate">${escapedLabel}</span></div>`),
  );
  if (!match?.[1]) {
    throw new Error(`Lifecycle step not found: ${label}`);
  }
  return match[1];
}

function expectLifecycleStepState(
  markup: string,
  label: string,
  state: "complete" | "active" | "pending" | "terminal",
) {
  const className = lifecycleStepClass(markup, label);
  if (state === "complete") {
    expect(className).toContain("bg-ct-emerald-dim");
    return;
  }
  if (state === "active") {
    expect(className).toContain("bg-ct-blue-dim");
    return;
  }
  if (state === "terminal") {
    expect(className).toContain("bg-ct-red-dim");
    return;
  }
  expect(className).toContain("bg-muted/15");
}

const baseJob: AnalysisComputeJobView = {
  id: "job-1",
  jobType: "banner_extension_recompute",
  status: "proposed",
  effectiveStatus: "proposed",
  requestText: "Add region cuts",
  confirmToken: "opaque-token",
  proposedGroup: {
    groupName: "Region",
    cuts: [{
      name: "North",
      original: "REGION=1",
      userSummary: "Matched the region variable.",
      confidence: 0.96,
      expressionType: "direct_variable",
      rawExpression: "REGION == 1",
    }],
  },
  reviewFlags: {
    requiresClarification: false,
    requiresReview: false,
    reasons: [],
    averageConfidence: 0.96,
    policyFallbackDetected: false,
  },
  createdAt: 100,
  updatedAt: 110,
};

describe("AnalysisComputeJobCard", () => {
  it("renders a proposal with summaries first and raw expressions hidden by default", () => {
    const markup = renderCard(baseJob);

    expect(markup).toContain("Proposal ready");
    expect(markup).toContain("Region");
    expect(markup).toContain("North");
    expect(markup).toContain("Matched the region variable.");
    expect(markup).toContain("Proposed");
    expect(markup).toContain("Confirmed");
    expect(markup).toContain("Queued");
    expect(markup).toContain("Ready");
    expect(markup).toContain("Confirm compute");
    expect(markup).not.toContain("REGION == 1");
  });

  it("disables confirmation for clarification-blocked jobs", () => {
    const markup = renderCard({
      ...baseJob,
      status: "needs_clarification",
      effectiveStatus: "needs_clarification",
      confirmToken: undefined,
      reviewFlags: {
        requiresClarification: true,
        requiresReview: true,
        reasons: ["Which region definition should TabulateAI use?"],
        averageConfidence: 0.2,
        policyFallbackDetected: false,
      },
    });

    expect(markup).toContain("Needs clarification");
    expect(markup).toContain("Which region definition should TabulateAI use?");
    expect(markup).toContain("Revise request");
    expect(markup).not.toContain("Confirm compute");
  });

  it("renders queued and running child run status", () => {
    const markup = renderCard({
      ...baseJob,
      status: "queued",
      effectiveStatus: "running",
      confirmToken: undefined,
      childRun: {
        id: "child-run-1",
        status: "in_progress",
        executionState: "running",
        stage: "v3_compute",
        progress: 55,
        message: "Running compute for derived run...",
        analysisUrl: "/projects/project-1/runs/child-run-1/analysis",
      },
    });

    expect(markup).toContain("Creating derived run");
    expect(markup).toContain("Computing");
    expect(markup).toContain("Running compute for derived run...");
    expect(markup).toContain("data-slot=\"progress\"");
  });

  it("represents confirmed, queued, and running lifecycle stages distinctly", () => {
    const confirmedMarkup = renderCard({
      ...baseJob,
      status: "confirmed",
      effectiveStatus: "confirmed",
      confirmToken: undefined,
      confirmedAt: 120,
    });
    expectLifecycleStepState(confirmedMarkup, "Proposed", "complete");
    expectLifecycleStepState(confirmedMarkup, "Confirmed", "active");
    expectLifecycleStepState(confirmedMarkup, "Queued", "pending");
    expectLifecycleStepState(confirmedMarkup, "Ready", "pending");

    const queuedMarkup = renderCard({
      ...baseJob,
      status: "queued",
      effectiveStatus: "queued",
      confirmToken: undefined,
      confirmedAt: 120,
    });
    expectLifecycleStepState(queuedMarkup, "Proposed", "complete");
    expectLifecycleStepState(queuedMarkup, "Confirmed", "complete");
    expectLifecycleStepState(queuedMarkup, "Queued", "active");
    expectLifecycleStepState(queuedMarkup, "Ready", "pending");

    const runningMarkup = renderCard({
      ...baseJob,
      status: "queued",
      effectiveStatus: "running",
      confirmToken: undefined,
      confirmedAt: 120,
    });
    expectLifecycleStepState(runningMarkup, "Proposed", "complete");
    expectLifecycleStepState(runningMarkup, "Confirmed", "complete");
    expectLifecycleStepState(runningMarkup, "Computing", "active");
    expectLifecycleStepState(runningMarkup, "Ready", "pending");
  });

  it("renders completed, failed, cancelled, and expired recovery states", () => {
    const completedMarkup = renderCard({
      ...baseJob,
      status: "success",
      effectiveStatus: "success",
      confirmToken: undefined,
      childRun: {
        id: "child-run-1",
        status: "success",
        analysisUrl: "/projects/project-1/runs/child-run-1/analysis",
      },
    });
    expect(completedMarkup).toContain("Child run ready for analysis.");
    expect(completedMarkup).toContain("Continue in derived run");

    const failedMarkup = renderCard({
      ...baseJob,
      status: "failed",
      effectiveStatus: "failed",
      confirmToken: undefined,
      error: "Worker failed",
    });
    expect(failedMarkup).toContain("Failed");
    expect(failedMarkup).toContain("Revise request");

    expect(renderCard({
      ...baseJob,
      status: "cancelled",
      effectiveStatus: "cancelled",
      confirmToken: undefined,
    })).toContain("Cancelled");

    expect(renderCard({
      ...baseJob,
      status: "expired",
      effectiveStatus: "expired",
      confirmToken: undefined,
    })).toContain("Expired");
  });

  it("does not mark confirmed or queued complete for terminal jobs that stopped before confirmation", () => {
    const cancelledProposalMarkup = renderCard({
      ...baseJob,
      status: "cancelled",
      effectiveStatus: "cancelled",
      confirmToken: undefined,
    });
    expectLifecycleStepState(cancelledProposalMarkup, "Proposed", "complete");
    expectLifecycleStepState(cancelledProposalMarkup, "Confirmed", "pending");
    expectLifecycleStepState(cancelledProposalMarkup, "Queued", "pending");
    expectLifecycleStepState(cancelledProposalMarkup, "Cancelled", "terminal");

    const expiredProposalMarkup = renderCard({
      ...baseJob,
      status: "proposed",
      effectiveStatus: "expired",
      confirmToken: undefined,
    });
    expectLifecycleStepState(expiredProposalMarkup, "Proposed", "complete");
    expectLifecycleStepState(expiredProposalMarkup, "Confirmed", "pending");
    expectLifecycleStepState(expiredProposalMarkup, "Queued", "pending");
    expectLifecycleStepState(expiredProposalMarkup, "Expired", "terminal");
  });

  it("marks reached compute stages complete for terminal jobs after confirmation", () => {
    const failedAfterConfirmMarkup = renderCard({
      ...baseJob,
      status: "failed",
      effectiveStatus: "failed",
      confirmToken: undefined,
      confirmedAt: 120,
      error: "Worker failed",
    });

    expectLifecycleStepState(failedAfterConfirmMarkup, "Proposed", "complete");
    expectLifecycleStepState(failedAfterConfirmMarkup, "Confirmed", "complete");
    expectLifecycleStepState(failedAfterConfirmMarkup, "Queued", "complete");
    expectLifecycleStepState(failedAfterConfirmMarkup, "Failed", "terminal");
  });

  it("renders a derived-table proposal without derived-run continuation", () => {
    const markup = renderCard({
      id: "job-rollup-1",
      jobType: "table_rollup_derivation",
      status: "proposed",
      effectiveStatus: "proposed",
      requestText: "Create Top 2 Box on Q1",
      confirmToken: "rollup-token",
      proposedTableRollup: {
        sourceTables: [{
          tableId: "q1",
          title: "Q1 Satisfaction",
          questionText: "How satisfied are you?",
          rollups: [{
            label: "Top 2 Box",
            components: [
              { rowKey: "row_4", label: "Somewhat satisfied" },
              { rowKey: "row_5", label: "Very satisfied" },
            ],
          }],
        }],
      },
      createdAt: 100,
      updatedAt: 110,
    });

    expect(markup).toContain("Session-only derived table");
    expect(markup).toContain("TabulateAI will add this derived table to the current analysis session only.");
    expect(markup).toContain("Q1 Satisfaction");
    expect(markup).toContain("Top 2 Box");
    expect(markup).toContain("Somewhat satisfied, Very satisfied");
    expect(markup).toContain("Confirm compute");
    expect(markup).not.toContain("Continue in derived run");
  });

  it("renders table-scoped success with artifact traceability", () => {
    const markup = renderCard({
      id: "job-rollup-1",
      jobType: "table_rollup_derivation",
      status: "success",
      effectiveStatus: "success",
      requestText: "Create Top 2 Box on Q1",
      derivedArtifactId: "artifact-1",
      proposedTableRollup: {
        sourceTables: [{
          tableId: "q1",
          title: "Q1 Satisfaction",
          questionText: "How satisfied are you?",
          rollups: [{
            label: "Top 2 Box",
            components: [
              { rowKey: "row_4", label: "Somewhat satisfied" },
              { rowKey: "row_5", label: "Very satisfied" },
            ],
          }],
        }],
      },
      createdAt: 100,
      updatedAt: 110,
      completedAt: 150,
    });

    expect(markup).toContain("Derived table added to this analysis session.");
    expect(markup).toContain("Artifact saved");
    expect(markup).not.toContain("artifact-1");
    expect(markup).not.toContain("Continue in derived run");
  });

  it("renders table-scoped running status without fake determinate progress", () => {
    const markup = renderCard({
      id: "job-rollup-1",
      jobType: "table_rollup_derivation",
      status: "running",
      effectiveStatus: "running",
      requestText: "Create Top 2 Box on Q1",
      proposedTableRollup: {
        sourceTables: [{
          tableId: "q1",
          title: "Q1 Satisfaction",
          questionText: "How satisfied are you?",
          rollups: [{
            label: "Top 2 Box",
            components: [
              { rowKey: "row_4", label: "Somewhat satisfied" },
              { rowKey: "row_5", label: "Very satisfied" },
            ],
          }],
        }],
      },
      createdAt: 100,
      updatedAt: 110,
    });

    expect(markup).toContain("Creating derived table");
    expect(markup).toContain("Computing");
    expect(markup).toContain("Computing the derived table.");
    expect(markup).not.toContain("data-slot=\"progress\"");
  });
});
