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
    expect(markup).toContain("Confirm");
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
    expect(markup).not.toContain(">Confirm<");
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
    expect(markup).toContain("Running compute for derived run...");
  });

  it("renders completed, failed, cancelled, and expired recovery states", () => {
    expect(renderCard({
      ...baseJob,
      status: "success",
      effectiveStatus: "success",
      confirmToken: undefined,
      childRun: {
        id: "child-run-1",
        status: "success",
        analysisUrl: "/projects/project-1/runs/child-run-1/analysis",
      },
    })).toContain("Continue in derived run");

    expect(renderCard({
      ...baseJob,
      status: "failed",
      effectiveStatus: "failed",
      confirmToken: undefined,
      error: "Worker failed",
    })).toContain("Revise request");

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

    expect(markup).toContain("Derived table");
    expect(markup).toContain("Q1 Satisfaction");
    expect(markup).toContain("Top 2 Box");
    expect(markup).toContain("Somewhat satisfied, Very satisfied");
    expect(markup).toContain("Confirm");
    expect(markup).not.toContain("Continue in derived run");
  });
});
