import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
  requireConvexAuth: vi.fn(),
  loadAnalysisGroundingContext: vi.fn(),
  loadAnalysisParentRunArtifacts: vi.fn(),
  runAnalysisBannerExtensionPreflight: vi.fn(),
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
}));

vi.mock("@/lib/analysis/grounding", () => ({
  loadAnalysisGroundingContext: mocks.loadAnalysisGroundingContext,
}));

vi.mock("@/lib/analysis/computeLane/artifactLoader", () => ({
  loadAnalysisParentRunArtifacts: mocks.loadAnalysisParentRunArtifacts,
}));

vi.mock("@/lib/analysis/computeLane/preflight", () => ({
  runAnalysisBannerExtensionPreflight: mocks.runAnalysisBannerExtensionPreflight,
}));

const frozenBannerGroup = {
  groupName: "Region",
  columns: [{ name: "North", original: "REGION=1" }],
};

const frozenValidatedGroup = {
  groupName: "Region",
  columns: [{
    name: "North",
    adjusted: "REGION == 1",
    confidence: 0.95,
    reasoning: "Direct match",
    userSummary: "Matched directly.",
    alternatives: [],
    uncertainties: [],
    expressionType: "direct_variable",
  }],
};

describe("analysis compute preflight route", () => {
  let POST: typeof import("@/app/api/runs/[runId]/analysis/compute/preflight/route").POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import("@/app/api/runs/[runId]/analysis/compute/preflight/route"));
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
      new NextRequest("http://localhost/api/runs/run-1/analysis/compute/preflight", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", requestText: "Add region", clientTurnId: "turn-direct-1" }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("returns a sanitized job view and keeps raw expressions out of transcript breadcrumbs", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", status: "success", result: {}, config: {} })
      .mockResolvedValueOnce({ _id: "session-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "project-1", name: "Study", config: {}, intake: {} });
    mocks.loadAnalysisGroundingContext.mockResolvedValueOnce({ questions: [], projectContext: {} });
    mocks.loadAnalysisParentRunArtifacts.mockResolvedValueOnce({ artifactKeys: {}, bannerPlan: { bannerCuts: [] } });
    mocks.runAnalysisBannerExtensionPreflight.mockResolvedValueOnce({
      frozenBannerGroup,
      frozenValidatedGroup,
      reviewFlags: {
        requiresClarification: false,
        requiresReview: false,
        reasons: [],
        averageConfidence: 0.95,
        policyFallbackDetected: false,
      },
      fingerprint: "opaque-token",
      promptSummary: "Direct match",
    });
    mocks.mutateInternal
      .mockResolvedValueOnce("user-message-1")
      .mockResolvedValueOnce("job-1")
      .mockResolvedValueOnce("assistant-message-1");

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/compute/preflight", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", requestText: "Add region", clientTurnId: "turn-direct-1" }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      jobId: "job-1",
      status: "proposed",
      job: {
        id: "job-1",
        effectiveStatus: "proposed",
        confirmToken: "opaque-token",
        proposedGroup: { groupName: "Region" },
      },
    });
    expect(payload).not.toHaveProperty("fingerprint");
    expect(payload).not.toHaveProperty("proposedGroup");
    expect(payload).not.toHaveProperty("validatedGroup");
    expect(payload.job).not.toHaveProperty("frozenBannerGroup");
    expect(payload.job).not.toHaveProperty("frozenValidatedGroup");

    const assistantMessage = mocks.mutateInternal.mock.calls[2][1].content as string;
    expect(mocks.mutateInternal.mock.calls[0][1]).toMatchObject({
      clientTurnId: "turn-direct-1",
      role: "user",
    });
    expect(mocks.mutateInternal.mock.calls[1][1]).toMatchObject({
      originClientTurnId: "turn-direct-1",
      originUserMessageId: "user-message-1",
    });
    expect(mocks.mutateInternal.mock.calls[2][1]).toMatchObject({
      clientTurnId: "turn-direct-1",
      role: "assistant",
    });
    expect(assistantMessage).toContain("Review the proposal card");
    expect(assistantMessage).not.toContain("REGION == 1");
    expect(assistantMessage).not.toContain("REGION=1");
  });

  it("returns a clear eligibility error when parent planning artifacts are missing", async () => {
    mocks.query
      .mockResolvedValueOnce({ _id: "run-1", status: "success", result: {}, config: {} })
      .mockResolvedValueOnce({ _id: "session-1", runId: "run-1", projectId: "project-1" })
      .mockResolvedValueOnce({ _id: "project-1", name: "Study", config: {}, intake: {} });
    mocks.loadAnalysisGroundingContext.mockResolvedValueOnce({ questions: [], projectContext: {} });
    mocks.loadAnalysisParentRunArtifacts.mockRejectedValueOnce(
      new Error("Parent run is missing required artifact: planning/20-banner-plan.json"),
    );

    const response = await POST(
      new NextRequest("http://localhost/api/runs/run-1/analysis/compute/preflight", {
        method: "POST",
        body: JSON.stringify({ sessionId: "session-1", requestText: "Add region" }),
      }),
      { params: Promise.resolve({ runId: "run-1" }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This run is missing the planning artifacts required to create a derived run. Start from a newer completed run, or rerun this project before using Create derived run.",
    });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });
});
