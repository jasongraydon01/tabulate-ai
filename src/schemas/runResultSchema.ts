import type {
  CrosstabReviewState,
  FlaggedCrosstabColumn,
  ReviewAlternative,
  ReviewAlternativeSource,
  ReviewDiffSummary,
} from '@/lib/api/types';
import type { PipelineDecisions } from '@/lib/v3/runtime/pipelineDecisions';
import type { V3PipelineCheckpoint } from '@/lib/v3/runtime/contracts';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string')
    ? value
    : undefined;
}

function asStringRecord(value: unknown): Record<string, string> | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const entries = Object.entries(record).filter(([, entry]) => typeof entry === 'string');
  if (entries.length !== Object.keys(record).length) return undefined;
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseFlaggedColumn(value: unknown): FlaggedCrosstabColumn | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const groupName = asString(record.groupName);
  const columnName = asString(record.columnName);
  const original = asString(record.original);
  const proposed = asString(record.proposed);
  const confidence = asNumber(record.confidence);
  const reasoning = asString(record.reasoning);
  const userSummary = asString(record.userSummary);
  const uncertainties = asStringArray(record.uncertainties);
  const alternativesRaw = Array.isArray(record.alternatives) ? record.alternatives : undefined;
  const alternatives = alternativesRaw?.map((entry): ReviewAlternative | undefined => {
    const alt = asRecord(entry);
    if (!alt) return undefined;
    const expression = asString(alt.expression);
    const rank = asNumber(alt.rank);
    const altUserSummary = asString(alt.userSummary);
    const selectable = asBoolean(alt.selectable);
    const nonSelectableReason = asString(alt.nonSelectableReason);
    const source = asString(alt.source);
    if (!expression || rank === undefined || !altUserSummary) return undefined;
    return {
      expression,
      rank,
      userSummary: altUserSummary,
      selectable: selectable ?? true,
      ...(nonSelectableReason ? { nonSelectableReason } : {}),
      ...(source ? { source: source as ReviewAlternativeSource } : {}),
    };
  });

  if (
    !groupName ||
    !columnName ||
    !original ||
    !proposed ||
    confidence === undefined ||
    !reasoning ||
    !userSummary ||
    !uncertainties ||
    !alternatives ||
    alternatives.some((entry) => entry === undefined)
  ) {
    return undefined;
  }

  const validAlternatives = alternatives.filter((entry): entry is ReviewAlternative => entry !== undefined);

  return {
    groupName,
    columnName,
    original,
    proposed,
    confidence,
    reasoning,
    userSummary,
    alternatives: validAlternatives,
    uncertainties,
    expressionType: asString(record.expressionType),
  };
}

function parseReviewDiffSummary(value: unknown): ReviewDiffSummary | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const totalColumns = asNumber(record.totalColumns);
  const approved = asNumber(record.approved);
  const hinted = asNumber(record.hinted);
  const alternativesSelected = asNumber(record.alternativesSelected);
  const edited = asNumber(record.edited);
  const skipped = asNumber(record.skipped);
  const expressionsChanged = asNumber(record.expressionsChanged);
  const expressionsUnchanged = asNumber(record.expressionsUnchanged);
  const errors = asNumber(record.errors);

  if (
    totalColumns === undefined ||
    approved === undefined ||
    hinted === undefined ||
    alternativesSelected === undefined ||
    edited === undefined ||
    skipped === undefined ||
    expressionsChanged === undefined ||
    expressionsUnchanged === undefined ||
    errors === undefined
  ) {
    return undefined;
  }

  return {
    totalColumns,
    approved,
    hinted,
    alternativesSelected,
    edited,
    skipped,
    expressionsChanged,
    expressionsUnchanged,
    errors,
  };
}

function parseReviewState(value: unknown): RunResultReviewState | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const flaggedColumnsRaw = Array.isArray(record.flaggedColumns) ? record.flaggedColumns : undefined;
  const flaggedColumns = flaggedColumnsRaw?.map(parseFlaggedColumn);

  const validFlaggedColumns = flaggedColumns?.filter(
    (entry): entry is FlaggedCrosstabColumn => entry !== undefined,
  );

  return {
    ...record,
    status: asString(record.status) as CrosstabReviewState['status'] | undefined,
    flaggedColumns:
      flaggedColumns && validFlaggedColumns && validFlaggedColumns.length === flaggedColumns.length
        ? validFlaggedColumns
        : undefined,
    pathBStatus: asString(record.pathBStatus) as CrosstabReviewState['pathBStatus'] | undefined,
    pathCStatus: asString(record.pathCStatus) as CrosstabReviewState['pathCStatus'] | undefined,
    totalColumns: asNumber(record.totalColumns),
    pipelineId: asString(record.pipelineId),
    createdAt: asString(record.createdAt),
    v3LastCompletedStage: asString(record.v3LastCompletedStage),
    totalCanonicalTables: asNumber(record.totalCanonicalTables),
    bannerGroupCount: asNumber(record.bannerGroupCount),
  };
}

