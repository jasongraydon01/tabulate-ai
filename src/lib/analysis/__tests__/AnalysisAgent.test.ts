import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  convertToModelMessages: vi.fn(async (messages) => messages),
  retryWithPolicyHandling: vi.fn(),
  recordAgentMetrics: vi.fn(),
  buildAnalysisSystemMessage: vi.fn(() => ({ role: "system", content: "system prompt" })),
  createAnalysisBannerExtensionProposal: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    convertToModelMessages: mocks.convertToModelMessages,
    stepCountIs: vi.fn((count: number) => count),
    streamText: mocks.streamText,
    tool: vi.fn((config) => config),
  };
});

vi.mock("@/lib/analysis/model", () => ({
  getAnalysisModel: vi.fn(() => "model-instance"),
  getAnalysisModelName: vi.fn(() => "gpt-analysis"),
  getAnalysisProviderOptions: vi.fn(() => undefined),
}));

vi.mock("@/lib/analysis/grounding", () => ({
  searchRunCatalog: vi.fn(async () => ({ matches: [] })),
  fetchTable: vi.fn(async () => ({ status: "available" })),
  getQuestionContext: vi.fn(async () => ({ status: "available" })),
  listBannerCuts: vi.fn(async () => ({ status: "available" })),
  confirmCitation: vi.fn(async () => ({ status: "confirmed", cellId: "cell-1" })),
  buildFetchTableModelMarkdown: vi.fn(() => "markdown table"),
  sanitizeGroundingToolOutput: vi.fn((value) => value),
  attachRetrievedContextXml: vi.fn((_toolName, value) => value),
}));

vi.mock("@/lib/analysis/computeLane/proposalService", () => ({
  AnalysisComputeProposalError: class AnalysisComputeProposalError extends Error {
    httpStatus = 409;
    code = "not_eligible";
  },
  createAnalysisBannerExtensionProposal: mocks.createAnalysisBannerExtensionProposal,
  formatAnalysisComputeProposalToolResult: vi.fn((value) => value.proposal),
}));

vi.mock("@/lib/analysis/promptPrefix", () => ({
  buildAnalysisSystemMessage: mocks.buildAnalysisSystemMessage,
  ANALYSIS_ANTHROPIC_EPHEMERAL_CACHE_CONTROL_PROVIDER_OPTIONS: {
    anthropic: {
      cacheControl: { type: "ephemeral" },
    },
  },
}));

vi.mock("@/lib/observability", async () => {
  const actual = await vi.importActual<typeof import("@/lib/observability")>("@/lib/observability");
  return {
    ...actual,
    recordAgentMetrics: mocks.recordAgentMetrics,
  };
});

vi.mock("@/lib/retryWithPolicyHandling", () => ({
  retryWithPolicyHandling: mocks.retryWithPolicyHandling,
}));

