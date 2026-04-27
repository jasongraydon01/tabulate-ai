import { loadAnalysisGroundingContext, type AnalysisGroundingContext } from "@/lib/analysis/grounding";
import { loadAnalysisParentRunArtifacts } from "@/lib/analysis/computeLane/artifactLoader";
import { buildAnalysisComputeJobView, type AnalysisComputeJobView } from "@/lib/analysis/computeLane/jobView";
import { runAnalysisBannerExtensionPreflight } from "@/lib/analysis/computeLane/preflight";
import { mutateInternal } from "@/lib/convex";
import { resolvePipelineOutputDir } from "@/lib/paths/outputs";
import { sanitizeDatasetName } from "@/lib/api/fileHandler";
import { internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";

export type AnalysisComputeProposalStatus = "proposed" | "needs_clarification";

export class AnalysisComputeProposalError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly code: "not_eligible" | "expired" | "missing_artifacts" | "preflight_failed",
  ) {
    super(message);
    this.name = "AnalysisComputeProposalError";
  }
}

export interface AnalysisComputeProposalSummary {
  jobId: string;
  jobType: "banner_extension_recompute";
  status: AnalysisComputeProposalStatus;
  groupName: string;
  cuts: Array<{
    name: string;
    userSummary?: string;
    confidence?: number;
    expressionType?: string;
  }>;
  reviewFlags: {
    requiresClarification: boolean;
    requiresReview: boolean;
    reasons: string[];
    averageConfidence: number;
    policyFallbackDetected: boolean;
    draftConfidence?: number;
  };
  message: string;
}

export interface CreateAnalysisBannerExtensionProposalResult {
  proposal: AnalysisComputeProposalSummary;
  job: AnalysisComputeJobView;
}

interface ParentRunForProposal {
  _id: Id<"runs">;
  status: string;
  result?: unknown;
  expiredAt?: number;
  artifactsPurgedAt?: number;
}

interface ProjectForProposal {
  _id: Id<"projects">;
  name: string;
  config?: Record<string, unknown> | null;
  intake?: Record<string, unknown> | null;
}

interface SessionForProposal {
  _id: Id<"analysisSessions">;
  runId: Id<"runs">;
  projectId: Id<"projects">;
}

export function isMissingParentArtifactError(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Parent run is missing required artifact:");
}

export function formatAnalysisComputeProposalMessage(params: {
  groupName: string;
  requiresClarification: boolean;
  reasons: string[];
}): string {
  if (params.requiresClarification) {
    return [
      "TabulateAI needs one clarification before creating a derived run.",
      ...params.reasons.map((reason) => `- ${reason}`),
    ].join("\n");
  }

  return [
    `I prepared a derived-run proposal for ${params.groupName}.`,
    "",
    "Review the proposal card before confirming. The original tables in this run's table set will stay as they are; the proposed cuts would be appended in a derived run after you confirm.",
  ].join("\n");
}

function buildSafeProposal(params: {
  jobId: Id<"analysisComputeJobs">;
  status: AnalysisComputeProposalStatus;
  job: AnalysisComputeJobView;
  message: string;
}): AnalysisComputeProposalSummary {
  return {
    jobId: String(params.jobId),
    jobType: "banner_extension_recompute",
    status: params.status,
    groupName: params.job.proposedGroup?.groupName ?? "Derived banner group",
    cuts: (params.job.proposedGroup?.cuts ?? []).map((cut) => ({
      name: cut.name,
      ...(cut.userSummary ? { userSummary: cut.userSummary } : {}),
      ...(typeof cut.confidence === "number" ? { confidence: cut.confidence } : {}),
      ...(cut.expressionType ? { expressionType: cut.expressionType } : {}),
    })),
    reviewFlags: params.job.reviewFlags ?? {
      requiresClarification: false,
      requiresReview: false,
      reasons: [],
      averageConfidence: 0,
      policyFallbackDetected: false,
    },
    message: params.message,
  };
}

export function formatAnalysisComputeProposalToolResult(
  result: CreateAnalysisBannerExtensionProposalResult,
): AnalysisComputeProposalSummary {
  return result.proposal;
}

