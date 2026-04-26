import { api, internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getConvexClient, mutateInternal, queryInternal } from "@/lib/convex";
import { loadAnalysisGroundingContext } from "@/lib/analysis/grounding";
import { computeTableRollupArtifact } from "@/lib/analysis/computeLane/tableRollup";
import type { AnalysisTableRollupSpec } from "@/lib/analysis/computeLane/types";
import { runDerivedTableAnalysisContinuation } from "@/lib/analysis/continuation";
import { FETCH_TABLE_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import { isAnalysisTableCard } from "@/lib/analysis/types";

export interface ClaimedTableRollupJob {
  jobId: string;
  orgId: string;
  projectId: string;
  parentRunId: string;
  sessionId: string;
  requestedBy: string;
  requestText: string;
  frozenTableRollupSpec: AnalysisTableRollupSpec;
  fingerprint?: string;
}

async function postFallbackDerivedTableMessage(params: {
  job: ClaimedTableRollupJob;
  artifactId: Id<"analysisArtifacts">;
  cardTitle: string;
  cardTableId: string;
}) {
  const toolCallId = `derived-table-${params.job.jobId}`;
  const alreadyPosted = await queryInternal(internal.analysisMessages.hasToolCallPart, {
    orgId: params.job.orgId as Id<"organizations">,
    sessionId: params.job.sessionId as Id<"analysisSessions">,
    toolCallId,
  });
  if (alreadyPosted) return;

  const content = "The derived table is ready. I computed the confirmed roll-up and added it below so you can compare the grouped result against the source rows.";
  await mutateInternal(internal.analysisMessages.create, {
    sessionId: params.job.sessionId as Id<"analysisSessions">,
    orgId: params.job.orgId as Id<"organizations">,
    role: "assistant",
    content,
    parts: [
      { type: "text", text: content },
      {
        type: FETCH_TABLE_TOOL_TYPE,
        state: "output-available",
        artifactId: params.artifactId,
        label: params.cardTitle,
        toolCallId,
        input: { tableId: params.cardTableId },
      },
    ],
  });
}

export async function runClaimedTableRollupJob(job: ClaimedTableRollupJob): Promise<void> {
  const convex = getConvexClient();
  try {
    const [run, project] = await Promise.all([
      convex.query(api.runs.get, {
        runId: job.parentRunId as Id<"runs">,
        orgId: job.orgId as Id<"organizations">,
      }),
      convex.query(api.projects.get, {
        projectId: job.projectId as Id<"projects">,
        orgId: job.orgId as Id<"organizations">,
      }),
    ]);
    if (!run) throw new Error("Parent run not found");
    if (!project) throw new Error("Project not found");
    if (run.status !== "success" && run.status !== "partial") {
      throw new Error("Analysis compute requires a completed parent run");
    }
    if (run.expiredAt || run.artifactsPurgedAt) {
      throw new Error("Parent run artifacts have expired");
    }

    const groundingContext = await loadAnalysisGroundingContext({
      runResultValue: run.result,
      projectName: project.name,
      runStatus: run.status,
      projectConfig: project.config,
      projectIntake: project.intake,
    });
    const card = computeTableRollupArtifact({
      groundingContext,
      spec: job.frozenTableRollupSpec,
      jobId: job.jobId,
    });
    const sourceTableIds = job.frozenTableRollupSpec.sourceTables.map((table) => table.tableId);
    const sourceQuestionIds = job.frozenTableRollupSpec.sourceTables
      .map((table) => table.questionId)
      .filter((questionId): questionId is string => typeof questionId === "string" && questionId.length > 0);

    const existingArtifact = await queryInternal(internal.analysisArtifacts.getByAnalysisComputeJob, {
      orgId: job.orgId as Id<"organizations">,
      sessionId: job.sessionId as Id<"analysisSessions">,
      jobId: job.jobId as Id<"analysisComputeJobs">,
    });
    const artifactId = existingArtifact?._id ?? await mutateInternal(internal.analysisArtifacts.create, {
      sessionId: job.sessionId as Id<"analysisSessions">,
      orgId: job.orgId as Id<"organizations">,
      projectId: job.projectId as Id<"projects">,
      runId: job.parentRunId as Id<"runs">,
      artifactType: "table_card",
      sourceClass: "computed_derivation",
      title: card.title,
      sourceTableIds,
      sourceQuestionIds,
      lineage: {
        sourceRunId: job.parentRunId as Id<"runs">,
        sourceTableIds,
        analysisComputeJobId: job.jobId as Id<"analysisComputeJobs">,
        derivationType: "answer_option_rollup",
      },
      payload: card,
      createdBy: job.requestedBy as Id<"users">,
    });

    const attachResult = await mutateInternal(internal.analysisComputeJobs.attachDerivedArtifact, {
      orgId: job.orgId as Id<"organizations">,
      jobId: job.jobId as Id<"analysisComputeJobs">,
      artifactId,
    });
    if (attachResult?.skipped) return;

    const messageCard = existingArtifact && isAnalysisTableCard(existingArtifact.payload)
      ? existingArtifact.payload
      : card;
    try {
      await runDerivedTableAnalysisContinuation({
        orgId: job.orgId as Id<"organizations">,
        projectId: job.projectId as Id<"projects">,
        runId: job.parentRunId as Id<"runs">,
        sessionId: job.sessionId as Id<"analysisSessions">,
        requestedBy: job.requestedBy as Id<"users">,
        derivedArtifactId: artifactId,
        derivedTableId: messageCard.tableId,
        requestText: job.requestText,
        sourceTableTitle: job.frozenTableRollupSpec.sourceTables[0]?.title ?? null,
      });
    } catch (continuationError) {
      console.warn("[TableRollupCompletion] Analysis continuation failed; posting fallback table card.", continuationError);
      await postFallbackDerivedTableMessage({
        job,
        artifactId,
        cardTitle: messageCard.title,
        cardTableId: messageCard.tableId,
      });
    }
  } catch (error) {
    const safeMessage = "The derived table could not be completed. Please revise the request and try again.";
    await mutateInternal(internal.analysisComputeJobs.updateStatus, {
      jobId: job.jobId as Id<"analysisComputeJobs">,
      status: "failed",
      error: safeMessage,
    });
    await mutateInternal(internal.analysisMessages.create, {
      sessionId: job.sessionId as Id<"analysisSessions">,
      orgId: job.orgId as Id<"organizations">,
      role: "assistant",
      content: safeMessage,
      parts: [{ type: "text", text: safeMessage }],
    });
    throw error;
  }
}
