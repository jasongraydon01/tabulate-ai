import { processGroupV2 } from "@/agents/CrosstabAgentV2";
import { mutateInternal } from "@/lib/convex";
import { fetchTable, type AnalysisGroundingContext } from "@/lib/analysis/grounding";
import { buildAnalysisSelectedTableCutFingerprint } from "@/lib/analysis/computeLane/fingerprint";
import { getPipelineContext, runWithPipelineContext } from "@/lib/pipeline/PipelineContext";
import { extractAllColumns } from "@/lib/questionContext";
import { parseRunResult } from "@/schemas/runResultSchema";
import type { Id } from "../../../../convex/_generated/dataModel";
import { internal } from "../../../../convex/_generated/api";
import type {
  AnalysisSelectedTableCut,
  AnalysisSelectedTableCutSourceTableSpec,
  AnalysisSelectedTableCutSpec,
} from "@/lib/analysis/computeLane/types";

const MAX_CUTS_PER_GROUP = 20;

export interface AnalysisSelectedTableCutCandidate {
  sourceTableId: string;
  groupName: string;
  variable: string;
  cuts: AnalysisSelectedTableCut[];
}

export type AnalysisSelectedTableCutToolResult =
  | {
      status: "validated_proposal";
      jobId: string;
      jobType: "selected_table_cut_derivation";
      message: string;
      sourceTable: AnalysisSelectedTableCutSourceTableSpec;
      groupName: string;
      variable: string;
      cuts: AnalysisSelectedTableCut[];
    }
  | {
      status: "rejected_candidate";
      message: string;
      reasons: string[];
      repairHints: string[];
      invalidTableIds: string[];
      invalidVariables: string[];
      invalidCuts: Array<{ name: string; original: string; reason: string }>;
    };

interface ParentRunForSelectedTableCut {
  _id: Id<"runs">;
  status: string;
  result?: unknown;
  expiredAt?: number;
  artifactsPurgedAt?: number;
}

interface ValidationRejection {
  reasons: string[];
  repairHints: string[];
  invalidTableIds: string[];
  invalidVariables: string[];
  invalidCuts: Array<{ name: string; original: string; reason: string }>;
}

