import { NextRequest, NextResponse } from "next/server";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { getConvexClient } from "@/lib/convex";
import { api } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";
import { applyRateLimit } from "@/lib/withRateLimit";
import { getApiErrorDetails } from "@/lib/api/errorDetails";
import { parseRunResult } from "@/schemas/runResultSchema";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;
    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      return NextResponse.json({ error: "Run ID is required" }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), "low", "runs/quality");
    if (rateLimited) return rateLimited;

    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });
    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const evaluation = await convex.query(api.runEvaluations.getByRun, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId,
    });

    const runResult = parseRunResult(run.result);
    const quality = runResult?.quality ?? null;

    return NextResponse.json({
      runId,
      quality,
      evaluation,
    });
  } catch (error) {
    console.error("[RunQuality API] Error:", error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to load run quality", details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}
