import { NextRequest, NextResponse } from "next/server";

import { loadAnalysisParentRunArtifacts } from "@/lib/analysis/computeLane/artifactLoader";
import { buildAnalysisComputeFingerprint } from "@/lib/analysis/computeLane/fingerprint";
import {
  isAnalysisTableRollupSpecV2,
  UNSUPPORTED_TABLE_ROLLUP_SPEC_MESSAGE,
} from "@/lib/analysis/computeLane/types";
import { buildWorkerExecutionPayload, buildWorkerPipelineContext, normalizeWizardWorkerInputRefs } from "@/lib/worker/buildExecutionPayload";
import { getConvexClient, mutateInternal, queryInternal } from "@/lib/convex";
import { requireConvexAuth, AuthenticationError } from "@/lib/requireConvexAuth";
import { applyRateLimit } from "@/lib/withRateLimit";
import { BannerGroupSchema } from "@/schemas/bannerPlanSchema";
import { ValidatedGroupSchema } from "@/schemas/agentOutputSchema";
import { api, internal } from "../../../../../../../../../../convex/_generated/api";
import type { Id } from "../../../../../../../../../../convex/_generated/dataModel";

const CONVEX_ID_RE = /^[a-zA-Z0-9_.-]+$/;
const REQUIRED_PARENT_OUTPUTS = [
  "planning/20-banner-plan.json",
  "planning/21-crosstab-plan.json",
  "enrichment/12-questionid-final.json",
  "tables/13e-table-enriched.json",
  "tables/13d-table-canonical.json",
  "dataFile.sav",
  "agents/loop-semantics/loop-semantics-policy.json",
] as const;

function pickParentOutputs(outputs: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    REQUIRED_PARENT_OUTPUTS.flatMap((relativePath) => {
      const key = outputs[relativePath];
      return key ? [[relativePath, key] as const] : [];
    }),
  );
}

function routeErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV === "development" && error instanceof Error) {
    return error.message;
  }
  return fallback;
}

