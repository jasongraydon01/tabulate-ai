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
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal.mockResolvedValueOnce("user-msg-1").mockResolvedValueOnce("assistant-msg-1");
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      toUIMessageStreamResponse: ({ onFinish }: {
        onFinish?: (event: {
          responseMessage: { parts: Array<{ type: string; text?: string }> };
          isAborted: boolean;
        }) => Promise<void>;
      }) => {
        void onFinish?.({
          responseMessage: {
            parts: [{ type: "text", text: "Here is a careful next step." }],
          },
          isAborted: false,
        });
        return new Response("stream");
      },
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
    });
    expect(mocks.streamAnalysisResponse).toHaveBeenCalledTimes(1);
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
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ _id: "project-1", name: "TabulateAI Study", config: {}, intake: {} });
    mocks.mutateInternal
      .mockResolvedValueOnce("user-msg-1")
      .mockResolvedValueOnce("artifact-1")
      .mockResolvedValueOnce("assistant-msg-1");
    mocks.streamAnalysisResponse.mockResolvedValueOnce({
      toUIMessageStreamResponse: ({ onFinish }: {
        onFinish?: (event: {
          responseMessage: {
            parts: Array<
              | { type: "text"; text: string }
              | {
                  type: "tool-getTableCard";
                  toolCallId: string;
                  state: "output-available";
                  input: {
                    tableId: string;
                    rowFilter: null;
                    cutFilter: null;
                    valueMode: "pct";
                  };
                  output: {
                    status: "available";
                    tableId: string;
                    title: string;
                    questionId: string;
                    questionText: string;
                    tableType: string;
                    surveySection: null;
                    baseText: string;
                    tableSubtitle: null;
                    userNote: null;
                    valueMode: "pct";
                    columns: [];
                    rows: [];
                    totalRows: number;
                    totalColumns: number;
                    truncatedRows: number;
                    truncatedColumns: number;
                    requestedRowFilter: null;
                    requestedCutFilter: null;
                    significanceTest: null;
                    significanceLevel: null;
                    comparisonGroups: [];
                    sourceRefs: [];
                  };
                }
            >;
          };
          isAborted: boolean;
        }) => Promise<void>;
      }) => {
        void onFinish?.({
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
          isAborted: false,
        });
        return new Response("stream");
      },
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
    });
  });
});