function parseSummary(value: unknown): RunResultSummary | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    ...record,
    tables: asNumber(record.tables),
    cuts: asNumber(record.cuts),
    bannerGroups: asNumber(record.bannerGroups),
    durationMs: asNumber(record.durationMs),
  };
}

function parseQuality(value: unknown): RunResultQuality | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    ...record,
    score: asNumber(record.score),
    grade: asString(record.grade) as RunResultQuality['grade'] | undefined,
    divergenceLevel: asString(record.divergenceLevel) as RunResultQuality['divergenceLevel'] | undefined,
    evaluatedAt: asString(record.evaluatedAt),
    baselineVersion: asNumber(record.baselineVersion),
    datasetKey: asString(record.datasetKey),
    evaluationId: asString(record.evaluationId),
  };
}

function parseCostSummary(value: unknown): RunResultCostSummary | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const byAgentRaw = Array.isArray(record.byAgent) ? record.byAgent : undefined;
  const byAgent = byAgentRaw?.flatMap((entry) => {
    const agent = asRecord(entry);
    if (!agent) return [];
    return [{
      ...agent,
      agent: asString(agent.agent),
      totalCostUsd: asNumber(agent.totalCostUsd),
      totalTokens: asNumber(agent.totalTokens),
      totalCalls: asNumber(agent.totalCalls),
    }];
  });

  return {
    ...record,
    totalCostUsd: asNumber(record.totalCostUsd),
    totalTokens: asNumber(record.totalTokens),
    totalCalls: asNumber(record.totalCalls),
    byAgent,
  };
}

function parseFeedback(value: unknown): RunResultFeedbackEntry[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];

    return [{
      ...record,
      id: asString(record.id),
      createdAt: asString(record.createdAt),
      rating: asNumber(record.rating),
      notes: asString(record.notes),
      tableIds: asStringArray(record.tableIds),
    }];
  });
}

function parseTableReview(value: unknown): RunResultTableReview | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    ...record,
    lastReviewedAt: asString(record.lastReviewedAt),
  };
}

function parseV3Checkpoint(value: unknown): V3PipelineCheckpoint | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const schemaVersion = asNumber(record.schemaVersion);
  const pipelineId = asString(record.pipelineId);
  const dataset = asString(record.dataset);
  const updatedAt = asString(record.updatedAt);
  const completedStages = Array.isArray(record.completedStages) ? record.completedStages : undefined;

  if (
    schemaVersion === undefined ||
    !pipelineId ||
    !dataset ||
    !updatedAt ||
    !completedStages
  ) {
    return undefined;
  }

  return record as unknown as V3PipelineCheckpoint;
}

function parseExportPackages(value: unknown): RunResultExportPackages | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const parsed: RunResultExportPackages = {};
  for (const [platform, descriptor] of Object.entries(record)) {
    const descriptorRecord = asRecord(descriptor);
    if (descriptorRecord) {
      parsed[platform] = descriptorRecord;
    }
  }
  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function parsePipelineDecisions(value: unknown): PipelineDecisions | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  const enrichmentRecord = asRecord(record.enrichment);
  const tablesRecord = asRecord(record.tables);
  const bannersRecord = asRecord(record.banners);
  const weightsRecord = asRecord(record.weights);
  const errorsRecord = asRecord(record.errors);
  const timingRecord = asRecord(record.timing);
  const studyFlagsRecord = asRecord(record.studyFlags);

  const source = asString(bannersRecord?.source);
  if (source !== 'uploaded' && source !== 'auto_generated') return undefined;

  const parsed: PipelineDecisions = {
    enrichment: {
      totalQuestions: asNumber(enrichmentRecord?.totalQuestions) ?? 0,
      loopsDetected: asNumber(enrichmentRecord?.loopsDetected) ?? 0,
      aiTriageRequired: asNumber(enrichmentRecord?.aiTriageRequired) ?? 0,
      aiValidationPassed: asNumber(enrichmentRecord?.aiValidationPassed) ?? 0,
      messageCodesMatched: asNumber(enrichmentRecord?.messageCodesMatched) ?? 0,
    },
    tables: {
      canonicalTablesPlanned: asNumber(tablesRecord?.canonicalTablesPlanned) ?? 0,
      finalTableCount: asNumber(tablesRecord?.finalTableCount) ?? 0,
      netsAdded: asNumber(tablesRecord?.netsAdded) ?? 0,
      tablesExcluded: asNumber(tablesRecord?.tablesExcluded) ?? 0,
    },
    banners: {
      source,
      bannerGroupCount: asNumber(bannersRecord?.bannerGroupCount) ?? 0,
      totalCuts: asNumber(bannersRecord?.totalCuts) ?? 0,
      flaggedForReview: asNumber(bannersRecord?.flaggedForReview) ?? 0,
    },
    weights: {
      detected: asBoolean(weightsRecord?.detected) ?? false,
      variableUsed:
        weightsRecord?.variableUsed === null
          ? null
          : (asString(weightsRecord?.variableUsed) ?? null),
      candidateCount: asNumber(weightsRecord?.candidateCount) ?? 0,
    },
    errors: {
      total: asNumber(errorsRecord?.total) ?? 0,
      recovered: asNumber(errorsRecord?.recovered) ?? 0,
      warnings: asNumber(errorsRecord?.warnings) ?? 0,
    },
    timing: {
      enrichmentMs: asNumber(timingRecord?.enrichmentMs) ?? 0,
      tableGenerationMs: asNumber(timingRecord?.tableGenerationMs) ?? 0,
      computeMs: asNumber(timingRecord?.computeMs) ?? 0,
      excelMs: asNumber(timingRecord?.excelMs) ?? 0,
      totalMs: asNumber(timingRecord?.totalMs) ?? 0,
    },
    studyFlags: {
      isDemandSurvey: asBoolean(studyFlagsRecord?.isDemandSurvey) ?? false,
      hasChoiceModelExercise:
        studyFlagsRecord?.hasChoiceModelExercise === null
          ? null
          : (asBoolean(studyFlagsRecord?.hasChoiceModelExercise) ?? null),
      hasMaxDiff: asBoolean(studyFlagsRecord?.hasMaxDiff) ?? false,
    },
  };

  return parsed;
}

