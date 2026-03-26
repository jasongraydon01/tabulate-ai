/**
 * V3 Runtime — Planning Chain Types (Stages 20–21, 21a diagnostic)
 *
 * Shared type definitions for the banner plan, crosstab plan, and optional
 * banner diagnostic chain. These types define the artifact shapes flowing
 * between stages 20 (banner plan) and 21 (crosstab plan).
 *
 * See also:
 *   - src/lib/v3/runtime/questionId/types.ts (question-id chain types)
 *   - src/lib/v3/runtime/canonical/types.ts (canonical chain types)
 *   - src/schemas/bannerPlanSchema.ts (BannerPlanInputType)
 *   - src/schemas/agentOutputSchema.ts (ValidationResultType)
 */

import type { V3PipelineCheckpoint } from '../contracts';
import type { QuestionIdEntry, SurveyMetadata } from '../questionId/types';
import type { BannerPlanInputType } from '@/schemas/bannerPlanSchema';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { QuestionContext, BannerQuestionSummary } from '@/schemas/questionContextSchema';

// Re-export upstream types used throughout the planning chain
export type { QuestionIdEntry, SurveyMetadata, BannerPlanInputType, ValidationResultType, QuestionContext, BannerQuestionSummary };

// =============================================================================
// Banner Route Decision (Step 20)
// =============================================================================

/** Which route produced the banner plan. */
export type BannerRouteUsed = 'banner_agent' | 'banner_generate';

/** Which data source fed BannerGenerateAgent when used. */
export type BannerGenerateInputSource = 'questionid_reportable' | 'sav_verbose_datamap';

/** Metadata about step 20's routing decision — persisted alongside banner-plan.json. */
export interface BannerRouteMetadata {
  routeUsed: BannerRouteUsed;
  bannerFile: string | null;
  generatedAt: string;
  groupCount: number;
  columnCount: number;
  sourceConfidence: number;
  usedFallbackFromBannerAgent: boolean;
  bannerGenerateInputSource: BannerGenerateInputSource | null;
}

// =============================================================================
// Banner Plan Result (Step 20 output)
// =============================================================================

export interface BannerPlanResult {
  /** Canonical banner plan for downstream step 21. */
  bannerPlan: BannerPlanInputType;
  /** Route decision metadata. */
  routeMetadata: BannerRouteMetadata;
}

// =============================================================================
// Crosstab Plan Result (Step 21 output)
// =============================================================================

/** How the step-20 banner plan was resolved for use in step 21. */
export type BannerPlanSource = 'step20' | 'fallback_generate';

/** Step 21's fallback reason when step-20 plan was insufficient. */
export type CrosstabFallbackReason = 'groups_without_columns' | 'empty_banner_plan';

/** Resolution metadata about the banner plan consumed by step 21. */
export interface ResolvedBannerPlanInfo {
  source: BannerPlanSource;
  fallbackUsed: boolean;
  fallbackReason: CrosstabFallbackReason | null;
  originalGroupCount: number;
  originalColumnCount: number;
  finalGroupCount: number;
  finalColumnCount: number;
}

export interface CrosstabPlanResult {
  /** Validated crosstab plan from CrosstabAgentV2. */
  crosstabPlan: ValidationResultType;
  /** The banner plan actually used (may differ from step-20 if fallback was needed). */
  resolvedBannerPlan: BannerPlanInputType;
  /** Resolution metadata. */
  resolvedBannerPlanInfo: ResolvedBannerPlanInfo;
  /** Question context used. */
  questions: QuestionContext[];
  /** Loop iteration count derived from questionid-final. */
  loopIterationCount: number;
  /** Number of reportable questions. */
  questionCount: number;
  /** Total variable count across reportable questions. */
  variableCount: number;
  /** Average column confidence from CrosstabAgentV2. */
  averageConfidence: number;
  /** Scratchpad entries by group from CrosstabAgentV2 — persisted for hint re-runs during review. */
  scratchpadByGroup?: import('@/agents/CrosstabAgent').CrosstabScratchpadByGroup;
}

// =============================================================================
// Banner Diagnostic (Step 21a — optional, non-blocking)
// =============================================================================

/**
 * Lightweight question-id entry for the banner diagnostic.
 * The diagnostic only reads a subset of fields, so it accepts a looser
 * contract than the full runtime QuestionIdEntry. This allows callers
 * (including tests) to provide minimal entries without 30+ required fields.
 *
 * The full QuestionIdEntry from the runtime chain satisfies this interface.
 */
export interface DiagnosticQuestionIdEntry {
  questionId: string;
  disposition?: string | null;
  isHidden?: boolean;
  normalizedType?: string | null;
  variables?: string[];
  items?: Array<{ column?: string }>;
}

export type ColumnDispositionStatus =
  | 'reportable_only'
  | 'excluded_only'
  | 'other_only'
  | 'mixed'
  | 'unresolved_only'
  | 'no_explicit_reference';

export type QuestionMatchType = 'questionId' | 'variable' | 'derived_questionId';

export interface QuestionMatch {
  token: string;
  matchedAs: QuestionMatchType;
  questionId: string;
  disposition: string;
  isHidden: boolean;
  normalizedType: string | null;
}

export interface ColumnDiagnostic {
  groupName: string;
  columnName: string;
  original: string;
  matchedQuestions: QuestionMatch[];
  unresolvedTokens: string[];
  status: ColumnDispositionStatus;
}

export interface BannerDiagnosticSummary {
  totalColumns: number;
  columnsWithExplicitRefs: number;
  reportableOnlyColumns: number;
  excludedOnlyColumns: number;
  otherOnlyColumns: number;
  mixedColumns: number;
  unresolvedOnlyColumns: number;
  noExplicitReferenceColumns: number;
  uniqueReferencedQuestionIds: number;
  uniqueExcludedQuestionIds: string[];
}

export interface BannerDiagnosticResult {
  columns: ColumnDiagnostic[];
  summary: BannerDiagnosticSummary;
}

// =============================================================================
// Planning Chain Input / Output (full planning chain 20→21)
// =============================================================================

export interface PlanningChainInput {
  /** Enriched question-id entries from stage 12. */
  entries: QuestionIdEntry[];
  /** Survey-level metadata. */
  metadata: SurveyMetadata;
  /** Path to .sav file (needed if BannerGenerateAgent falls back to sav-based datamap). */
  savPath: string;
  /** Path to dataset directory (for finding banner document). */
  datasetPath: string;
  /** Output directory for artifacts and checkpoint. */
  outputDir: string;
  /** Pipeline run identifier. */
  pipelineId: string;
  /** Dataset name. */
  dataset: string;
  /** Abort signal for cancellation. */
  abortSignal?: AbortSignal;
  /** Existing checkpoint for resume. */
  checkpoint?: V3PipelineCheckpoint | null;
  /** Optional row cap for demo mode. */
  maxRespondents?: number;
  /** Optional research objectives hint for BannerGenerateAgent. */
  researchObjectives?: string;
  /** Optional cut suggestions for BannerGenerateAgent. */
  cutSuggestions?: string;
  /** Optional project type hint for BannerGenerateAgent. */
  projectType?: string;
}

export interface PlanningChainResult {
  /** Banner plan from step 20. */
  bannerPlan: BannerPlanResult;
  /** Crosstab plan from step 21. */
  crosstabPlan: CrosstabPlanResult;
  /** Updated pipeline checkpoint. */
  checkpoint: V3PipelineCheckpoint;
}
