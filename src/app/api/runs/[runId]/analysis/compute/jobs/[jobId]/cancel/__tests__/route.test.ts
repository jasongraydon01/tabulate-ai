import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryInternal: vi.fn(),
  mutateInternal: vi.fn(),
  abortRun: vi.fn(),
  cleanupAbort: vi.fn(),
  requireConvexAuth: vi.fn(),
  AuthenticationError: class AuthenticationError extends Error {},
}));

vi.mock("@/lib/requireConvexAuth", () => ({
  requireConvexAuth: mocks.requireConvexAuth,
  AuthenticationError: mocks.AuthenticationError,
}));

vi.mock("@/lib/withRateLimit", () => ({
  applyRateLimit: vi.fn(() => null),
}));

vi.mock("@/lib/convex", () => ({
  getConvexClient: () => ({ query: mocks.query }),
  mutateInternal: mocks.mutateInternal,
  queryInternal: mocks.queryInternal,
}));

vi.mock("@/lib/abortStore", () => ({
  abortRun: mocks.abortRun,
  cleanupAbort: mocks.cleanupAbort,
}));

describe("analysis compute cancel route", () => {
  let POST: typeof import("@/app/api/runs/[runId]/analysis/compute/jobs/[jobId]/cancel/route").POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import("@/app/api/runs/[runId]/analysis/compute/jobs/[jobId]/cancel/route"));
    }
    vi.clearAllMocks();
    mocks.requireConvexAuth.mockResolvedValue({
      convexOrgId: "org-1",
      convexUserId: "user-1",
      role: "admin",
    });
  });

  it("returns 401 for unauthenticated requests", async () => {
    mocks.requireConvexAuth.mockRejectedValueOnce(new mocks.AuthenticationError("no session"));

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/compute/jobs/job-1/cancel", { method: "POST" }),
      { params: Promise.resolve({ runId: "run-1", jobId: "job-1" }) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.query).not.toHaveBeenCalled();
    expect(mocks.queryInternal).not.toHaveBeenCalled();
  });

  it("cancels a proposed job through the internal mutation", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1" });
    mocks.queryInternal.mockResolvedValueOnce({ _id: "job-1", parentRunId: "run-1" });
    mocks.mutateInternal.mockResolvedValueOnce({
      status: "cancelled",
      childRunId: undefined,
      alreadyTerminal: false,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/compute/jobs/job-1/cancel", { method: "POST" }),
      { params: Promise.resolve({ runId: "run-1", jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: true,
      status: "cancelled",
      alreadyTerminal: false,
      childRunId: null,
    });
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.abortRun).not.toHaveBeenCalled();
  });

  it("aborts a queued or running child run after durable cancellation", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1" });
    mocks.queryInternal.mockResolvedValueOnce({ _id: "job-1", parentRunId: "run-1" });
    mocks.mutateInternal.mockResolvedValueOnce({
      status: "cancelled",
      childRunId: "child-run-1",
      alreadyTerminal: false,
    });
    mocks.abortRun.mockReturnValueOnce(true);

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/compute/jobs/job-1/cancel", { method: "POST" }),
      { params: Promise.resolve({ runId: "run-1", jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      childRunId: "child-run-1",
      localAbort: true,
    });
    expect(mocks.abortRun).toHaveBeenCalledWith("child-run-1");
    expect(mocks.cleanupAbort).toHaveBeenCalledWith("child-run-1");
  });

  it("rejects a job from a different parent run", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1" });
    mocks.queryInternal.mockResolvedValueOnce({ _id: "job-1", parentRunId: "other-run" });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/compute/jobs/job-1/cancel", { method: "POST" }),
      { params: Promise.resolve({ runId: "run-1", jobId: "job-1" }) },
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Analysis compute job not found" });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it("treats terminal jobs as idempotent", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", orgId: "org-1" });
    mocks.queryInternal.mockResolvedValueOnce({ _id: "job-1", parentRunId: "run-1" });
    mocks.mutateInternal.mockResolvedValueOnce({
      status: "success",
      childRunId: "child-run-1",
      alreadyTerminal: true,
    });

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/compute/jobs/job-1/cancel", { method: "POST" }),
      { params: Promise.resolve({ runId: "run-1", jobId: "job-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: true,
      status: "success",
      alreadyTerminal: true,
    });
    expect(mocks.abortRun).not.toHaveBeenCalled();
  });
});
