import { NextRequest, NextResponse } from "next/server";

import { abortRun, cleanupAbort } from "@/lib/abortStore";
import { getConvexClient, mutateInternal, queryInternal } from "@/lib/convex";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api, internal } from "../../../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

function routeErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    return error.message;
  }
  return fallback;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; jobId: string }> },
) {
  try {
    const { runId, jobId } = await params;
    if (!runId || !jobId || !CONVEX_ID_RE.test(runId) || !CONVEX_ID_RE.test(jobId)) {
      return NextResponse.json({ error: "Invalid run or job ID" }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), "high", "runs/analysis/compute/cancel");
    if (rateLimited) return rateLimited;

    const convex = getConvexClient();
    const [run, job] = await Promise.all([
      convex.query(api.runs.get, {
        runId: runId as Id<"runs">,
        orgId: auth.convexOrgId,
      }),
      queryInternal(internal.analysisComputeJobs.getById, {
        orgId: auth.convexOrgId,
        jobId: jobId as Id<"analysisComputeJobs">,
      }),
    ]);

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!job || String(job.parentRunId) !== runId) {
      return NextResponse.json({ error: "Analysis compute job not found" }, { status: 404 });
    }

    const result = await mutateInternal(internal.analysisComputeJobs.cancelJob, {
      orgId: auth.convexOrgId,
      jobId: job._id,
      parentRunId: run._id,
    });

    const childRunId = result.childRunId ? String(result.childRunId) : null;
    const shouldAbortChild = childRunId && !result.alreadyTerminal;
    const localAbort = shouldAbortChild ? abortRun(childRunId) : false;
    if (shouldAbortChild) cleanupAbort(childRunId);

    return NextResponse.json({
      accepted: true,
      status: result.status,
      alreadyTerminal: result.alreadyTerminal,
      childRunId,
      localAbort,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: routeErrorMessage(error, "Cancellation failed") }, { status: 500 });
  }
}
