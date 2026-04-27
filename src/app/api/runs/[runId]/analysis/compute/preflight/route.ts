import { NextRequest, NextResponse } from "next/server";

import {
  AnalysisComputeProposalError,
  createAnalysisBannerExtensionProposal,
} from "@/lib/analysis/computeLane/proposalService";
import { getConvexClient } from "@/lib/convex";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api } from "../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

function createAnalysisClientTurnId(): string {
  return `turn-${crypto.randomUUID()}`;
}

function normalizeClientTurnId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || !CONVEX_ID_RE.test(trimmed)) return null;
  return trimmed;
}

function routeErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    return error.message;
  }
  return fallback;
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
      clientTurnId?: unknown;
    } | null;
    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    const requestText = typeof body?.requestText === "string" ? body.requestText.trim() : "";
    const clientTurnId = normalizeClientTurnId(body?.clientTurnId) ?? createAnalysisClientTurnId();
    if (!sessionId || !CONVEX_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    if (body?.clientTurnId !== undefined && !normalizeClientTurnId(body.clientTurnId)) {
      return NextResponse.json({ error: "Invalid client turn ID" }, { status: 400 });
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
    if (run.expiredAt || run.artifactsPurgedAt) {
      return NextResponse.json({ error: "Parent run artifacts have expired" }, { status: 410 });
    }

    const project = await convex.query(api.projects.get, {
      projectId: session.projectId,
      orgId: auth.convexOrgId,
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const result = await createAnalysisBannerExtensionProposal({
      orgId: auth.convexOrgId,
      projectId: session.projectId,
      parentRunId: run._id,
      sessionId: session._id,
      requestedBy: auth.convexUserId,
      requestText,
      parentRun: run,
      project,
      session,
      originClientTurnId: clientTurnId,
      transcriptMode: "route_breadcrumbs",
      abortSignal: request.signal,
    });

    return NextResponse.json({
      jobId: result.proposal.jobId,
      status: result.proposal.status,
      job: result.job,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (error instanceof AnalysisComputeProposalError) {
      return NextResponse.json(
        { error: routeErrorMessage(error, error.code === "preflight_failed" ? "Preflight failed" : error.message) },
        { status: error.httpStatus },
      );
    }
    return NextResponse.json({ error: routeErrorMessage(error, "Preflight failed") }, { status: 500 });
  }
}
