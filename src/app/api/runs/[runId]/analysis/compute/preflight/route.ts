import { NextRequest, NextResponse } from "next/server";

import { loadAnalysisGroundingContext } from "@/lib/analysis/grounding";
import { loadAnalysisParentRunArtifacts } from "@/lib/analysis/computeLane/artifactLoader";
import { runAnalysisBannerExtensionPreflight } from "@/lib/analysis/computeLane/preflight";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { requireConvexAuth } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { resolvePipelineOutputDir } from "@/lib/paths/outputs";
import { sanitizeDatasetName } from "@/lib/api/fileHandler";
import { api, internal } from "../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

function routeErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function formatProposedGroupMessage(params: {
  groupName: string;
  columns: Array<{ name: string; original: string; adjusted?: string; confidence?: number }>;
  requiresClarification: boolean;
  reasons: string[];
}): string {
  if (params.requiresClarification) {
    return [
      "TabulateAI needs one clarification before creating a derived run.",
      ...params.reasons.map((reason) => `- ${reason}`),
    ].join("\n");
  }

  return [
    `TabulateAI found a proposed banner extension: ${params.groupName}.`,
    "",
    ...params.columns.map((column) => {
      const confidence = typeof column.confidence === "number" ? ` (${Math.round(column.confidence * 100)}% confidence)` : "";
      return `- ${column.name}: ${column.adjusted ?? column.original}${confidence}`;
    }),
    "",
    "Confirm this group to create a derived run. The original run will remain unchanged.",
  ].join("\n");
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> },
) {
  try {
    const { runId } = await params;
    if (!runId || !CONVEX_ID_RE.test(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), "high", "runs/analysis/compute/preflight");
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => null) as {
      sessionId?: unknown;
      requestText?: unknown;
    } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    const requestText = typeof body?.requestText === "string" ? body.requestText.trim() : "";
    if (!sessionId || !CONVEX_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    if (!requestText) {
      return NextResponse.json({ error: "Request text is required" }, { status: 400 });
    }

    const convex = getConvexClient();
    const [run, session] = await Promise.all([
      convex.query(api.runs.get, {
        runId: runId as Id<"runs">,
        orgId: auth.convexOrgId,
      }),
      convex.query(api.analysisSessions.getById, {
        orgId: auth.convexOrgId,
        sessionId: sessionId as Id<"analysisSessions">,
      }),
    ]);

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!session || String(session.runId) !== runId) {
      return NextResponse.json({ error: "Analysis session not found" }, { status: 404 });
    }
    if (run.status !== "success" && run.status !== "partial") {
      return NextResponse.json({ error: "Analysis compute requires a completed parent run" }, { status: 409 });
    }

    const project = await convex.query(api.projects.get, {
      projectId: session.projectId,
      orgId: auth.convexOrgId,
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const [groundingContext, parentArtifacts] = await Promise.all([
      loadAnalysisGroundingContext({
        runResultValue: run.result,
        projectName: project.name,
        runStatus: run.status,
        projectConfig: project.config,
        projectIntake: project.intake,
      }),
      loadAnalysisParentRunArtifacts(run.result),
    ]);

    const preflightOutputDir = resolvePipelineOutputDir({
      datasetName: sanitizeDatasetName(`analysis-preflight-${String(run._id)}`),
      pipelineId: `preflight-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    });

    const preflight = await runAnalysisBannerExtensionPreflight({
      parentRunId: runId,
      requestText,
      groundingContext,
      parentArtifacts,
      outputDir: preflightOutputDir,
      abortSignal: request.signal,
    });

    const jobId = await mutateInternal(internal.analysisComputeJobs.createFromPreflight, {
      orgId: auth.convexOrgId,
      projectId: session.projectId,
      parentRunId: run._id,
      sessionId: session._id,
      requestedBy: auth.convexUserId,
      requestText,
      status: preflight.reviewFlags.requiresClarification ? "needs_clarification" : "proposed",
      frozenBannerGroup: preflight.frozenBannerGroup,
      frozenValidatedGroup: preflight.frozenValidatedGroup,
      reviewFlags: preflight.reviewFlags,
      fingerprint: preflight.fingerprint,
      promptSummary: preflight.promptSummary,
    });

    const message = formatProposedGroupMessage({
      groupName: preflight.frozenBannerGroup.groupName,
      columns: preflight.frozenBannerGroup.columns.map((column) => {
        const validated = preflight.frozenValidatedGroup.columns.find((entry) => entry.name === column.name);
        return {
          name: column.name,
          original: column.original,
          adjusted: validated?.adjusted,
          confidence: validated?.confidence,
        };
      }),
      requiresClarification: preflight.reviewFlags.requiresClarification,
      reasons: preflight.reviewFlags.reasons,
    });

    await mutateInternal(internal.analysisMessages.create, {
      sessionId: session._id,
      orgId: auth.convexOrgId,
      role: "assistant",
      content: message,
      parts: [{ type: "text", text: message }],
    });

    return NextResponse.json({
      jobId: String(jobId),
      status: preflight.reviewFlags.requiresClarification ? "needs_clarification" : "proposed",
      fingerprint: preflight.fingerprint,
      proposedGroup: preflight.frozenBannerGroup,
      validatedGroup: preflight.frozenValidatedGroup,
      reviewFlags: preflight.reviewFlags,
    });
  } catch (error) {
    return NextResponse.json({ error: routeErrorMessage(error, "Preflight failed") }, { status: 500 });
  }
}
