import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
  streamAnalysisResponse: vi.fn(),
  loadAnalysisGroundingContext: vi.fn(async () => ({
    availability: "available",
    missingArtifacts: [],
    tables: {},
    questions: [],
    bannerGroups: [],
    bannerPlanGroups: [],
    bannerRouteMetadata: null,
    surveyMarkdown: null,
    surveyQuestions: [],
    projectContext: {
      projectName: "TabulateAI Study",
      runStatus: "success",
      studyMethodology: null,
      analysisMethod: null,
      bannerSource: null,
      bannerMode: null,
      tableCount: null,
      bannerGroupCount: null,
      totalCuts: null,
      bannerGroupNames: [],
      researchObjectives: null,
      bannerHints: null,
      intakeFiles: {
        dataFile: null,
        survey: null,
        bannerPlan: null,
        messageList: null,
      },
    },
    tablesMetadata: {
      significanceTest: null,
      significanceLevel: null,
      comparisonGroups: [],
    },
  })),
  requireConvexAuth: vi.fn(async () => ({
    convexOrgId: "org-1",
    convexUserId: "user-1",
    role: "admin",
  })),
  generateAnalysisSessionTitle: vi.fn(async () => "Brand Attribute Comparison"),
  writeAnalysisTurnTrace: vi.fn(async () => "agents/analysis/sessions/session-1/turn-1.json"),
  writeAnalysisTurnErrorTrace: vi.fn(async () => "agents/analysis/sessions/session-1/turn-error.json"),
}));

vi.mock("@/lib/requireConvexAuth", () => ({
  requireConvexAuth: mocks.requireConvexAuth,
  AuthenticationError: class AuthenticationError extends Error {},
}));

vi.mock("@/lib/withRateLimit", () => ({
  applyRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/convex", () => ({
  getConvexClient: () => ({ query: mocks.query }),
  mutateInternal: mocks.mutateInternal,
}));

vi.mock("@/lib/analysis/AnalysisAgent", () => ({
  streamAnalysisResponse: mocks.streamAnalysisResponse,
}));

vi.mock("@/lib/analysis/grounding", () => ({
  loadAnalysisGroundingContext: mocks.loadAnalysisGroundingContext,
}));

vi.mock("@/lib/analysis/trace", () => ({
  writeAnalysisTurnTrace: mocks.writeAnalysisTurnTrace,
  writeAnalysisTurnErrorTrace: mocks.writeAnalysisTurnErrorTrace,
}));

vi.mock("@/lib/analysis/title", () => ({
  generateAnalysisSessionTitle: mocks.generateAnalysisSessionTitle,
  isDefaultAnalysisSessionTitle: (value: string) => /^Analysis Session \d+$/.test(value.trim()),
}));

function makeTraceCapture(overrides: Partial<{
  usage: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    estimatedCostUsd: number;
  };
  scratchpadEntries: unknown[];
  retryEvents: unknown[];
  retryAttempts: number;
  finalClassification: string | null;
  terminalError: string | null;
}> = {}) {
  return {
    usage: {
      model: "gpt-analysis",
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      durationMs: 850,
      estimatedCostUsd: 0.0123,
      ...(overrides.usage ?? {}),
    },
    scratchpadEntries: overrides.scratchpadEntries ?? [],
    retryEvents: overrides.retryEvents ?? [],
    retryAttempts: overrides.retryAttempts ?? 1,
    finalClassification: overrides.finalClassification ?? null,
    terminalError: overrides.terminalError ?? null,
  };
}

function makeStreamResult(options: {
  responseMessage?: { parts: Array<Record<string, unknown>> };
  onError?: Error;
}) {
  return {
    toUIMessageStreamResponse: ({ onFinish, onError }: {
      onFinish?: (event: {
        responseMessage: { parts: Array<Record<string, unknown>> };
        isAborted: boolean;
      }) => Promise<void>;
      onError?: (error: Error) => string;
    }) => {
      if (options.onError) {
        onError?.(options.onError);
      }
      if (options.responseMessage) {
        void onFinish?.({
          responseMessage: options.responseMessage,
          isAborted: false,
        });
      }
      return new Response("stream");
    },
  };
}

