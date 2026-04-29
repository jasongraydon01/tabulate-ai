import { NextRequest, NextResponse } from "next/server";

import { getApiErrorDetails } from "@/lib/api/errorDetails";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api, internal } from "../../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;
const MAX_CORRECTION_TEXT_CHARS = 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; messageId: string }> },
) {
  try {
    const { runId, messageId } = await params;
    if (!runId || !CONVEX_ID_RE.test(runId)) {
      return NextResponse.json({ error: "Invalid run ID" }, { status: 400 });
    }
    if (!messageId || !CONVEX_ID_RE.test(messageId)) {
      return NextResponse.json({ error: "Invalid message ID" }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(
      String(auth.convexOrgId),
      "low",
      "runs/analysis/messages/feedback",
    );
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => ({})) as {
      sessionId?: unknown;
      vote?: unknown;
      correctionText?: unknown;
    };
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
    const isClear = body.vote === null;
    const vote: "up" | "down" | null = body.vote === "up" || body.vote === "down"
      ? body.vote
      : isClear ? null : null;
    const isValidVotePayload = body.vote === "up" || body.vote === "down" || isClear;
    const correctionText = typeof body.correctionText === "string"
      ? body.correctionText.trim()
      : "";

    if (!sessionId || !CONVEX_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }
    if (!isValidVotePayload) {
      return NextResponse.json({ error: "Invalid feedback vote" }, { status: 400 });
    }
    if (correctionText.length > MAX_CORRECTION_TEXT_CHARS) {
      return NextResponse.json({ error: "Feedback is too long" }, { status: 400 });
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

    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (!session || String(session.runId) !== runId) {
      return NextResponse.json({ error: "Analysis session not found" }, { status: 404 });
    }

    const sessionMessages = await convex.query(api.analysisMessages.listBySession, {
      orgId: auth.convexOrgId,
      sessionId: session._id,
    });
    const message = sessionMessages.find((entry) => String(entry._id) === messageId) ?? null;

    if (
      !message
      || String(message.sessionId) !== sessionId
      || message.role !== "assistant"
    ) {
      return NextResponse.json({ error: "Analysis message not found" }, { status: 404 });
    }

    if (vote === null) {
      await mutateInternal(internal.analysisMessageFeedback.clearByMessage, {
        orgId: auth.convexOrgId,
        sessionId: session._id,
        messageId: message._id,
        userId: auth.convexUserId,
      });

      return NextResponse.json({
        ok: true,
        feedback: null,
      });
    }

    await mutateInternal(internal.analysisMessageFeedback.upsert, {
      orgId: auth.convexOrgId,
      projectId: session.projectId,
      runId: session.runId,
      sessionId: session._id,
      messageId: message._id,
      userId: auth.convexUserId,
      vote,
      correctionText: vote === "down" && correctionText ? correctionText : null,
    });

    return NextResponse.json({
      ok: true,
      feedback: {
        messageId,
        vote,
        correctionText: vote === "down" && correctionText ? correctionText : null,
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Analysis Message Feedback POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to save message feedback", details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