function emptyRejection(): ValidationRejection {
  return {
    reasons: [],
    repairHints: [],
    invalidTableIds: [],
    invalidVariables: [],
    invalidCuts: [],
  };
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function buildRejectedResult(rejection: ValidationRejection): AnalysisSelectedTableCutToolResult {
  return {
    status: "rejected_candidate",
    message: "TabulateAI could not validate that selected-table cut candidate. Use the repair hints, search the run context if needed, and retry only if the fix is clear from the artifacts.",
    reasons: uniqueStrings(rejection.reasons),
    repairHints: uniqueStrings(rejection.repairHints),
    invalidTableIds: uniqueStrings(rejection.invalidTableIds),
    invalidVariables: uniqueStrings(rejection.invalidVariables),
    invalidCuts: rejection.invalidCuts,
  };
}

function derivePreflightPipelineId(parentRunId: string): string {
  return `analysis-selected-table-cut-preflight-${parentRunId}`;
}

function variableExists(context: AnalysisGroundingContext, variable: string): boolean {
  return context.questions.some((question) =>
    question.items.some((item) => item.column === variable),
  );
}

function parentRunTableExists(context: AnalysisGroundingContext, tableId: string): boolean {
  return Boolean(context.tables[tableId]);
}

function sourceTableUsesLoopedQuestion(context: AnalysisGroundingContext, questionId: string | null): boolean {
  if (!questionId) return false;
  const sourceQuestion = context.questions.find((question) => question.questionId === questionId);
  return (sourceQuestion?.loop?.iterationCount ?? 0) > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function expressionReferencesVariable(expression: string, variable: string): boolean {
  const escaped = escapeRegExp(variable);
  return new RegExp(`(^|[^A-Za-z0-9_.])\`?${escaped}\`?([^A-Za-z0-9_.]|$)`).test(expression);
}

function buildValidationOriginal(variable: string, original: string): string {
  return `${variable}: ${original}`;
}

export async function createAnalysisSelectedTableCutProposal(params: {
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  parentRunId: Id<"runs">;
  sessionId: Id<"analysisSessions">;
  requestedBy: Id<"users">;
  originClientTurnId?: string;
  originUserMessageId?: Id<"analysisMessages">;
  requestText: string;
  candidate: AnalysisSelectedTableCutCandidate;
  parentRun: ParentRunForSelectedTableCut;
  groundingContext: AnalysisGroundingContext;
  abortSignal?: AbortSignal;
}): Promise<AnalysisSelectedTableCutToolResult> {
  const rejection = emptyRejection();
  const requestText = params.requestText.trim();
  const sourceTableId = params.candidate.sourceTableId.trim();
  const groupName = params.candidate.groupName.trim();
  const variable = params.candidate.variable.trim();
  const cuts = params.candidate.cuts.map((cut) => ({
    name: cut.name.trim(),
    original: cut.original.trim(),
  }));

  if (!requestText) rejection.reasons.push("Request text is required.");
  if (params.parentRun.status !== "success" && params.parentRun.status !== "partial") {
    rejection.reasons.push("Analysis compute requires a completed parent run.");
  }
  if (params.parentRun.expiredAt || params.parentRun.artifactsPurgedAt) {
    rejection.reasons.push("Parent run artifacts have expired.");
  }
  if (!sourceTableId) rejection.reasons.push("Choose exactly 1 source table for a selected-table cut.");
  if (!groupName) rejection.reasons.push("A selected-table cut needs a group name.");
  if (!variable) rejection.reasons.push("A selected-table cut needs an exact source variable.");
  if (cuts.length === 0 || cuts.length > MAX_CUTS_PER_GROUP) {
    rejection.reasons.push(`A selected-table cut group needs between 1 and ${MAX_CUTS_PER_GROUP} cuts.`);
  }
  for (const cut of cuts) {
    if (!cut.name || !cut.original) {
      rejection.invalidCuts.push({ name: cut.name, original: cut.original, reason: "Each cut needs a display name and a plain-language definition." });
    }
  }

  const tableResult = sourceTableId
    ? fetchTable(params.groundingContext, { tableId: sourceTableId, cutGroups: "*" })
    : null;
  if (sourceTableId && tableResult?.status !== "available") {
    rejection.invalidTableIds.push(sourceTableId);
    rejection.repairHints.push(`Search or fetch the table again; ${sourceTableId} was not available.`);
  }
  if (sourceTableId && tableResult?.status === "available" && !parentRunTableExists(params.groundingContext, sourceTableId)) {
    rejection.invalidTableIds.push(sourceTableId);
    rejection.repairHints.push("Selected-table cuts must target an original parent-run table, not a computed derived table.");
  }
  if (
    sourceTableId
    && tableResult?.status === "available"
    && sourceTableUsesLoopedQuestion(params.groundingContext, tableResult.questionId)
  ) {
    rejection.reasons.push("Selected-table cuts on looped source tables are not supported in this v1 path.");
    rejection.repairHints.push("Use an unlooped source table or ask for a full derived run when the cut needs loop-aware compute.");
  }
  if (variable && !variableExists(params.groundingContext, variable)) {
    rejection.invalidVariables.push(variable);
    rejection.repairHints.push("Use searchRunCatalog or getQuestionContext to identify the exact SPSS/source variable before retrying.");
  }

  if (
    rejection.reasons.length > 0
    || rejection.invalidTableIds.length > 0
    || rejection.invalidVariables.length > 0
    || rejection.invalidCuts.length > 0
    || !tableResult
    || tableResult.status !== "available"
  ) {
    return buildRejectedResult(rejection);
  }

  const sourceTable: AnalysisSelectedTableCutSourceTableSpec = {
    tableId: tableResult.tableId,
    title: tableResult.title,
    questionId: tableResult.questionId,
    questionText: tableResult.questionText,
  };

  const validationGroup = {
    groupName,
    columns: cuts.map((cut) => ({
      name: cut.name,
      original: buildValidationOriginal(variable, cut.original),
    })),
  };
  const allColumns = extractAllColumns(params.groundingContext.questions);
  const loopCount = params.groundingContext.questions.reduce(
    (max, question) => Math.max(max, question.loop?.iterationCount ?? 0),
    0,
  );
  const validateGroup = () => processGroupV2(
    params.groundingContext.questions,
    allColumns,
    validationGroup,
    {
      abortSignal: params.abortSignal,
      loopCount,
    },
  );

  const validatedGroup = getPipelineContext()
    ? await validateGroup()
    : await runWithPipelineContext(
      {
        pipelineId: derivePreflightPipelineId(String(params.parentRunId)),
        runId: String(params.parentRunId),
        source: "analysisPreflight",
      },
      validateGroup,
    );

  const invalidResolvedCuts = validatedGroup.columns.flatMap((column) => {
    if (column.confidence <= 0) {
      return [{ name: column.name, original: cuts.find((cut) => cut.name === column.name)?.original ?? column.name, reason: "The cut could not be resolved with confidence." }];
    }
    if (!expressionReferencesVariable(column.adjusted, variable)) {
      return [{ name: column.name, original: cuts.find((cut) => cut.name === column.name)?.original ?? column.name, reason: `The resolved cut did not reference the requested variable ${variable}.` }];
    }
    return [];
  });

  if (invalidResolvedCuts.length > 0) {
    rejection.invalidCuts.push(...invalidResolvedCuts);
    rejection.repairHints.push("Revise the cut definitions so each cut can be resolved against the exact requested variable.");
    return buildRejectedResult(rejection);
  }

  const frozenSelectedTableCutSpec: AnalysisSelectedTableCutSpec = {
    schemaVersion: 1,
    derivationType: "selected_table_cut",
    sourceTable,
    groupName,
    variable,
    cuts,
    resolvedComputePlan: {
      validatedGroup,
    },
  };
  const runResult = parseRunResult(params.parentRun.result);
  const parentArtifactKeys = runResult?.r2Files?.outputs ?? {};
  const fingerprint = buildAnalysisSelectedTableCutFingerprint({
    parentRunId: String(params.parentRunId),
    parentArtifactKeys,
    requestText,
    frozenSelectedTableCutSpec,
  });

  const jobId = await mutateInternal(internal.analysisComputeJobs.createSelectedTableCutProposal, {
    orgId: params.orgId,
    projectId: params.projectId,
    parentRunId: params.parentRunId,
    sessionId: params.sessionId,
    requestedBy: params.requestedBy,
    ...(params.originClientTurnId ? { originClientTurnId: params.originClientTurnId } : {}),
    ...(params.originUserMessageId ? { originUserMessageId: params.originUserMessageId } : {}),
    requestText,
    frozenSelectedTableCutSpec,
    reviewFlags: {
      requiresClarification: false,
      requiresReview: false,
      reasons: [],
      averageConfidence: 1,
      policyFallbackDetected: false,
    },
    fingerprint,
    promptSummary: `${sourceTable.title}: ${groupName}`,
  });

  return {
    status: "validated_proposal",
    jobId: String(jobId),
    jobType: "selected_table_cut_derivation",
    message: "I prepared a validated selected-table cut proposal. Review the card before confirming; TabulateAI will compute the derived table only after you confirm.",
    sourceTable,
    groupName,
    variable,
    cuts,
  };
}