export async function createAnalysisBannerExtensionProposal(params: {
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  parentRunId: Id<"runs">;
  sessionId: Id<"analysisSessions">;
  requestedBy: Id<"users">;
  originClientTurnId?: string;
  originUserMessageId?: Id<"analysisMessages">;
  requestText: string;
  parentRun: ParentRunForProposal;
  project: ProjectForProposal;
  session: SessionForProposal;
  groundingContext?: AnalysisGroundingContext;
  transcriptMode?: "none" | "route_breadcrumbs";
  abortSignal?: AbortSignal;
}): Promise<CreateAnalysisBannerExtensionProposalResult> {
  const requestText = params.requestText.trim();
  let originUserMessageId = params.originUserMessageId;
  if (!requestText) {
    throw new AnalysisComputeProposalError("Request text is required", 400, "not_eligible");
  }
  if (params.parentRun.status !== "success" && params.parentRun.status !== "partial") {
    throw new AnalysisComputeProposalError(
      "Analysis compute requires a completed parent run",
      409,
      "not_eligible",
    );
  }
  if (params.parentRun.expiredAt || params.parentRun.artifactsPurgedAt) {
    throw new AnalysisComputeProposalError("Parent run artifacts have expired", 410, "expired");
  }

  try {
    const [groundingContext, parentArtifacts] = await Promise.all([
      params.groundingContext
        ? Promise.resolve(params.groundingContext)
        : loadAnalysisGroundingContext({
          runResultValue: params.parentRun.result,
          projectName: params.project.name,
          runStatus: params.parentRun.status,
          projectConfig: params.project.config,
          projectIntake: params.project.intake,
        }),
      loadAnalysisParentRunArtifacts(params.parentRun.result),
    ]);

    const preflightOutputDir = resolvePipelineOutputDir({
      datasetName: sanitizeDatasetName(`analysis-preflight-${String(params.parentRunId)}`),
      pipelineId: `preflight-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    });

    const preflight = await runAnalysisBannerExtensionPreflight({
      parentRunId: String(params.parentRunId),
      requestText,
      groundingContext,
      parentArtifacts,
      outputDir: preflightOutputDir,
      abortSignal: params.abortSignal,
    });

    if (params.transcriptMode === "route_breadcrumbs") {
      originUserMessageId = await mutateInternal(internal.analysisMessages.create, {
        sessionId: params.sessionId,
        orgId: params.orgId,
        ...(params.originClientTurnId ? { clientTurnId: params.originClientTurnId } : {}),
        role: "user",
        content: requestText,
        parts: [{ type: "text", text: requestText }],
      });
    }

    const status: AnalysisComputeProposalStatus = preflight.reviewFlags.requiresClarification
      ? "needs_clarification"
      : "proposed";
    const jobId = await mutateInternal(internal.analysisComputeJobs.createFromPreflight, {
      orgId: params.orgId,
      projectId: params.projectId,
      parentRunId: params.parentRunId,
      sessionId: params.sessionId,
      requestedBy: params.requestedBy,
      ...(params.originClientTurnId ? { originClientTurnId: params.originClientTurnId } : {}),
      ...(originUserMessageId ? { originUserMessageId } : {}),
      requestText,
      status,
      frozenBannerGroup: preflight.frozenBannerGroup,
      frozenValidatedGroup: preflight.frozenValidatedGroup,
      reviewFlags: preflight.reviewFlags,
      fingerprint: preflight.fingerprint,
      promptSummary: preflight.promptSummary,
    });

    const message = formatAnalysisComputeProposalMessage({
      groupName: preflight.frozenBannerGroup.groupName,
      requiresClarification: preflight.reviewFlags.requiresClarification,
      reasons: preflight.reviewFlags.reasons,
    });

    if (params.transcriptMode === "route_breadcrumbs") {
      await mutateInternal(internal.analysisMessages.create, {
        sessionId: params.sessionId,
        orgId: params.orgId,
        ...(params.originClientTurnId ? { clientTurnId: params.originClientTurnId } : {}),
        role: "assistant",
        content: message,
        parts: [{ type: "text", text: message }],
      });
    }

    const job = buildAnalysisComputeJobView({
      job: {
        _id: jobId,
        projectId: params.projectId,
        jobType: "banner_extension_recompute",
        status,
        requestText,
        frozenBannerGroup: preflight.frozenBannerGroup,
        frozenValidatedGroup: preflight.frozenValidatedGroup,
        reviewFlags: preflight.reviewFlags,
        fingerprint: preflight.fingerprint,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    });

    return {
      proposal: buildSafeProposal({
        jobId,
        status,
        job,
        message,
      }),
      job,
    };
  } catch (error) {
    if (isMissingParentArtifactError(error)) {
      throw new AnalysisComputeProposalError(
        "This run is missing the planning artifacts required to create a derived run. Start from a newer completed run, or rerun this project before using Create derived run.",
        409,
        "missing_artifacts",
      );
    }
    if (error instanceof AnalysisComputeProposalError) throw error;
    throw new AnalysisComputeProposalError(
      error instanceof Error ? error.message : "Preflight failed",
      500,
      "preflight_failed",
    );
  }
}
