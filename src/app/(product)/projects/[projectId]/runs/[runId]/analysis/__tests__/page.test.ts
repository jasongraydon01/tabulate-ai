import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  query: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
}));

vi.mock("@/lib/requireConvexAuth", () => ({
  requireConvexAuth: vi.fn(async () => ({
    convexOrgId: "org-1",
    convexUserId: "user-1",
    role: "admin",
  })),
}));

vi.mock("@/lib/convex", () => ({
  getConvexClient: () => ({ query: mocks.query }),
}));

vi.mock("@/components/analysis/AnalysisWorkspace", () => ({
  AnalysisWorkspace: ({
    projectId,
    projectName,
    runId,
    runStatus,
  }: {
    projectId: string;
    projectName: string;
    runId: string;
    runStatus: string;
  }) => (
    React.createElement(
      "div",
      null,
      `${projectName}:${projectId}:${runId}:${runStatus}`,
    )
  ),
}));

describe("run analysis page", () => {
  let Page: typeof import("@/app/(product)/projects/[projectId]/runs/[runId]/analysis/page").default;

  beforeEach(async () => {
    if (!Page) {
      ({ default: Page } = await import("@/app/(product)/projects/[projectId]/runs/[runId]/analysis/page"));
    }
    vi.clearAllMocks();
  });

  it("renders the analysis workspace when the run belongs to the project", async () => {
    mocks.query
      .mockResolvedValueOnce({
        _id: "project-1",
        name: "Consumer Tracking",
      })
      .mockResolvedValueOnce({
        _id: "run-1",
        projectId: "project-1",
        status: "success",
      });

    const markup = renderToStaticMarkup(
      await Page({
        params: Promise.resolve({ projectId: "project-1", runId: "run-1" }),
      }),
    );

    expect(markup).toContain("Consumer Tracking:project-1:run-1:success");
    expect(mocks.notFound).not.toHaveBeenCalled();
  });

  it("throws notFound when the run does not belong to the project", async () => {
    mocks.query
      .mockResolvedValueOnce({
        _id: "project-1",
        name: "Consumer Tracking",
      })
      .mockResolvedValueOnce({
        _id: "run-1",
        projectId: "project-2",
        status: "success",
      });

    await expect(
      Page({
        params: Promise.resolve({ projectId: "project-1", runId: "run-1" }),
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledTimes(1);
  });
});
