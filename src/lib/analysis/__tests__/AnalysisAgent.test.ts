import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamText: vi.fn(),
  retryWithPolicyHandling: vi.fn(),
  recordAgentMetrics: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    convertToModelMessages: vi.fn(async (messages) => messages),
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
  getTableCard: vi.fn(async () => ({ status: "available" })),
  getQuestionContext: vi.fn(async () => ({ status: "available" })),
  getSurveyQuestion: vi.fn(async () => ({ status: "available" })),
  listBannerCuts: vi.fn(async () => ({ status: "available" })),
  getBannerPlanContext: vi.fn(async () => ({ status: "available" })),
  getRunContext: vi.fn(async () => ({ status: "available" })),
  sanitizeGroundingToolOutput: vi.fn((value) => value),
}));

vi.mock("@/prompts/analysis", () => ({
  buildAnalysisInstructions: vi.fn(() => "system prompt"),
  buildAnalysisQuestionCatalog: vi.fn(() => ""),
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

  it("collects scratchpad entries, retry events, and usage in the trace capture", async () => {
    mocks.streamText.mockImplementationOnce(({ onFinish, tools }) => {
      if (tools?.scratchpad?.execute) {
        void tools.scratchpad.execute(
          { action: "add", content: "Check grouped cuts first." },
          { toolCallId: "scratch-1", messages: [], abortSignal: undefined as never },
        );
      }
      onFinish?.({
        totalUsage: {
          inputTokens: 120,
          outputTokens: 45,
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

    expect(capture.scratchpadEntries).toHaveLength(1);
    expect(capture.scratchpadEntries[0]?.content).toBe("Check grouped cuts first.");
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
      durationMs: expect.any(Number),
      estimatedCostUsd: expect.any(Number),
    });
    expect(mocks.recordAgentMetrics).toHaveBeenCalledWith(
      "AnalysisAgent",
      "gpt-analysis",
      { input: 120, output: 45 },
      expect.any(Number),
    );
    expect(groundingCapture).toEqual([]);
  });
});
