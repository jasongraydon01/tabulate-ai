import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { canPerform } from "@/lib/permissions";
import { getConvexClient, mutateInternal } from "@/lib/convex";
import { api } from "../../../../convex/_generated/api";
import { internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { applyRateLimit } from "@/lib/withRateLimit";
import { getApiErrorDetails } from "@/lib/api/errorDetails";
import { bootstrapGoldenBaseline } from "@/lib/evaluation/bootstrapGoldenBaseline";
import { parseRunResult } from "@/schemas/runResultSchema";

type BaselineStatus = "draft" | "active";

function parseStatus(value: unknown): BaselineStatus {
  if (value === "draft") return "draft";
  return "active";
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), "high", "golden-baselines/create");
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, "submit_review")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const body = (rawBody ?? {}) as Record<string, unknown>;
    const runId = String(body.runId ?? "");
    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      return NextResponse.json({ error: "runId is required" }, { status: 400 });
    }

    const notes = typeof body.notes === "string" ? body.notes.trim() : undefined;
    const status = parseStatus(body.status);

    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });
    if (!run) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const runResult = parseRunResult(run.result);
    const outputDir = runResult?.outputDir ?? "";
    if (!outputDir) {
      return NextResponse.json({ error: "Run output directory is missing" }, { status: 400 });
    }

    const resolvedOutput = path.resolve(outputDir);
    const allowedBase = path.resolve(process.cwd(), "outputs");
    if (!resolvedOutput.startsWith(allowedBase + path.sep) && resolvedOutput !== allowedBase) {
      return NextResponse.json({ error: "Invalid run output path" }, { status: 400 });
    }

    const fallbackDatasetKey = path.basename(path.dirname(resolvedOutput));
    const requestedDatasetKey = typeof body.datasetKey === "string" ? body.datasetKey : "";
    const datasetKey = requestedDatasetKey.trim() || fallbackDatasetKey;

    const version = await convex.query(api.goldenBaselines.getNextVersion, {
      orgId: auth.convexOrgId,
      datasetKey,
    });

    const baseline = await bootstrapGoldenBaseline({
      runOutputDir: resolvedOutput,
      datasetKey,
      createdBy: auth.email || auth.name || "unknown",
      ...(notes ? { notes } : {}),
      version,
    });

    const baselineId = await mutateInternal(internal.goldenBaselines.register, {
      orgId: auth.convexOrgId,
      projectId: run.projectId,
      sourceRunId: run._id,
      datasetKey: baseline.datasetKey,
      artifactKeys: baseline.artifactKeys,
      version: baseline.version,
      status,
      ...(notes ? { notes } : {}),
      createdBy: auth.convexUserId,
    });

    return NextResponse.json({
      success: true,
      baseline: {
        baselineId,
        datasetKey: baseline.datasetKey,
        version: baseline.version,
        status,
        sourceRunId: baseline.sourceRunId,
        baselineDir: path.relative(process.cwd(), baseline.baselineDir),
        artifactKeys: baseline.artifactKeys,
      },
    });
  } catch (error) {
    console.error("[GoldenBaselines API] Error:", error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to create golden baseline", details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}
