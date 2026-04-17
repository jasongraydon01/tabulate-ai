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

describe("analysis sessions route", () => {
  let POST: typeof import("@/app/api/runs/[runId]/analysis/sessions/route").POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import("@/app/api/runs/[runId]/analysis/sessions/route"));
    }
    vi.clearAllMocks();
  });

  it("returns 400 for an invalid run id", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/runs/%20/analysis/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: " " }) },
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Invalid run ID" });
  });

  it("returns 404 when the run is not found for the org", async () => {
    mocks.query.mockResolvedValueOnce(null);

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Run not found" });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("creates a session tied to the run and current org", async () => {
    mocks.query.mockResolvedValueOnce({
      _id: "run-1",
      projectId: "project-1",
      orgId: "org-1",
    });
    mocks.mutateInternal.mockResolvedValueOnce("session-1");

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Key questions" }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sessionId: "session-1" });
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal.mock.calls[0][1]).toEqual({
      orgId: "org-1",
      projectId: "project-1",
      runId: "run-1",
      createdBy: "user-1",
      title: "Key questions",
    });
  });
});
