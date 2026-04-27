import type { ValidatedGroupType, ValidationResultType } from '../../../schemas/agentOutputSchema';
import type { BannerGroupType } from '../../../schemas/bannerPlanSchema';

export type AnalysisComputeJobStatus =
  | 'drafting'
  | 'proposed'
  | 'needs_clarification'
  | 'confirmed'
  | 'queued'
  | 'running'
  | 'success'
  | 'failed'
  | 'cancelled'
  | 'expired';

export type AnalysisComputeJobType = 'banner_extension_recompute' | 'table_rollup_derivation';

export interface AnalysisBannerExtensionReviewFlags {
  requiresClarification: boolean;
  requiresReview: boolean;
  reasons: string[];
  averageConfidence: number;
  policyFallbackDetected: boolean;
  draftConfidence?: number;
}

export interface AnalysisBannerExtensionPreflightResult {
  jobType: AnalysisComputeJobType;
  requestText: string;
  frozenBannerGroup: BannerGroupType;
  frozenValidatedGroup: ValidatedGroupType;
  reviewFlags: AnalysisBannerExtensionReviewFlags;
  fingerprint: string;
  promptSummary: string;
}

export interface AnalysisBannerExtensionPayload {
  kind: 'banner_extension';
  jobId: string;
  parentRunId: string;
  parentPipelineId: string;
  parentDatasetName: string;
  parentR2Outputs: Record<string, string>;
  frozenBannerGroup: BannerGroupType;
  frozenValidatedGroup: ValidatedGroupType;
  fingerprint: string;
}

export interface ExtendedPlanningArtifacts {
  bannerPlan: { bannerCuts: BannerGroupType[] };
  crosstabPlan: ValidationResultType;
}

export interface AnalysisTableRollupComponent {
  rowKey: string;
  label: string;
}

export type AnalysisTableRollupMechanism =
  | 'artifact_exclusive_sum'
  | 'respondent_any_of'
  | 'metric_row_aggregation';

export interface AnalysisTableRollupOutputRow {
  label: string;
  sourceRows: AnalysisTableRollupComponent[];
  mechanism: AnalysisTableRollupMechanism;
}

export interface AnalysisTableRollupSourceTableSpec {
  tableId: string;
  title: string;
  questionId: string | null;
  questionText: string | null;
}

export interface AnalysisTableRollupResolvedOutputRow {
  label: string;
  mechanism: AnalysisTableRollupMechanism;
  sourceRows: Array<AnalysisTableRollupComponent & {
    variable: string;
    filterValue: string;
  }>;
}

export interface AnalysisTableRollupSpec {
  schemaVersion: 2;
  derivationType: 'row_rollup';
  sourceTable: AnalysisTableRollupSourceTableSpec;
  outputRows: AnalysisTableRollupOutputRow[];
  resolvedComputePlan: {
    outputRows: AnalysisTableRollupResolvedOutputRow[];
  };
}

export const UNSUPPORTED_TABLE_ROLLUP_SPEC_MESSAGE = 'This derived-table proposal uses an older roll-up contract. Please revise the request and create a new proposal.';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isTableRollupMechanism(value: unknown): value is AnalysisTableRollupMechanism {
  return value === 'artifact_exclusive_sum'
    || value === 'respondent_any_of'
    || value === 'metric_row_aggregation';
}

function isTableRollupComponent(value: unknown): value is AnalysisTableRollupComponent {
  return isRecord(value)
    && isString(value.rowKey)
    && value.rowKey.length > 0
    && isString(value.label)
    && value.label.length > 0;
}

function isTableRollupOutputRow(value: unknown): value is AnalysisTableRollupOutputRow {
  return isRecord(value)
    && isString(value.label)
    && value.label.length > 0
    && isTableRollupMechanism(value.mechanism)
    && Array.isArray(value.sourceRows)
    && value.sourceRows.length >= 2
    && value.sourceRows.every(isTableRollupComponent);
}

function isTableRollupSourceTableSpec(value: unknown): value is AnalysisTableRollupSourceTableSpec {
  return isRecord(value)
    && isString(value.tableId)
    && value.tableId.length > 0
    && isString(value.title)
    && value.title.length > 0
    && isNullableString(value.questionId)
    && isNullableString(value.questionText);
}

function isResolvedSourceRow(value: unknown): value is AnalysisTableRollupResolvedOutputRow['sourceRows'][number] {
  return isRecord(value)
    && isString(value.rowKey)
    && value.rowKey.length > 0
    && isString(value.label)
    && value.label.length > 0
    && isString(value.variable)
    && value.variable.length > 0
    && isString(value.filterValue);
}

function isResolvedOutputRow(value: unknown): value is AnalysisTableRollupResolvedOutputRow {
  return isRecord(value)
    && isString(value.label)
    && value.label.length > 0
    && isTableRollupMechanism(value.mechanism)
    && Array.isArray(value.sourceRows)
    && value.sourceRows.length >= 2
    && value.sourceRows.every(isResolvedSourceRow);
}

function outputRowsMatchResolvedPlan(
  outputRows: AnalysisTableRollupOutputRow[],
  resolvedOutputRows: AnalysisTableRollupResolvedOutputRow[],
): boolean {
  return outputRows.every((outputRow, index) => {
    const resolvedOutputRow = resolvedOutputRows[index];
    if (!resolvedOutputRow) return false;
    return outputRow.label === resolvedOutputRow.label
      && outputRow.mechanism === resolvedOutputRow.mechanism
      && outputRow.sourceRows.length === resolvedOutputRow.sourceRows.length
      && outputRow.sourceRows.every((sourceRow, sourceIndex) => {
        const resolvedSourceRow = resolvedOutputRow.sourceRows[sourceIndex];
        return Boolean(resolvedSourceRow)
          && sourceRow.rowKey === resolvedSourceRow.rowKey
          && sourceRow.label === resolvedSourceRow.label;
      });
  });
}

export function isAnalysisTableRollupSpecV2(value: unknown): value is AnalysisTableRollupSpec {
  if (!isRecord(value)) return false;
  const resolvedComputePlan = isRecord(value.resolvedComputePlan)
    ? value.resolvedComputePlan
    : null;
  return value.schemaVersion === 2
    && value.derivationType === 'row_rollup'
    && isTableRollupSourceTableSpec(value.sourceTable)
    && Array.isArray(value.outputRows)
    && value.outputRows.length > 0
    && value.outputRows.every(isTableRollupOutputRow)
    && Boolean(resolvedComputePlan)
    && Array.isArray(resolvedComputePlan?.outputRows)
    && resolvedComputePlan.outputRows.length === value.outputRows.length
    && resolvedComputePlan.outputRows.every(isResolvedOutputRow)
    && outputRowsMatchResolvedPlan(value.outputRows, resolvedComputePlan.outputRows);
}

export function assertAnalysisTableRollupSpecV2(value: unknown): asserts value is AnalysisTableRollupSpec {
  if (!isAnalysisTableRollupSpecV2(value)) {
    throw new Error(UNSUPPORTED_TABLE_ROLLUP_SPEC_MESSAGE);
  }
}
