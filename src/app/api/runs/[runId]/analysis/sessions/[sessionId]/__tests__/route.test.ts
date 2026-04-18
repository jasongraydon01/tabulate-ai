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

describe("analysis session lifecycle route", () => {
  let PATCH: typeof import("@/app/api/runs/[runId]/analysis/sessions/[sessionId]/route").PATCH;
  let DELETE: typeof import("@/app/api/runs/[runId]/analysis/sessions/[sessionId]/route").DELETE;

  beforeEach(async () => {
    if (!PATCH || !DELETE) {
      ({ PATCH, DELETE } = await import("@/app/api/runs/[runId]/analysis/sessions/[sessionId]/route"));
    }
    vi.clearAllMocks();
  });

  it("rejects blank rename titles", async () => {
    const response = await PATCH(
      new NextRequest("http://localhost/api/runs/run-1/analysis/sessions/session-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: " " }),
      }),
      { params: Promise.resolve({ runId: "run-1", sessionId: "session-1" }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Session title is required" });
  });

  it("renames a session scoped to the current run", async () => {
    mocks.query.mockResolvedValueOnce({
      _id: "session-1",
      runId: "run-1",
      orgId: "org-1",
    });

    const response = await PATCH(
      new NextRequest("http://localhost/api/runs/run-1/analysis/sessions/session-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Client follow-ups" }),
      }),
      { params: Promise.resolve({ runId: "run-1", sessionId: "session-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: "org-1",
        sessionId: "session-1",
        title: "Client follow-ups",
      },
    );
  });

  it("returns 404 when deleting a session from a different run", async () => {
    mocks.query.mockResolvedValueOnce({
      _id: "session-1",
      runId: "run-2",
      orgId: "org-1",
    });

    const response = await DELETE(
      new NextRequest("http://localhost/api/runs/run-1/analysis/sessions/session-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ runId: "run-1", sessionId: "session-1" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Analysis session not found" });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("hard deletes a session through the cascade mutation", async () => {
    mocks.query.mockResolvedValueOnce({
      _id: "session-1",
      runId: "run-1",
      orgId: "org-1",
    });

    const response = await DELETE(
      new NextRequest("http://localhost/api/runs/run-1/analysis/sessions/session-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ runId: "run-1", sessionId: "session-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      {
        orgId: "org-1",
        sessionId: "session-1",
      },
    );
  });
});
