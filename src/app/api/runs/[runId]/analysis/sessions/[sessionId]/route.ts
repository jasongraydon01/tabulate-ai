import { NextRequest, NextResponse } from "next/server";

import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { getApiErrorDetails } from "@/lib/api/errorDetails";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api, internal } from "../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

async function loadOwnedSession({
  orgId,
  sessionId,
}: {
  orgId: Id<"organizations">;
  sessionId: string;
}) {
  const convex = getConvexClient();
  return convex.query(api.analysisSessions.getById, {
    orgId,
    sessionId: sessionId as Id<"analysisSessions">,
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; sessionId: string }> },
) {
  try {
    const { runId, sessionId } = await params;
    if (!runId || !CONVEX_ID_RE.test(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    if (!sessionId || !CONVEX_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(
      String(auth.convexOrgId),
      "low",
      "runs/analysis/sessions/update",
    );
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => ({})) as { title?: unknown };
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) {
      return NextResponse.json({ error: "Session title is required" }, { status: 400 });
    }
    if (title.length > 120) {
      return NextResponse.json({ error: "Session title is too long" }, { status: 400 });
    }

    const session = await loadOwnedSession({
      orgId: auth.convexOrgId,
      sessionId,
    });
    if (!session || String(session.runId) !== runId) {
      return NextResponse.json({ error: "Analysis session not found" }, { status: 404 });
    }

    await mutateInternal(internal.analysisSessions.rename, {
      orgId: auth.convexOrgId,
      sessionId: session._id,
      title,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Analysis Session PATCH] Error:", error);
    return NextResponse.json(
      { error: "Failed to update analysis session", details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string; sessionId: string }> },
) {
  try {
    const { runId, sessionId } = await params;
    if (!runId || !CONVEX_ID_RE.test(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    if (!sessionId || !CONVEX_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(
      String(auth.convexOrgId),
      "low",
      "runs/analysis/sessions/delete",
    );
    if (rateLimited) return rateLimited;

    const session = await loadOwnedSession({
      orgId: auth.convexOrgId,
      sessionId,
    });
    if (!session || String(session.runId) !== runId) {
      return NextResponse.json({ error: "Analysis session not found" }, { status: 404 });
    }

    await mutateInternal(internal.analysisSessions.deleteCascade, {
      orgId: auth.convexOrgId,
      sessionId: session._id,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Analysis Session DELETE] Error:", error);
    return NextResponse.json(
      { error: "Failed to delete analysis session", details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
