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

describe("analysis message feedback route", () => {
  let POST: typeof import("@/app/api/runs/[runId]/analysis/messages/[messageId]/feedback/route").POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import("@/app/api/runs/[runId]/analysis/messages/[messageId]/feedback/route"));
    }
    vi.clearAllMocks();
  });

  it("rejects invalid feedback votes", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/messages/msg-1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          vote: "maybe",
        }),
      }),
      { params: Promise.resolve({ runId: "run-1", messageId: "msg-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid feedback vote" });
  });

  it("returns 404 when the message is not an assistant turn in the session", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([{ _id: "msg-1", orgId: "org-1", sessionId: "session-1", role: "user" }]);

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/messages/msg-1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          vote: "down",
          correctionText: "Needs more grounding.",
        }),
      }),
      { params: Promise.resolve({ runId: "run-1", messageId: "msg-1" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Analysis message not found" });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("saves a downvote with trimmed correction text", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([{ _id: "msg-1", orgId: "org-1", sessionId: "session-1", role: "assistant" }]);

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/messages/msg-1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          vote: "down",
          correctionText: "  Use the grounded table first.  ",
        }),
      }),
      { params: Promise.resolve({ runId: "run-1", messageId: "msg-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      feedback: {
        messageId: "msg-1",
        vote: "down",
        correctionText: "Use the grounded table first.",
      },
    });
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: "org-1",
        projectId: "project-1",
        runId: "run-1",
        sessionId: "session-1",
        messageId: "msg-1",
        userId: "user-1",
        vote: "down",
        correctionText: "Use the grounded table first.",
      },
    );
  });

  it("clears correction text on an upvote", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([{ _id: "msg-1", orgId: "org-1", sessionId: "session-1", role: "assistant" }]);

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/messages/msg-1/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          vote: "up",
          correctionText: "Ignore this note",
        }),
      }),
      { params: Promise.resolve({ runId: "run-1", messageId: "msg-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      feedback: {
        messageId: "msg-1",
        vote: "up",
        correctionText: null,
      },
    });
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        vote: "up",
        correctionText: null,
      }),
    );
  });

  it("returns 404 instead of throwing when the url message id is not a persisted session message", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "session-1", orgId: "org-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce([{ _id: "msg-1", orgId: "org-1", sessionId: "session-1", role: "assistant" }]);

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/messages/iaftIc0LDH0l2rRU/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: "session-1",
          vote: "up",
        }),
      }),
      { params: Promise.resolve({ runId: "run-1", messageId: "iaftIc0LDH0l2rRU" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Analysis message not found" });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });
});
