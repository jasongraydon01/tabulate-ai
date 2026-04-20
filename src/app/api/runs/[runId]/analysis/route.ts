import { NextRequest, NextResponse } from "next/server";
import { type UIMessage } from "ai";

import { getApiErrorDetails } from "@/lib/api/errorDetails";
import { streamAnalysisResponse } from "@/lib/analysis/AnalysisAgent";
import { loadAnalysisGroundingContext } from "@/lib/analysis/grounding";
import {
  getAnalysisUIMessageText,
  persistedAnalysisMessagesToUIMessages,
  sanitizeAnalysisMessageContent,
} from "@/lib/analysis/messages";
import {
  buildPersistedAnalysisParts,
  type PersistedAnalysisPart,
} from "@/lib/analysis/persistence";
import {
  writeAnalysisTurnErrorTrace,
  writeAnalysisTurnTrace,
} from "@/lib/analysis/trace";
import { TABLE_CARD_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { api, internal } from "../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;

function isAnalysisMessageCandidate(value: unknown): value is UIMessage[] {
  return Array.isArray(value);
}

type PersistedPartForCreate = PersistedAnalysisPart & {
  artifactId?: Id<"analysisArtifacts">;
};

async function persistAssistantMessageParts(params: {
  parts: UIMessage["parts"];
  sessionId: Id<"analysisSessions">;
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  runId: Id<"runs">;
  createdBy: Id<"users">;
}): Promise<PersistedPartForCreate[]> {
  const pending = buildPersistedAnalysisParts(params.parts);
  const persistedParts: PersistedPartForCreate[] = [];

  for (const entry of pending) {
    if (entry.kind === "ready") {
      persistedParts.push(entry.part);
      continue;
    }

    const artifactId = await mutateInternal(internal.analysisArtifacts.create, {
      sessionId: params.sessionId,
      orgId: params.orgId,
      projectId: params.projectId,
      runId: params.runId,
      artifactType: "table_card",
      sourceClass: "from_tabs",
      title: entry.artifact.title,
      sourceTableIds: [entry.artifact.tableId],
      sourceQuestionIds: entry.artifact.questionId ? [entry.artifact.questionId] : [],
      payload: entry.artifact.payload,
      createdBy: params.createdBy,
    });

    persistedParts.push({
      type: TABLE_CARD_TOOL_TYPE,
      state: entry.template.state,
      artifactId,
      label: entry.template.label,
    });
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

    const project = await convex.query(api.projects.get, {
      projectId: session.projectId,
      orgId: auth.convexOrgId,
    });
    if (!project) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
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
          toolCallId: part.toolCallId,
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

    const groundingContext = await loadAnalysisGroundingContext({
      runResultValue: run.result,
      projectName: project.name,
      runStatus: run.status,
      projectConfig: project.config,
      projectIntake: project.intake,
    });

    const { streamResult, getTraceCapture } = await streamAnalysisResponse({
      messages: conversationMessages,
      groundingContext,
      abortSignal: request.signal,
    });

    let errorTraceWritten = false;

    return streamResult.toUIMessageStreamResponse({
      originalMessages: conversationMessages,
      sendReasoning: true,
      onError: (error) => {
        console.error("[Analysis Chat POST] Stream error:", error);
        if (!errorTraceWritten) {
          errorTraceWritten = true;
          const createdAt = new Date().toISOString();
          void writeAnalysisTurnErrorTrace({
            runResultValue: run.result,
            orgId: String(auth.convexOrgId),
            projectId: String(session.projectId),
            runId: String(session.runId),
            sessionId: String(session._id),
            sessionTitle: session.title,
            createdAt,
            latestUserPrompt: latestUserText,
            errorMessage: error instanceof Error ? error.message : String(error),
            traceCapture: getTraceCapture(),
          }).catch((traceError) => {
            console.warn("[Analysis Chat POST] Failed to write analysis error trace:", traceError);
          });
        }
        return "Analysis response failed. Please try again.";
      },
      onFinish: async ({ responseMessage, isAborted }) => {
        if (isAborted) return;

        const assistantText = sanitizeAnalysisMessageContent(getAnalysisUIMessageText(responseMessage));
        const traceCapture = getTraceCapture();
        const persistedParts = await persistAssistantMessageParts({
          parts: responseMessage.parts,
          sessionId: session._id,
          orgId: auth.convexOrgId,
          projectId: session.projectId,
          runId: session.runId,
          createdBy: auth.convexUserId,
        });
        if (!assistantText && persistedParts.length === 0) return;

        const createdAt = new Date().toISOString();
        const assistantMessageId = await mutateInternal(internal.analysisMessages.create, {
          sessionId: session._id,
          orgId: auth.convexOrgId,
          role: "assistant",
          content: assistantText,
          ...(persistedParts.length > 0 ? { parts: persistedParts } : {}),
          agentMetrics: {
            model: traceCapture.usage.model,
            inputTokens: traceCapture.usage.inputTokens,
            outputTokens: traceCapture.usage.outputTokens,
            durationMs: traceCapture.usage.durationMs,
          },
        });

        try {
          await writeAnalysisTurnTrace({
            runResultValue: run.result,
            orgId: String(auth.convexOrgId),
            projectId: String(session.projectId),
            runId: String(session.runId),
            sessionId: String(session._id),
            sessionTitle: session.title,
            messageId: String(assistantMessageId),
            createdAt,
            assistantText,
            responseParts: responseMessage.parts,
            traceCapture,
          });
        } catch (traceError) {
          console.warn("[Analysis Chat POST] Failed to write analysis turn trace:", traceError);
        }
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
