import fs from "fs/promises";
import os from "os";
import path from "path";

import { api, internal } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { getConvexClient, mutateInternal, queryInternal } from "@/lib/convex";
import {
  fetchTable,
  parseResultsTablesArtifactForAnalysis,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";
import {
  assertAnalysisSelectedTableCutSpecV1,
  type AnalysisSelectedTableCutSpec,
} from "@/lib/analysis/computeLane/types";
import { runDerivedTableAnalysisContinuation } from "@/lib/analysis/continuation";
import { FETCH_TABLE_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import { isAnalysisTableCard, type AnalysisTableCard } from "@/lib/analysis/types";
import { downloadToTemp } from "@/lib/r2/R2FileManager";
import { parseRunResult } from "@/schemas/runResultSchema";
import { canonicalToComputeTables } from "@/lib/v3/runtime/compute/canonicalToComputeTables";
import { runComputePipeline } from "@/lib/v3/runtime/compute/runComputePipeline";
import { runPostV3Processing } from "@/lib/v3/runtime/postV3Processing";
import { createPipelineCheckpoint } from "@/lib/v3/runtime/contracts";
import { resolveStatConfig } from "@/lib/v3/runtime/compute/resolveStatConfig";
import type { CanonicalTableOutput } from "@/lib/v3/runtime/canonical/types";
import type { ProjectConfig } from "@/schemas/projectConfigSchema";

const TABLE_ENRICHED_PATH = "tables/13e-table-enriched.json";
const TABLE_CANONICAL_PATH = "tables/13d-table-canonical.json";
const DATA_FILE_PATH = "dataFile.sav";

export interface ClaimedSelectedTableCutJob {
  jobId: string;
  orgId: string;
  projectId: string;
  parentRunId: string;
  sessionId: string;
  requestedBy: string;
  requestText: string;
  frozenSelectedTableCutSpec: AnalysisSelectedTableCutSpec;
  fingerprint?: string;
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await fs.readFile(filePath, "utf-8")) as T;
}

function stripSignificance(card: AnalysisTableCard): AnalysisTableCard {
  return {
    ...card,
    columns: card.columns.map((column) => ({ ...column, statLetter: null })),
    columnGroups: card.columnGroups?.map((group) => ({
      ...group,
      columns: group.columns.map((column) => ({ ...column, statLetter: null })),
    })),
    rows: card.rows.map((row) => {
      const values = row.values.map((cell) => ({
        ...cell,
        sigHigherThan: [],
        sigVsTotal: null,
      }));
      return {
        ...row,
        values,
        cellsByCutKey: Object.fromEntries(values.map((cell) => [cell.cutKey ?? cell.cutName, cell])),
      };
    }),
    significanceTest: null,
    significanceLevel: null,
    comparisonGroups: [],
  };
}

function buildComputedTableContext(params: {
  tablesArtifact: ReturnType<typeof parseResultsTablesArtifactForAnalysis>;
}): AnalysisGroundingContext {
  return {
    availability: "available",
    tables: params.tablesArtifact.tables as AnalysisGroundingContext["tables"],
    derivedTables: {},
    brokenTables: {},
    questions: [],
    bannerGroups: [],
    bannerPlanGroups: [],
    bannerRouteMetadata: null,
    surveyMarkdown: null,
    surveyQuestions: [],
    projectContext: {
      projectName: null,
      runStatus: "success",
      studyMethodology: null,
      analysisMethod: null,
      bannerSource: null,
      bannerMode: null,
      tableCount: Object.keys(params.tablesArtifact.tables).length,
      bannerGroupCount: null,
      totalCuts: null,
      bannerGroupNames: [],
      researchObjectives: null,
      bannerHints: null,
      intakeFiles: {
        dataFile: null,
        survey: null,
        bannerPlan: null,
        messageList: null,
      },
    },
    tablesMetadata: {
      significanceTest: null,
      significanceLevel: null,
      comparisonGroups: [],
    },
    missingArtifacts: [],
  };
}

async function postFallbackDerivedTableMessage(params: {
  job: ClaimedSelectedTableCutJob;
  artifactId: Id<"analysisArtifacts">;
  cardTitle: string;
  cardTableId: string;
}) {
  const toolCallId = `selected-table-cut-${params.job.jobId}`;
  const alreadyPosted = await queryInternal(internal.analysisMessages.hasToolCallPart, {
    orgId: params.job.orgId as Id<"organizations">,
    sessionId: params.job.sessionId as Id<"analysisSessions">,
    toolCallId,
  });
  if (alreadyPosted) return;

  const content = "The derived table is ready. I computed the confirmed selected-table cut and added it below.";
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

export async function runClaimedSelectedTableCutJob(job: ClaimedSelectedTableCutJob): Promise<void> {
  const convex = getConvexClient();
  let outputDir: string | null = null;

  try {
    assertAnalysisSelectedTableCutSpecV1(job.frozenSelectedTableCutSpec);
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

    const runResult = parseRunResult(run.result);
    const outputs = runResult?.r2Files?.outputs ?? {};
    const dataFileKey = outputs[DATA_FILE_PATH];
    const canonicalKey = outputs[TABLE_ENRICHED_PATH] ?? outputs[TABLE_CANONICAL_PATH];
    if (!dataFileKey) throw new Error("Parent run is missing dataFile.sav");
    if (!canonicalKey) throw new Error("Parent run is missing canonical table artifacts");

    outputDir = await fs.mkdtemp(path.join(os.tmpdir(), `tabulate-selected-cut-${job.jobId}-`));
    await Promise.all([
      downloadToTemp(dataFileKey, path.join(outputDir, DATA_FILE_PATH)),
      downloadToTemp(canonicalKey, path.join(outputDir, TABLE_ENRICHED_PATH)),
    ]);

    const canonicalOutput = await readJson<CanonicalTableOutput>(path.join(outputDir, TABLE_ENRICHED_PATH));
    const sourceCanonical = canonicalOutput.tables?.find((table) =>
      table.tableId === job.frozenSelectedTableCutSpec.sourceTable.tableId,
    );
    if (!sourceCanonical) {
      throw new Error(`Source table ${job.frozenSelectedTableCutSpec.sourceTable.tableId} is not available in canonical artifacts`);
    }

    const pipelineId = `analysis-selected-table-cut-${job.jobId}`;
    const computeResult = await runComputePipeline({
      tables: canonicalToComputeTables([sourceCanonical]),
      crosstabPlan: {
        bannerCuts: [job.frozenSelectedTableCutSpec.resolvedComputePlan.validatedGroup],
      },
      outputDir,
      pipelineId,
      dataset: project.name ?? "analysis-selected-table-cut",
      checkpoint: createPipelineCheckpoint(pipelineId, project.name ?? "analysis-selected-table-cut"),
      statTestingConfig: resolveStatConfig({
        wizard: (project.config as ProjectConfig | undefined)?.statTesting
          ? {
              thresholds: (project.config as ProjectConfig).statTesting.thresholds,
              minBase: (project.config as ProjectConfig).statTesting.minBase,
            }
          : undefined,
      }),
      weightVariable: (project.config as ProjectConfig | undefined)?.weightVariable,
      maxRespondents: (project.config as ProjectConfig | undefined)?.maxRespondents,
    });

    await runPostV3Processing({
      compute: computeResult,
      outputDir,
      dataFilePath: DATA_FILE_PATH,
      pipelineId,
      dataset: project.name ?? "analysis-selected-table-cut",
      format: (project.config as ProjectConfig | undefined)?.format ?? "standard",
      displayMode: (project.config as ProjectConfig | undefined)?.displayMode ?? "frequency",
      separateWorkbooks: false,
      theme: (project.config as ProjectConfig | undefined)?.theme,
      log: (message) => console.log(message),
    });

    const resultsPath = (project.config as ProjectConfig | undefined)?.weightVariable
      ? path.join(outputDir, "results", "tables-weighted.json")
      : path.join(outputDir, "results", "tables.json");
    const tablesArtifact = parseResultsTablesArtifactForAnalysis(await readJson<unknown>(resultsPath));
    const computedContext = buildComputedTableContext({ tablesArtifact });
    const fetched = fetchTable(computedContext, {
      tableId: job.frozenSelectedTableCutSpec.sourceTable.tableId,
      cutGroups: "*",
    });
    if (fetched.status !== "available") {
      throw new Error(`Computed table ${job.frozenSelectedTableCutSpec.sourceTable.tableId} is not available`);
    }

    const groupKeys = fetched.columnGroups
      ?.filter((group) => group.groupName === job.frozenSelectedTableCutSpec.groupName)
      .map((group) => group.groupKey) ?? [];
    const card = stripSignificance({
      ...fetched,
      tableId: `${fetched.tableId}__cut_${job.jobId}`,
      title: `${fetched.title} — Derived cut`,
      tableSubtitle: "Computed derived table",
      userNote: "Computed by TabulateAI from the confirmed selected-table cut. Significance markers are not shown for this derived table.",
      focusedGroupKeys: groupKeys.length > 0 ? groupKeys : null,
      sourceRefs: [
        ...fetched.sourceRefs,
        { refType: "table", refId: job.frozenSelectedTableCutSpec.sourceTable.tableId, label: `Source table: ${job.frozenSelectedTableCutSpec.sourceTable.title}` },
      ],
    });

    const sourceTableIds = [job.frozenSelectedTableCutSpec.sourceTable.tableId];
    const sourceQuestionIds = typeof job.frozenSelectedTableCutSpec.sourceTable.questionId === "string"
      && job.frozenSelectedTableCutSpec.sourceTable.questionId.length > 0
      ? [job.frozenSelectedTableCutSpec.sourceTable.questionId]
      : [];

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
        derivationType: "selected_table_cut",
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
        sourceTableTitle: job.frozenSelectedTableCutSpec.sourceTable.title,
      });
    } catch (continuationError) {
      console.warn("[SelectedTableCutCompletion] Analysis continuation failed; posting fallback table card.", continuationError);
      await postFallbackDerivedTableMessage({
        job,
        artifactId,
        cardTitle: messageCard.title,
        cardTableId: messageCard.tableId,
      });
    }
  } catch (error) {
    const safeMessage = "The selected-table cut could not be completed. Please revise the request and try again.";
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
  } finally {
    if (outputDir) {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
