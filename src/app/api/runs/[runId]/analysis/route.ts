import { NextRequest, NextResponse } from "next/server";
import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";

import { getApiErrorDetails } from "@/lib/api/errorDetails";
import { streamAnalysisResponse } from "@/lib/analysis/AnalysisAgent";
import { loadAnalysisGroundingContext } from "@/lib/analysis/grounding";
import {
  getAnalysisUIMessageText,
  persistedAnalysisMessagesToUIMessages,
  sanitizeAnalysisMessageContent,
} from "@/lib/analysis/messages";
import { isAnalysisTableCard } from "@/lib/analysis/types";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api, internal } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

function isAnalysisMessageCandidate(value: unknown): value is UIMessage[] {
  return Array.isArray(value);
}

async function persistAssistantMessageParts(params: {
  parts: UIMessage["parts"];
  sessionId: Id<"analysisSessions">;
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  createdBy: Id<"users">;
}) {
  const persistedParts: Array<{
    type: string;
    text?: string;
    state?: string;
    artifactId?: Id<"analysisArtifacts">;
    label?: string;
  }> = [];

  for (const part of params.parts) {
    if (isTextUIPart(part)) {
      const text = sanitizeAnalysisMessageContent(part.text);
      if (text) {
        persistedParts.push({
          type: "text",
          text,
          ...(part.state ? { state: part.state } : {}),
        });
      }
      continue;
    }

    if (isToolUIPart(part) && part.type === "tool-getTableCard" && part.state === "output-available" && isAnalysisTableCard(part.output)) {
      const artifactId = await mutateInternal(internal.analysisArtifacts.create, {
        sessionId: params.sessionId,
        orgId: params.orgId,
        projectId: params.projectId,
        runId: params.runId,
        artifactType: "table_card",
        sourceClass: "from_tabs",
        title: part.output.title,
        sourceTableIds: [part.output.tableId],
        sourceQuestionIds: part.output.questionId ? [part.output.questionId] : [],
        payload: part.output,
        createdBy: params.createdBy,
      });

      persistedParts.push({
        type: "tool-getTableCard",
        state: part.state,
        artifactId,
        label: part.output.title,
      });
    }
  }

  return persistedParts;
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
    const rateLimited = applyRateLimit(String(auth.convexOrgId), "high", "runs/analysis/chat");
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => null) as {
      messages?: unknown;
      sessionId?: unknown;
    } | null;

    const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
    if (!sessionId || !CONVEX_ID_RE.test(sessionId)) {
      return NextResponse.json({ error: "Invalid session ID" }, { status: 400 });
    }

    const submittedMessages = isAnalysisMessageCandidate(body?.messages) ? body?.messages : [];
    const latestUserMessage = [...submittedMessages].reverse().find((message) => message.role === "user");
    const latestUserText = latestUserMessage
      ? sanitizeAnalysisMessageContent(getAnalysisUIMessageText(latestUserMessage))
      : "";
    if (!latestUserText) {
      return NextResponse.json({ error: "A user message is required" }, { status: 400 });
    }

    const convex = getConvexClient();
    const [run, session, persistedMessages, persistedArtifacts] = await Promise.all([
      convex.query(api.runs.get, {
        runId: runId as Id<"runs">,
        orgId: auth.convexOrgId,
      }),
      convex.query(api.analysisSessions.getById, {
        orgId: auth.convexOrgId,
        sessionId: sessionId as Id<"analysisSessions">,
      }),
      convex.query(api.analysisMessages.listBySession, {
        orgId: auth.convexOrgId,
        sessionId: sessionId as Id<"analysisSessions">,
      }),
      convex.query(api.analysisArtifacts.listBySession, {
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

    const lastPersistedMessage = persistedMessages[persistedMessages.length - 1];
    let conversationMessages = persistedAnalysisMessagesToUIMessages(
      persistedMessages.map((message) => ({
        _id: String(message._id),
        role: message.role,
        content: message.content,
        parts: message.parts?.map((part) => ({
          type: part.type,
          text: part.text,
          state: part.state,
          artifactId: part.artifactId ? String(part.artifactId) : undefined,
          label: part.label,
        })),
      })),
      persistedArtifacts.map((artifact) => ({
        _id: String(artifact._id),
        artifactType: artifact.artifactType,
        payload: artifact.payload,
      })),
    );

    if (
      !lastPersistedMessage
      || lastPersistedMessage.role !== "user"
      || lastPersistedMessage.content !== latestUserText
    ) {
      const userMessageId = await mutateInternal(internal.analysisMessages.create, {
        sessionId: session._id,
        orgId: auth.convexOrgId,
        role: "user",
        content: latestUserText,
      });

      conversationMessages = [
        ...conversationMessages,
        {
          id: String(userMessageId),
          role: "user",
          parts: [
            {
              type: "text",
              text: latestUserText,
            },
          ],
        },
      ];
    }

    const groundingContext = await loadAnalysisGroundingContext(run.result);

    const result = await streamAnalysisResponse({
      messages: conversationMessages,
      groundingContext,
      abortSignal: request.signal,
    });

    return result.toUIMessageStreamResponse({
      originalMessages: conversationMessages,
      sendReasoning: false,
      onError: (error) => {
        console.error("[Analysis Chat POST] Stream error:", error);
        return "Analysis response failed. Please try again.";
      },
      onFinish: async ({ responseMessage, isAborted }) => {
        if (isAborted) return;

        const assistantText = sanitizeAnalysisMessageContent(getAnalysisUIMessageText(responseMessage));
        const persistedParts = await persistAssistantMessageParts({
          parts: responseMessage.parts,
          sessionId: session._id,
          orgId: auth.convexOrgId,
          projectId: session.projectId,
          runId: session.runId,
          createdBy: auth.convexUserId,
        });
        if (!assistantText && persistedParts.length === 0) return;

        await mutateInternal(internal.analysisMessages.create, {
          sessionId: session._id,
          orgId: auth.convexOrgId,
          role: "assistant",
          content: assistantText,
          ...(persistedParts.length > 0 ? { parts: persistedParts } : {}),
        });
      },
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("[Analysis Chat POST] Error:", error);
    return NextResponse.json(
      { error: "Failed to generate analysis response", details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
