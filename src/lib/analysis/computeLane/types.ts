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

export interface AnalysisTableRollupDefinition {
  label: string;
  components: AnalysisTableRollupComponent[];
}

export interface AnalysisTableRollupTableSpec {
  tableId: string;
  title: string;
  questionId: string | null;
  questionText: string | null;
  rollups: AnalysisTableRollupDefinition[];
}

export interface AnalysisTableRollupSpec {
  schemaVersion: 1;
  derivationType: 'answer_option_rollup';
  sourceTables: AnalysisTableRollupTableSpec[];
}
