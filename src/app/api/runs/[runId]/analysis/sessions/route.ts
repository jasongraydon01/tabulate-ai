import { NextRequest, NextResponse } from "next/server";

import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { getApiErrorDetails } from "@/lib/api/errorDetails";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api, internal } from "../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

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
    const rateLimited = applyRateLimit(
      String(auth.convexOrgId),
      "low",
      "runs/analysis/sessions/create",
    );
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => ({})) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : undefined;
    if (title && title.length > 120) {
      return NextResponse.json({ error: "Session title is too long" }, { status: 400 });
    }

    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId,
    });
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const sessionId = await mutateInternal(internal.analysisSessions.create, {
      orgId: auth.convexOrgId,
      projectId: run.projectId,
      runId: run._id,
      createdBy: auth.convexUserId,
      ...(title ? { title } : {}),
    });

    return NextResponse.json({
      sessionId: String(sessionId),
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Analysis Sessions POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to create analysis session", details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