describe("streamAnalysisResponse", () => {
  let streamAnalysisResponse: typeof import("@/lib/analysis/AnalysisAgent").streamAnalysisResponse;

  beforeEach(async () => {
    if (!streamAnalysisResponse) {
      ({ streamAnalysisResponse } = await import("@/lib/analysis/AnalysisAgent"));
    }
    vi.clearAllMocks();
  });

  it("collects retry events and usage in the trace capture", async () => {
    mocks.streamText.mockImplementationOnce(({ onFinish }) => {
      onFinish?.({
        totalUsage: {
          inputTokens: 120,
          outputTokens: 45,
          inputTokenDetails: {
            noCacheTokens: 70,
            cacheReadTokens: 40,
            cacheWriteTokens: 10,
          },
        },
      });
      return {
        toUIMessageStreamResponse: vi.fn(() => new Response("ok")),
      };
    });

    mocks.retryWithPolicyHandling.mockImplementationOnce(async (
      fn: () => Promise<unknown>,
      options?: {
        onRetryWithContext?: (
          context: {
            attempt: number;
            maxAttempts: number;
            lastClassification: "policy";
            lastErrorSummary: string;
            shouldUsePolicySafeVariant: boolean;
            isFinalAttempt: boolean;
            lastResponseBody?: unknown;
            consecutiveOutputValidationErrors: number;
            possibleTruncation: boolean;
          },
          error: Error,
          nextDelayMs: number,
        ) => void;
      },
    ) => {
      options?.onRetryWithContext?.({
        attempt: 1,
        maxAttempts: 3,
        lastClassification: "policy",
        lastErrorSummary: "content policy block",
        shouldUsePolicySafeVariant: false,
        isFinalAttempt: false,
        lastResponseBody: undefined,
        consecutiveOutputValidationErrors: 0,
        possibleTruncation: false,
      }, new Error("policy"), 250);

      return {
        success: true,
        result: await fn(),
        attempts: 2,
        wasPolicyError: false,
        finalClassification: "policy",
      };
    });

    const result = await streamAnalysisResponse({
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Show me awareness" }] }],
      groundingContext: {
        availability: "available",
        missingArtifacts: [],
        tables: {},
        questions: [],
        bannerGroups: [],
        bannerRouteMetadata: null,
        surveyMarkdown: null,
        surveyQuestions: [],
        bannerPlanGroups: [],
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
      },
    });

    const capture = result.getTraceCapture();
    const groundingCapture = result.getGroundingCapture();

    expect(capture.retryEvents).toEqual([
      {
        attempt: 1,
        maxAttempts: 3,
        nextDelayMs: 250,
        lastClassification: "policy",
        lastErrorSummary: "content policy block",
        shouldUsePolicySafeVariant: false,
        possibleTruncation: false,
      },
    ]);
    expect(capture.retryAttempts).toBe(2);
    expect(capture.finalClassification).toBe("policy");
    expect(capture.usage).toEqual({
      model: "gpt-analysis",
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      nonCachedInputTokens: 70,
      cachedInputTokens: 40,
      cacheWriteInputTokens: 10,
      durationMs: expect.any(Number),
      estimatedCostUsd: expect.any(Number),
    });
    expect(mocks.recordAgentMetrics).toHaveBeenCalledWith(
      "AnalysisAgent",
      "gpt-analysis",
      {
        input: 120,
        output: 45,
        inputNoCache: 70,
        inputCacheRead: 40,
        inputCacheWrite: 10,
      },
      expect.any(Number),
    );
    expect(groundingCapture).toEqual([]);
  });

  it("uses a structured system message and keeps cache control on the terminal tool only", async () => {
    mocks.streamText.mockImplementationOnce(({ onFinish, system, tools }) => {
      expect(system).toEqual({ role: "system", content: "system prompt" });
      expect(Object.keys(tools ?? {})).toEqual([
        "searchRunCatalog",
        "fetchTable",
        "getQuestionContext",
        "listBannerCuts",
        "confirmCitation",
        "proposeDerivedRun",
        "submitAnswer",
      ]);
      expect(tools?.confirmCitation.providerOptions).toEqual({
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      });
      expect(tools?.listBannerCuts.providerOptions).toBeUndefined();
      expect(tools?.fetchTable.toModelOutput?.({
        toolCallId: "tool-1",
        input: { tableId: "q1" },
        output: { status: "available", tableId: "q1" },
      })).toEqual({
        type: "text",
        value: "markdown table",
      });
      expect(tools?.confirmCitation.inputSchema.safeParse({
        tableId: "q1",
        rowLabel: "Very satisfied",
        columnLabel: "Female",
        rowRef: "row_1",
        columnRef: "group:gender::female",
      }).success).toBe(true);
      expect(tools?.confirmCitation.inputSchema.safeParse({
        tableId: "q1",
        rowKey: "row_1",
        cutKey: "cut_1",
      }).success).toBe(false);
      expect(tools?.confirmCitation.inputSchema.safeParse({
        tableId: "q1",
        rowLabel: "Very satisfied",
        columnLabel: "Female",
        valueMode: "pct",
      }).success).toBe(false);
      expect(tools?.proposeDerivedRun.providerOptions).toBeUndefined();
      expect(tools?.proposeDerivedRun.inputSchema.safeParse({
        requestText: "Append region cuts across the full crosstab set",
        targetScope: "full_crosstab_set",
        tableSpecificDerivationExcluded: true,
      }).success).toBe(true);
      expect(tools?.proposeDerivedRun.inputSchema.safeParse({
        requestText: "Append region cuts to Q1",
        targetScope: "single_table",
        tableSpecificDerivationExcluded: true,
      }).success).toBe(false);
      expect(tools?.proposeDerivedRun.inputSchema.safeParse({
        requestText: "Append region cuts",
        targetScope: "full_crosstab_set",
        tableSpecificDerivationExcluded: false,
      }).success).toBe(false);
      expect(tools?.proposeDerivedRun.inputSchema.safeParse({
        requestText: "Append region cuts",
        targetScope: "full_crosstab_set",
        tableSpecificDerivationExcluded: true,
        rawExpression: "REGION == 1",
      }).success).toBe(false);
      expect(tools?.fetchTable.inputSchema.safeParse({
        tableId: "q1",
        valueMode: "pct",
      }).success).toBe(false);
      expect(tools?.submitAnswer.inputSchema.safeParse({
        parts: [
          { type: "text", text: "Overall satisfaction is 45%." },
          { type: "cite", cellIds: ["q1|row_1|cut_1"] },
          { type: "render", tableId: "q1", focus: { groupNames: ["Age"] } },
        ],
      }).success).toBe(true);

      onFinish?.({
        totalUsage: {
          inputTokens: 12,
          outputTokens: 4,
        },
      });
      return {
        toUIMessageStreamResponse: vi.fn(() => new Response("ok")),
      };
    });

    mocks.retryWithPolicyHandling.mockImplementationOnce(async (fn: () => Promise<unknown>) => ({
      success: true,
      result: await fn(),
      attempts: 1,
      wasPolicyError: false,
      finalClassification: null,
    }));

    await streamAnalysisResponse({
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Show me awareness" }] }],
      groundingContext: {
        availability: "available",
        missingArtifacts: [],
        tables: {},
        questions: [],
        bannerGroups: [],
        bannerRouteMetadata: null,
        surveyMarkdown: null,
        surveyQuestions: [],
        bannerPlanGroups: [],
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
      },
    });

    expect(mocks.buildAnalysisSystemMessage).toHaveBeenCalledTimes(1);
  });

  it("passes prior tool history through to model conversion", async () => {
    mocks.streamText.mockImplementationOnce(({ onFinish }) => {
      onFinish?.({
        totalUsage: {
          inputTokens: 12,
          outputTokens: 4,
        },
      });
      return {
        toUIMessageStreamResponse: vi.fn(() => new Response("ok")),
      };
    });

    mocks.retryWithPolicyHandling.mockImplementationOnce(async (fn: () => Promise<unknown>) => ({
      success: true,
      result: await fn(),
      attempts: 1,
      wasPolicyError: false,
      finalClassification: null,
    }));

    await streamAnalysisResponse({
      messages: [{
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Prior answer." },
          { type: "data-analysis-render", id: "render-1", data: { tableId: "q1" } },
          {
            type: "tool-someNewThing",
            toolCallId: "tool-1",
            state: "input-available",
            input: { topic: "brands" },
          } as never,
          {
            type: "tool-fetchTable",
            toolCallId: "tool-2",
            state: "output-available",
            input: { tableId: "q1" },
            output: { status: "available", tableId: "q1" },
          } as never,
        ],
      }],
      groundingContext: {
        availability: "available",
        missingArtifacts: [],
        tables: {},
        questions: [],
        bannerGroups: [],
        bannerRouteMetadata: null,
        surveyMarkdown: null,
        surveyQuestions: [],
        bannerPlanGroups: [],
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
      },
    });

    expect(mocks.convertToModelMessages).toHaveBeenCalledWith([
      {
        id: "a1",
        role: "assistant",
        parts: [
          { type: "text", text: "Prior answer." },
          {
            type: "tool-someNewThing",
            toolCallId: "tool-1",
            state: "input-available",
            input: { topic: "brands" },
          },
          {
            type: "tool-fetchTable",
            toolCallId: "tool-2",
            state: "output-available",
            input: { tableId: "q1" },
            output: { status: "available", tableId: "q1" },
          },
        ],
      },
    ]);
  });

  it("exposes a sanitized derived-run proposal tool without transcript breadcrumbs", async () => {
    const proposal = {
      jobId: "job-1",
      jobType: "banner_extension_recompute",
      status: "proposed",
      groupName: "Region",
      cuts: [{
        name: "North",
        userSummary: "Matched region.",
        confidence: 0.95,
        expressionType: "direct_variable",
      }],
      reviewFlags: {
        requiresClarification: false,
        requiresReview: false,
        reasons: [],
        averageConfidence: 0.95,
        policyFallbackDetected: false,
      },
      message: "I prepared a derived-run proposal.",
    };
    mocks.createAnalysisBannerExtensionProposal.mockResolvedValueOnce({
      proposal,
      job: {
        id: "job-1",
        jobType: "banner_extension_recompute",
        status: "proposed",
        effectiveStatus: "proposed",
        requestText: "Append region cuts across the full crosstab set",
        confirmToken: "opaque-token",
        proposedGroup: {
          groupName: "Region",
          cuts: [{
            name: "North",
            original: "North region",
            rawExpression: "REGION == 1",
          }],
        },
        createdAt: 100,
        updatedAt: 100,
      },
    });
    mocks.streamText.mockImplementationOnce(async ({ onFinish, tools }) => {
      const output = await tools?.proposeDerivedRun.execute?.({
        requestText: "Append region cuts across the full crosstab set",
        targetScope: "full_crosstab_set",
        tableSpecificDerivationExcluded: true,
      }, { toolCallId: "derive-1" });
      expect(output).toEqual(proposal);
      expect(JSON.stringify(output)).not.toContain("REGION == 1");
      expect(JSON.stringify(output)).not.toContain("opaque-token");

      onFinish?.({
        totalUsage: {
          inputTokens: 12,
          outputTokens: 4,
        },
      });
      return {
        toUIMessageStreamResponse: vi.fn(() => new Response("ok")),
      };
    });
    mocks.retryWithPolicyHandling.mockImplementationOnce(async (fn: () => Promise<unknown>) => ({
      success: true,
      result: await fn(),
      attempts: 1,
      wasPolicyError: false,
      finalClassification: null,
    }));

    await streamAnalysisResponse({
      messages: [{ id: "u1", role: "user", parts: [{ type: "text", text: "Add region cuts to all tabs" }] }],
      groundingContext: {
        availability: "available",
        missingArtifacts: [],
        tables: {},
        questions: [],
        bannerGroups: [],
        bannerRouteMetadata: null,
        surveyMarkdown: null,
        surveyQuestions: [],
        bannerPlanGroups: [],
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
      },
      computeProposalContext: {
        orgId: "org-1" as never,
        projectId: "project-1" as never,
        parentRunId: "run-1" as never,
        sessionId: "session-1" as never,
        requestedBy: "user-1" as never,
        parentRun: {
          _id: "run-1" as never,
          status: "success",
          result: {},
        },
        project: {
          _id: "project-1" as never,
          name: "TabulateAI Study",
          config: {},
          intake: {},
        },
        session: {
          _id: "session-1" as never,
          runId: "run-1" as never,
          projectId: "project-1" as never,
        },
      },
    });

    expect(mocks.createAnalysisBannerExtensionProposal).toHaveBeenCalledWith(expect.objectContaining({
      requestText: "Append region cuts across the full crosstab set",
      transcriptMode: "none",
      abortSignal: undefined,
    }));
  });
});