function getMissingRequiredArtifactNames(parentArtifacts: Awaited<ReturnType<typeof loadAnalysisParentRunArtifacts>>): string[] {
  const missing: string[] = [];
  if (!parentArtifacts.artifactKeys.bannerPlan) missing.push("planning/20-banner-plan.json");
  if (!parentArtifacts.artifactKeys.crosstabPlan) missing.push("planning/21-crosstab-plan.json");
  if (!parentArtifacts.artifactKeys.questionIdFinal) missing.push("enrichment/12-questionid-final.json");
  if (!parentArtifacts.artifactKeys.dataFileSav) missing.push("dataFile.sav");
  if (!parentArtifacts.artifactKeys.tableEnriched && !parentArtifacts.artifactKeys.tableCanonical) {
    missing.push("tables/13e-table-enriched.json or tables/13d-table-canonical.json");
  }
  return missing;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string; jobId: string }> },
) {
  try {
    const { runId, jobId } = await params;
    if (!runId || !jobId || !CONVEX_ID_RE.test(runId) || !CONVEX_ID_RE.test(jobId)) {
      return NextResponse.json({ error: "Invalid run or job ID" }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), "high", "runs/analysis/compute/confirm");
    if (rateLimited) return rateLimited;

    const body = await request.json().catch(() => null) as { fingerprint?: unknown } | null;
    const fingerprint = typeof body?.fingerprint === "string" ? body.fingerprint : "";
    if (!fingerprint) {
      return NextResponse.json({ error: "Fingerprint is required" }, { status: 400 });
    }

    const convex = getConvexClient();
    const [run, job] = await Promise.all([
      convex.query(api.runs.get, {
        runId: runId as Id<"runs">,
        orgId: auth.convexOrgId,
      }),
      queryInternal(internal.analysisComputeJobs.getById, {
        orgId: auth.convexOrgId,
        jobId: jobId as Id<"analysisComputeJobs">,
      }),
    ]);

    if (!run) return NextResponse.json({ error: "Run not found" }, { status: 404 });
    if (!job || String(job.parentRunId) !== runId) {
      return NextResponse.json({ error: "Analysis compute job not found" }, { status: 404 });
    }
    if (run.status !== "success" && run.status !== "partial") {
      return NextResponse.json({ error: "Analysis compute requires a completed parent run" }, { status: 409 });
    }
    if (run.expiredAt || run.artifactsPurgedAt) {
      return NextResponse.json({ error: "Parent run artifacts have expired" }, { status: 410 });
    }
    if (job.fingerprint !== fingerprint) {
      return NextResponse.json({ error: "Analysis compute job changed; rerun preflight" }, { status: 409 });
    }
    if (job.reviewFlags?.requiresClarification || job.reviewFlags?.requiresReview) {
      return NextResponse.json({ error: "This proposed group needs clarification before compute" }, { status: 409 });
    }
    if (job.status !== "proposed" && job.status !== "confirmed" && job.status !== "queued") {
      return NextResponse.json({ error: `Analysis compute job cannot be confirmed from status ${job.status}` }, { status: 409 });
    }
    if (job.jobType === "table_rollup_derivation") {
      if (!job.frozenTableRollupSpec) {
        return NextResponse.json({ error: "Analysis compute job is missing frozen roll-up spec" }, { status: 409 });
      }
      if (!isAnalysisTableRollupSpecV2(job.frozenTableRollupSpec)) {
        return NextResponse.json({ error: UNSUPPORTED_TABLE_ROLLUP_SPEC_MESSAGE }, { status: 409 });
      }
      const enqueueResult = await mutateInternal(internal.analysisComputeJobs.confirmTableRollupJob, {
        orgId: auth.convexOrgId,
        jobId: job._id,
        parentRunId: run._id,
        expectedFingerprint: fingerprint,
      });

      if (!enqueueResult.alreadyQueued) {
        const message = "Confirmed. TabulateAI queued the derived table. I will add it here when it finishes.";
        await mutateInternal(internal.analysisMessages.create, {
          sessionId: job.sessionId,
          orgId: auth.convexOrgId,
          role: "assistant",
          content: message,
          parts: [{ type: "text", text: message }],
        });
      }

      return NextResponse.json({
        accepted: true,
        alreadyQueued: enqueueResult.alreadyQueued,
        derivedArtifactId: enqueueResult.derivedArtifactId ? String(enqueueResult.derivedArtifactId) : null,
      });
    }
    if (job.childRunId) {
      return NextResponse.json({ accepted: true, childRunId: String(job.childRunId), alreadyQueued: true });
    }
    if (!job.frozenBannerGroup || !job.frozenValidatedGroup) {
      return NextResponse.json({ error: "Analysis compute job is missing frozen preflight artifacts" }, { status: 409 });
    }
    const frozenBannerGroup = BannerGroupSchema.parse(job.frozenBannerGroup);
    const frozenValidatedGroup = ValidatedGroupSchema.parse(job.frozenValidatedGroup);

    const project = await convex.query(api.projects.get, {
      projectId: job.projectId,
      orgId: auth.convexOrgId,
    });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

    const parentArtifacts = await loadAnalysisParentRunArtifacts(run.result);
    const missingArtifacts = getMissingRequiredArtifactNames(parentArtifacts);
    if (missingArtifacts.length > 0) {
      return NextResponse.json(
        { error: `Parent run is missing required recompute artifacts: ${missingArtifacts.join(", ")}` },
        { status: 409 },
      );
    }
    const parentDataFileSav = parentArtifacts.artifactKeys.dataFileSav;
    if (!parentDataFileSav) {
      return NextResponse.json({ error: "Parent run is missing dataFile.sav for recompute" }, { status: 409 });
    }

    const currentFingerprint = buildAnalysisComputeFingerprint({
      parentRunId: runId,
      parentArtifactKeys: parentArtifacts.artifactKeys,
      requestText: job.requestText,
      frozenBannerGroup,
      frozenValidatedGroup,
    });
    if (currentFingerprint !== fingerprint) {
      return NextResponse.json({ error: "Parent run artifacts changed; rerun preflight" }, { status: 409 });
    }

    const pipelineContext = buildWorkerPipelineContext({
      dataFileName: `${parentArtifacts.parentDatasetName}-analysis-extension.sav`,
    });

    const executionPayload = buildWorkerExecutionPayload({
      sessionId: String(job.sessionId),
      pipelineContext,
      fileNames: {
        dataMap: `${parentArtifacts.parentDatasetName}.sav`,
        bannerPlan: "",
        dataFile: `${parentArtifacts.parentDatasetName}.sav`,
        survey: null,
        messageList: null,
      },
      inputRefs: normalizeWizardWorkerInputRefs({
        dataMap: null,
        bannerPlan: null,
        spss: parentDataFileSav,
        survey: null,
        messageList: null,
      }),
      loopStatTestingMode: run.config.loopStatTestingMode,
      analysisExtension: {
        kind: "banner_extension",
        jobId,
        parentRunId: runId,
        parentPipelineId: parentArtifacts.parentPipelineId,
        parentDatasetName: parentArtifacts.parentDatasetName,
        parentR2Outputs: pickParentOutputs(parentArtifacts.outputs),
        frozenBannerGroup,
        frozenValidatedGroup,
        fingerprint,
      },
    });

    const enqueueResult = await mutateInternal(internal.runs.confirmAndEnqueueAnalysisChild, {
      projectId: job.projectId,
      orgId: auth.convexOrgId,
      parentRunId: run._id,
      analysisComputeJobId: job._id,
      expectedFingerprint: fingerprint,
      config: run.config,
      launchedBy: auth.convexUserId,
      queueClass: "project",
      executionPayload,
    });
    const childRunId = enqueueResult.childRunId;

    if (!enqueueResult.alreadyQueued) {
      const message = "Confirmed. TabulateAI queued a derived run for the new banner group. I will post back here when it finishes.";
      await mutateInternal(internal.analysisMessages.create, {
        sessionId: job.sessionId,
        orgId: auth.convexOrgId,
        role: "assistant",
        content: message,
        parts: [{ type: "text", text: message }],
      });
    }

    return NextResponse.json({
      accepted: true,
      childRunId: String(childRunId),
      alreadyQueued: enqueueResult.alreadyQueued,
      projectId: String(job.projectId),
      analysisUrl: `/projects/${encodeURIComponent(String(job.projectId))}/runs/${encodeURIComponent(String(childRunId))}/analysis`,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json({ error: routeErrorMessage(error, "Confirmation failed") }, { status: 500 });
  }
}
