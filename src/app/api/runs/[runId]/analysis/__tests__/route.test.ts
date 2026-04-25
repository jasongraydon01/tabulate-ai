import { createUIMessageStream } from "ai";
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

vi.mock("@/lib/analysis/markerRepair", () => ({
  // Repair calls hit the live OpenAI API via generateText; short-circuit to
  // null so the strip-invalid-markers fallback path is deterministic in tests.
  attemptAnalysisMarkerRepair: vi.fn(async () => null),
  attemptAnalysisRenderMarkerRepair: vi.fn(async () => null),
}));

vi.mock("@/lib/analysis/AnalysisAgent", () => ({
  streamAnalysisResponse: mocks.streamAnalysisResponse,
}));

vi.mock("@/lib/analysis/grounding", () => ({
  loadAnalysisGroundingContext: mocks.loadAnalysisGroundingContext,
  sanitizeGroundingToolOutput: (value: unknown) => value,
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
    nonCachedInputTokens?: number;
    cachedInputTokens?: number;
    cacheWriteInputTokens?: number;
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
      nonCachedInputTokens: 70,
      cachedInputTokens: 40,
      cacheWriteInputTokens: 10,
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
    toUIMessageStream: ({
      originalMessages,
      onFinish,
      onError,
      sendFinish = true,
    }: {
      originalMessages?: Array<Record<string, unknown>>;
      onFinish?: (event: {
        responseMessage: { parts: Array<Record<string, unknown>> };
        isAborted: boolean;
        finishReason?: string;
      }) => void;
      onError?: (error: Error) => string;
      sendFinish?: boolean;
    }) => createUIMessageStream({
      originalMessages: originalMessages as never,
      onFinish,
      execute: ({ writer }) => {
        writer.write({ type: "start" });
        if (options.onError) {
          writer.write({
            type: "error",
            errorText: onError?.(options.onError) ?? options.onError.message,
          });
          return;
        }

        for (const part of options.responseMessage?.parts ?? []) {
          if (part.type === "text" && typeof part.text === "string") {
            writer.write({ type: "text-start", id: "text-1" });
            writer.write({ type: "text-delta", id: "text-1", delta: part.text });
            writer.write({ type: "text-end", id: "text-1" });
            continue;
          }

          if (part.type === "tool-fetchTable") {
            writer.write({
              type: "tool-input-available",
              toolCallId: String(part.toolCallId ?? "tool-1"),
              toolName: "fetchTable",
              input: part.input ?? {},
            });
            writer.write({
              type: "tool-output-available",
              toolCallId: String(part.toolCallId ?? "tool-1"),
              output: part.output,
            });
          }
        }

        if (sendFinish) {
          writer.write({ type: "finish", finishReason: "stop" });
        }
      },
    }),
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
      getGroundingCapture: () => [],
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
    await response.text();
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
        nonCachedInputTokens: 70,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 10,
        durationMs: 850,
        estimatedCostUsd: 0.0123,
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

  it("rehydrates persisted tool history before the next turn", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1", result: {} })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1", title: "Audit Session", titleSource: "manual" })
      .mockResolvedValueOnce([
        {
          _id: "assistant-msg-0",
          role: "assistant",
          content: "Prior answer.",
          parts: [
            {
              type: "tool-fetchTable",
              state: "output-available",
              toolCallId: "tool-fetch-1",
              artifactId: "artifact-1",
              input: { tableId: "q1", cutGroups: null },
            },
            {
              type: "tool-someNewThing",
              state: "input-available",
              toolCallId: "tool-generic-1",
              input: { topic: "brands" },
            },
            { type: "text", text: "Prior answer." },
            { type: "render", tableId: "q1", focus: { rowLabels: ["CSB"] } },
            { type: "text", text: "Value." },
            { type: "cite", cellIds: ["q1|row|cut"] },
          ],
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: "artifact-1",
          artifactType: "table_card",
          payload: {
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
            columnGroups: [{ groupKey: "__total__", groupName: "Total", columns: [] }],
            rows: [],
            totalRows: 0,
            totalColumns: 0,
            truncatedRows: 0,
            truncatedColumns: 0,
            defaultScope: "total_only",
            initialVisibleRowCount: 0,
            initialVisibleGroupCount: 0,
            hiddenRowCount: 0,
            hiddenGroupCount: 0,
            focusedCutIds: null,
            requestedCutGroups: null,
            focusedRowKeys: null,
            focusedGroupKeys: null,
            significanceTest: null,
            significanceLevel: null,
            comparisonGroups: [],
            sourceRefs: [],
          },
        },
      ])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal.mockResolvedValueOnce("user-msg-1").mockResolvedValueOnce("assistant-msg-1");
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      streamResult: makeStreamResult({
        responseMessage: {
          parts: [{ type: "text", text: "Still grounded." }],
        },
      }),
      getTraceCapture: () => makeTraceCapture(),
      getGroundingCapture: () => [],
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Use the prior grounding" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.streamAnalysisResponse).toHaveBeenCalledWith(expect.objectContaining({
      messages: [
        {
          id: "assistant-msg-0",
          role: "assistant",
          parts: [
            {
              type: "tool-fetchTable",
              toolCallId: "tool-fetch-1",
              state: "output-available",
              input: { tableId: "q1", cutGroups: null },
              output: expect.objectContaining({
                tableId: "q1",
                title: "Q1 overall",
              }),
            },
            {
              type: "tool-someNewThing",
              toolCallId: "tool-generic-1",
              state: "input-available",
              input: { topic: "brands" },
            },
            {
              type: "text",
              text: 'Prior answer.\n\n[[render tableId=q1 rowLabels=["CSB"]]]\n\nValue.[[cite cellIds=q1|row|cut]]',
            },
          ],
        },
        {
          id: "user-msg-1",
          role: "user",
          parts: [{ type: "text", text: "Use the prior grounding" }],
        },
      ],
      groundingContext: expect.any(Object),
      abortSignal: expect.any(AbortSignal),
    }));
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
              type: "tool-fetchTable",
              toolCallId: "tool-1",
              state: "output-available",
              input: {
                tableId: "q1",
                cutGroups: null,
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
                requestedCutGroups: null,
                focusedRowKeys: null,
                focusedGroupKeys: null,
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
      getGroundingCapture: () => [],
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
    await response.text();
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
        {
          type: "tool-fetchTable",
          state: "output-available",
          artifactId: "artifact-1",
          label: "Q1 overall",
          toolCallId: "tool-1",
          input: {
            tableId: "q1",
            cutGroups: null,
          },
        },
        { type: "text", text: "Here is the grounded table." },
      ],
      followUpSuggestions: [
        "Show this in counts",
        "Show the base sizes here",
        "How was Q1 asked?",
      ],
      agentMetrics: {
        model: "gpt-analysis",
        inputTokens: 120,
        outputTokens: 45,
        nonCachedInputTokens: 70,
        cachedInputTokens: 40,
        cacheWriteInputTokens: 10,
        durationMs: 850,
        estimatedCostUsd: 0.0123,
      },
    });
  });

  it("persists a cell grounding ref when the assistant cites a confirmed cell inline", async () => {
    // Mirrors buildAnalysisCellId: encodeURIComponent(tableId)|rowKey|cutKey.
    // `::` in cutKey is URL-encoded to `%3A%3A`; the `|` delimiters stay literal.
    const cellId = "q1|row_0_1|__total__%3A%3Atotal";
    const cellSummary = {
      cellId,
      tableId: "q1",
      tableTitle: "Q1 overall",
      questionId: "Q1",
      rowKey: "row_0_1",
      rowLabel: "Very satisfied",
      cutKey: "__total__::total",
      cutName: "Total",
      groupName: null,
      valueMode: "pct",
      displayValue: "45%",
      pct: 45,
      count: 54,
      n: null,
      mean: null,
      baseN: 120,
      sigHigherThan: [],
      sigVsTotal: null,
      sourceRefs: [
        { refType: "table", refId: "q1", label: "Q1 overall" },
        { refType: "question", refId: "Q1", label: "Q1" },
      ],
    };

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
            {
              type: "tool-fetchTable",
              toolCallId: "tool-1",
              state: "output-available",
              input: {
                tableId: "q1",
                cutGroups: null,
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
                requestedCutGroups: null,
                focusedRowKeys: null,
                focusedGroupKeys: null,
                significanceTest: null,
                significanceLevel: null,
                comparisonGroups: [],
                sourceRefs: [],
              },
            },
            {
              type: "text",
              text: `Overall satisfaction is 45%.[[cite cellIds=${cellId}]]`,
            },
          ],
        },
      }),
      getTraceCapture: () => makeTraceCapture(),
      getGroundingCapture: () => [
        {
          toolName: "confirmCitation",
          toolCallId: "confirm-1",
          sourceRefs: cellSummary.sourceRefs,
          cellSummary,
        },
      ],
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "What is overall satisfaction?" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.mutateInternal.mock.calls[2][1]).toEqual(expect.objectContaining({
      parts: expect.arrayContaining([
        { type: "text", text: "Overall satisfaction is 45%." },
        { type: "cite", cellIds: [cellId] },
      ]),
      groundingRefs: expect.arrayContaining([
        expect.objectContaining({
          claimId: cellId,
          claimType: "cell",
          evidenceKind: "cell",
          refType: "table",
          refId: "q1",
          anchorId: "tool-1",
          artifactId: "artifact-1",
          rowKey: "row_0_1",
          cutKey: "__total__::total",
          sourceTableId: "q1",
          sourceQuestionId: "Q1",
          renderedInCurrentMessage: true,
        }),
      ]),
    }));
  });

  it("persists no grounding refs when the assistant quotes a number without a cite marker (freelancing)", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1", result: {} })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1", title: "Audit Session", titleSource: "manual" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal
      .mockResolvedValueOnce("user-msg-1")
      .mockResolvedValueOnce("assistant-msg-1");
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      streamResult: makeStreamResult({
        responseMessage: {
          parts: [{ type: "text", text: "Overall satisfaction is still 45%." }],
        },
      }),
      getTraceCapture: () => makeTraceCapture(),
      getGroundingCapture: () => [],
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Remind me of overall satisfaction" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(2);
    const assistantCreateArgs = mocks.mutateInternal.mock.calls[1][1];
    expect(assistantCreateArgs).toEqual(expect.objectContaining({
      content: "Overall satisfaction is still 45%.",
    }));
    // No cite marker + no confirmCitation grounding event → no grounding refs.
    expect(assistantCreateArgs).not.toHaveProperty("groundingRefs");
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
      getGroundingCapture: () => [],
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
    await response.text();
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
      getGroundingCapture: () => [],
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
    await response.text();
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
      getGroundingCapture: () => [],
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
    await response.text();
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

  it("strips render anchors from persisted assistant content and title generation input", async () => {
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
          parts: [{
            type: "text",
            text: "Intro.\n\n[[render tableId=q1]]\n\nClose.",
          }],
        },
      }),
      getTraceCapture: () => makeTraceCapture(),
      getGroundingCapture: () => [],
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Show me the narrative" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await response.text();
    // The marker referenced q1 but q1 is not in the mock catalog and was not
    // fetched this turn — validation strips it from the in-memory text before
    // persistence, and the persisted assistant structure keeps only cleaned prose.
    expect(mocks.mutateInternal.mock.calls[1][1]).toEqual(expect.objectContaining({
      content: "Intro.\n\nClose.",
      parts: [
        { type: "text", text: "Intro.\n\nClose." },
      ],
    }));
    expect(mocks.generateAnalysisSessionTitle).toHaveBeenCalledWith({
      userPrompt: "Show me the narrative",
      assistantResponse: "Intro.\n\nClose.",
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("persists structured render parts while leaving the current streamed text behavior unchanged", async () => {
    mocks.loadAnalysisGroundingContext.mockResolvedValueOnce({
      availability: "available",
      missingArtifacts: [],
      tables: { q1: { tableId: "q1" } },
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
    });

    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1", result: {} })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1", title: "Analysis Session 1", titleSource: "manual" })
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
            {
              type: "tool-fetchTable",
              toolCallId: "tool-1",
              state: "output-available",
              input: {
                tableId: "q1",
                cutGroups: null,
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
                requestedCutGroups: null,
                focusedRowKeys: null,
                focusedGroupKeys: null,
                significanceTest: null,
                significanceLevel: null,
                comparisonGroups: [],
                sourceRefs: [],
              },
            },
            {
              type: "text",
              text: "Intro.\n\n[[render tableId=q1]]\n\nClose.",
            },
          ],
        },
      }),
      getTraceCapture: () => makeTraceCapture(),
      getGroundingCapture: () => [],
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "Show me the narrative and table" }] }],
        }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    await response.text();
    expect(mocks.mutateInternal.mock.calls[2][1]).toEqual(expect.objectContaining({
      content: "Intro.\n\nClose.",
      parts: expect.arrayContaining([
        { type: "render", tableId: "q1" },
      ]),
    }));
  });
});
