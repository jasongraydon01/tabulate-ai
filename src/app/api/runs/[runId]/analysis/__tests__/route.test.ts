import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
  streamAnalysisResponse: vi.fn(),
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
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([]);
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
    });
    expect(mocks.streamAnalysisResponse).toHaveBeenCalledTimes(1);
  });
});