describe("analysis chat route", () => {
  let POST: typeof import("@/app/api/runs/[runId]/analysis/route").POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import("@/app/api/runs/[runId]/analysis/route"));
    }
    vi.clearAllMocks();
  });

  it("returns 400 when the session id is missing", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid session ID" });
  });

  it("returns 404 when the session is not attached to the run", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-2" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Analysis session not found" });
  });

  it("persists the user and assistant messages around a streamed response", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1", result: {} })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1", title: "Audit Session", titleSource: "manual" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal.mockResolvedValueOnce("user-msg-1").mockResolvedValueOnce("assistant-msg-1");
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      streamResult: makeStreamResult({
        responseMessage: {
          parts: [{ type: "text", text: "Here is a careful next step." }],
        },
      }),
      getTraceCapture: () => makeTraceCapture(),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "What should I look at next?" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(2);
    expect(mocks.mutateInternal.mock.calls[0][1]).toEqual({
      sessionId: "session-1",
      orgId: "org-1",
      role: "user",
      content: "What should I look at next?",
    });
    expect(mocks.mutateInternal.mock.calls[1][1]).toEqual({
      sessionId: "session-1",
      orgId: "org-1",
      role: "assistant",
      content: "Here is a careful next step.",
      parts: [
        { type: "text", text: "Here is a careful next step." },
      ],
      agentMetrics: {
        model: "gpt-analysis",
        inputTokens: 120,
        outputTokens: 45,
        durationMs: 850,
      },
    });
    expect(mocks.writeAnalysisTurnTrace).toHaveBeenCalledWith(expect.objectContaining({
      runResultValue: {},
      runId: "run-1",
      projectId: "project-1",
      sessionId: "session-1",
      sessionTitle: "Audit Session",
      messageId: "assistant-msg-1",
      assistantText: "Here is a careful next step.",
    }));
    expect(mocks.streamAnalysisResponse).toHaveBeenCalledTimes(1);
    expect(mocks.generateAnalysisSessionTitle).not.toHaveBeenCalled();
    expect(mocks.loadAnalysisGroundingContext).toHaveBeenCalledWith({
      runResultValue: {},
      projectName: "TabulateAI Study",
      runStatus: undefined,
      projectConfig: {},
      projectIntake: {},
    });
  });

  it("persists grounded table cards as analysis artifacts", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1", result: {} })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1", title: "Audit Session", titleSource: "manual" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal
      .mockResolvedValueOnce("user-msg-1")
      .mockResolvedValueOnce("artifact-1")
      .mockResolvedValueOnce("assistant-msg-1");
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      streamResult: makeStreamResult({
        responseMessage: {
          parts: [
            { type: "text", text: "Here is the grounded table." },
            {
              type: "tool-getTableCard",
              toolCallId: "tool-1",
              state: "output-available",
              input: {
                tableId: "q1",
                rowFilter: null,
                cutFilter: null,
                valueMode: "pct",
              },
              output: {
                status: "available",
                tableId: "q1",
                title: "Q1 overall",
                questionId: "Q1",
                questionText: "How satisfied are you?",
                tableType: "frequency",
                surveySection: null,
                baseText: "All respondents",
                tableSubtitle: null,
                userNote: null,
                valueMode: "pct",
                columns: [],
                rows: [],
                totalRows: 0,
                totalColumns: 0,
                truncatedRows: 0,
                truncatedColumns: 0,
                requestedRowFilter: null,
                requestedCutFilter: null,
                significanceTest: null,
                significanceLevel: null,
                comparisonGroups: [],
                sourceRefs: [],
              },
            },
          ],
        },
      }),
      getTraceCapture: () => makeTraceCapture(),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Show me Q1" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(3);
    expect(mocks.mutateInternal.mock.calls[1][1]).toEqual({
      sessionId: "session-1",
      orgId: "org-1",
      projectId: "project-1",
      runId: "run-1",
      artifactType: "table_card",
      sourceClass: "from_tabs",
      title: "Q1 overall",
      sourceTableIds: ["q1"],
      sourceQuestionIds: ["Q1"],
      payload: expect.objectContaining({
        status: "available",
        tableId: "q1",
      }),
      createdBy: "user-1",
    });
    expect(mocks.mutateInternal.mock.calls[2][1]).toEqual({
      sessionId: "session-1",
      orgId: "org-1",
      role: "assistant",
      content: "Here is the grounded table.",
      parts: [
        { type: "text", text: "Here is the grounded table." },
        {
          type: "tool-getTableCard",
          state: "output-available",
          artifactId: "artifact-1",
          label: "Q1 overall",
        },
      ],
      agentMetrics: {
        model: "gpt-analysis",
        inputTokens: 120,
        outputTokens: 45,
        durationMs: 850,
      },
    });
  });

  it("does not fail the response when writing the success trace throws", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1", result: { outputDir: "/tmp/out" } })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1", title: "Audit Session", titleSource: "manual" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal.mockResolvedValueOnce("user-msg-1").mockResolvedValueOnce("assistant-msg-1");
    mocks.writeAnalysisTurnTrace.mockRejectedValueOnce(new Error("disk full"));
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      streamResult: makeStreamResult({
        responseMessage: {
          parts: [{ type: "text", text: "Still returned." }],
        },
      }),
      getTraceCapture: () => makeTraceCapture({
        usage: {
          model: "gpt-analysis",
          inputTokens: 12,
          outputTokens: 4,
          totalTokens: 16,
          durationMs: 90,
          estimatedCostUsd: 0.001,
        },
      }),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Hello" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(2);
  });

  it("writes an error trace when the stream reports an error", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1", result: { outputDir: "/tmp/out" } })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1", title: "Audit Session", titleSource: "manual" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal.mockResolvedValueOnce("user-msg-1");
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      streamResult: makeStreamResult({
        onError: new Error("stream exploded"),
      }),
      getTraceCapture: () => makeTraceCapture({
        usage: {
          model: "gpt-analysis",
          inputTokens: 12,
          outputTokens: 0,
          totalTokens: 12,
          durationMs: 90,
          estimatedCostUsd: 0.001,
        },
        retryAttempts: 2,
        finalClassification: "transient",
        terminalError: "stream exploded",
      }),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Why did this fail?" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.writeAnalysisTurnErrorTrace).toHaveBeenCalledWith(expect.objectContaining({
      runResultValue: { outputDir: "/tmp/out" },
      latestUserPrompt: "Why did this fail?",
      errorMessage: "stream exploded",
    }));
  });

  it("generates a replacement title after the first successful assistant turn", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1", result: {} })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1", title: "Analysis Session 1", titleSource: "default" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal
      .mockResolvedValueOnce("user-msg-1")
      .mockResolvedValueOnce("assistant-msg-1")
      .mockResolvedValueOnce({ updated: true });
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      streamResult: makeStreamResult({
        responseMessage: {
          parts: [{ type: "text", text: "Top drivers center on value and ease of use." }],
        },
      }),
      getTraceCapture: () => makeTraceCapture(),
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Summarize the main brand drivers" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.generateAnalysisSessionTitle).toHaveBeenCalledWith({
      userPrompt: "Summarize the main brand drivers",
      assistantResponse: "Top drivers center on value and ease of use.",
      abortSignal: expect.any(AbortSignal),
    });
    expect(mocks.mutateInternal.mock.calls[2][1]).toEqual({
      orgId: "org-1",
      sessionId: "session-1",
      title: "Brand Attribute Comparison",
    });
  });
});