function parseExportErrors(value: unknown): RunResultExportError[] | undefined {
  if (!Array.isArray(value)) return undefined;

  return value.flatMap((entry) => {
    const record = asRecord(entry);
    if (!record) return [];

    return [{
      ...record,
      format: asString(record.format) as RunResultExportError['format'] | undefined,
      stage: asString(record.stage),
      message: asString(record.message),
      retryable: asBoolean(record.retryable),
      timestamp: asString(record.timestamp),
    }];
  });
}

function parsePostProcessingPhase(value: unknown): RunResultPostProcessingPhase | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    ...record,
    attempted: asBoolean(record.attempted),
    success: asBoolean(record.success),
    durationMs: asNumber(record.durationMs),
    error: asString(record.error),
    skippedReason: asString(record.skippedReason),
    outputTableCount: asNumber(record.outputTableCount),
  };
}

function parsePostProcessing(value: unknown): RunResultPostProcessing | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    ...record,
    rExecution: parsePostProcessingPhase(record.rExecution),
    finalTableContract: parsePostProcessingPhase(record.finalTableContract),
    excelExport: parsePostProcessingPhase(record.excelExport),
  };
}

function parseReviewR2Keys(value: unknown): RunResultReviewR2Keys | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    reviewState: asString(record.reviewState),
    pipelineSummary: asString(record.pipelineSummary),
    spssInput: asString(record.spssInput),
    v3QuestionIdFinal: asString(record.v3QuestionIdFinal),
    v3CrosstabPlan: asString(record.v3CrosstabPlan),
    v3TableEnriched: asString(record.v3TableEnriched),
    v3TableJson: asString(record.v3TableJson),
    v3Checkpoint: asString(record.v3Checkpoint),
    dataFileSav: asString(record.dataFileSav),
  };
}

export interface RunResultSummary {
  tables?: number;
  cuts?: number;
  bannerGroups?: number;
  durationMs?: number;
}

export interface RunResultCostSummary {
  totalCostUsd?: number;
  totalTokens?: number;
  totalCalls?: number;
  byAgent?: Array<{
    agent?: string;
    totalCostUsd?: number;
    totalTokens?: number;
    totalCalls?: number;
  } & Record<string, unknown>>;
}

export interface RunResultQuality {
  score?: number;
  grade?: 'A' | 'B' | 'C' | 'D';
  divergenceLevel?: 'none' | 'minor' | 'major';
  evaluatedAt?: string;
  baselineVersion?: number;
  datasetKey?: string;
  evaluationId?: string;
}

/**
 * Scalar-only subset of `CrosstabReviewState` persisted to Convex for the UI.
 * The full review state stays on disk with R2 backup due to Convex document limits.
 */
export interface RunResultReviewState {
  status?: CrosstabReviewState['status'];
  flaggedColumns?: FlaggedCrosstabColumn[];
  pathBStatus?: CrosstabReviewState['pathBStatus'];
  pathCStatus?: CrosstabReviewState['pathCStatus'];
  totalColumns?: number;
  pipelineId?: string;
  createdAt?: string;
  v3LastCompletedStage?: string;
  totalCanonicalTables?: number;
  bannerGroupCount?: number;
  [key: string]: unknown;
}

