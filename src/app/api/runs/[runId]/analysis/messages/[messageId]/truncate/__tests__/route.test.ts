import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
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

describe("analysis message truncate route", () => {
  let POST: typeof import("@/app/api/runs/[runId]/analysis/messages/[messageId]/truncate/route").POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import("@/app/api/runs/[runId]/analysis/messages/[messageId]/truncate/route"));
    }
    vi.clearAllMocks();
  });

  it("rejects invalid session ids", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/messages/msg-1/truncate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "" }),
      }),
      { params: Promise.resolve({ runId: "run-1", messageId: "msg-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid session ID" });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("returns 404 when the target message is not a user turn in the session", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([{ _id: "msg-1", orgId: "org-1", sessionId: "session-1", role: "assistant" }]);

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/messages/msg-1/truncate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
      { params: Promise.resolve({ runId: "run-1", messageId: "msg-1" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Analysis message not found" });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("truncates from a persisted user message", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([{ _id: "msg-1", orgId: "org-1", sessionId: "session-1", role: "user" }]);
    mocks.mutateInternal.mockResolvedValueOnce({
      deletedMessages: 3,
      deletedFeedback: 1,
      deletedArtifacts: 2,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/messages/msg-1/truncate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: "session-1" }),
      }),
      { params: Promise.resolve({ runId: "run-1", messageId: "msg-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      deletedMessages: 3,
      deletedFeedback: 1,
      deletedArtifacts: 2,
    });
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: "org-1",
        sessionId: "session-1",
        messageId: "msg-1",
      },
    );
  });
});