export interface RunResultFeedbackEntry {
  id?: string;
  createdAt?: string;
  rating?: number;
  notes?: string;
  tableIds?: string[];
  [key: string]: unknown;
}

export interface RunResultTableReview {
  lastReviewedAt?: string;
  [key: string]: unknown;
}

export interface RunResultExportError {
  format?: 'shared' | 'q' | 'wincross';
  stage?: string;
  message?: string;
  retryable?: boolean;
  timestamp?: string;
  [key: string]: unknown;
}

export interface RunResultPostProcessingPhase {
  attempted?: boolean;
  success?: boolean;
  durationMs?: number;
  error?: string;
  skippedReason?: string;
  outputTableCount?: number;
  [key: string]: unknown;
}

export interface RunResultPostProcessing {
  rExecution?: RunResultPostProcessingPhase;
  finalTableContract?: RunResultPostProcessingPhase;
  excelExport?: RunResultPostProcessingPhase;
  [key: string]: unknown;
}

export type RunResultExportPackages = Record<string, Record<string, unknown>>;

export interface RunResultR2Files {
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  [key: string]: unknown;
}

export interface RunResultReviewR2Keys {
  reviewState?: string;
  pipelineSummary?: string;
  spssInput?: string;
  v3QuestionIdFinal?: string;
  v3CrosstabPlan?: string;
  v3TableEnriched?: string;
  v3TableJson?: string;
  v3Checkpoint?: string;
  dataFileSav?: string;
}

export type ParsedRunResult = Record<string, unknown> & {
  formatVersion?: 3;
  pipelineId?: string;
  outputDir?: string;
  reviewUrl?: string;
  downloadUrl?: string;
  dataset?: string;
  flaggedColumnCount?: number;
  reviewR2Keys?: RunResultReviewR2Keys;
  r2Files?: RunResultR2Files;
  summary?: RunResultSummary;
  reviewState?: RunResultReviewState;
  reviewDiff?: ReviewDiffSummary;
  quality?: RunResultQuality;
  costSummary?: RunResultCostSummary;
  exportArtifacts?: Record<string, unknown>;
  exportReadiness?: Record<string, unknown>;
  exportErrors?: RunResultExportError[];
  postProcessing?: RunResultPostProcessing;
  exportPackages?: RunResultExportPackages;
  v3Checkpoint?: V3PipelineCheckpoint;
  feedback?: RunResultFeedbackEntry[];
  tableReview?: RunResultTableReview;
  pipelineDecisions?: PipelineDecisions;
  decisionsSummary?: string;
};

export type RunResultShape = ParsedRunResult & {
  formatVersion: 3;
  pipelineId: string;
};

export function parseRunResult(raw: unknown): ParsedRunResult | undefined {
  const record = asRecord(raw);
  if (!record) return undefined;

  return {
    ...record,
    formatVersion: record.formatVersion === 3 ? 3 : undefined,
    pipelineId: asString(record.pipelineId),
    outputDir: asString(record.outputDir),
    reviewUrl: asString(record.reviewUrl),
    downloadUrl: asString(record.downloadUrl),
    dataset: asString(record.dataset),
    flaggedColumnCount: asNumber(record.flaggedColumnCount),
    reviewR2Keys: parseReviewR2Keys(record.reviewR2Keys),
    r2Files: (() => {
      const r2Files = asRecord(record.r2Files);
      if (!r2Files) return undefined;
      return {
        ...r2Files,
        inputs: asStringRecord(r2Files.inputs),
        outputs: asStringRecord(r2Files.outputs),
      };
    })(),
    summary: parseSummary(record.summary),
    reviewState: parseReviewState(record.reviewState),
    reviewDiff: parseReviewDiffSummary(record.reviewDiff),
    quality: parseQuality(record.quality),
    costSummary: parseCostSummary(record.costSummary),
    exportArtifacts: asRecord(record.exportArtifacts),
    exportReadiness: asRecord(record.exportReadiness),
    exportErrors: parseExportErrors(record.exportErrors),
    postProcessing: parsePostProcessing(record.postProcessing),
    exportPackages: parseExportPackages(record.exportPackages),
    v3Checkpoint: parseV3Checkpoint(record.v3Checkpoint),
    feedback: parseFeedback(record.feedback),
    tableReview: parseTableReview(record.tableReview),
    pipelineDecisions: parsePipelineDecisions(record.pipelineDecisions),
    decisionsSummary: asString(record.decisionsSummary),
  };
}

export function isV3Result(result: unknown): result is RunResultShape {
  const parsed = parseRunResult(result);
  return parsed?.formatVersion === 3 && typeof parsed.pipelineId === 'string';
}
