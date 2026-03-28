/**
 * V3 Runtime — Canonical Chain Types (Stages 13b–13d)
 *
 * Shared type definitions for the table planning, validation, and canonical
 * assembly chain. These types define the artifact shapes flowing between
 * stages 13b (table planner), 13c1 (subtype gate), 13c2 (structure gate),
 * and 13d (canonical table assembly).
 *
 * See also:
 *   - src/lib/v3/runtime/questionId/types.ts (question-id chain types)
 *   - docs/v3-13d-canonical-table-spec.md (canonical table specification)
 */

import type { V3PipelineCheckpoint } from '../contracts';
import type { BaseContractV1, BaseSignal } from '../baseContract';
import type { TablePresentationConfig } from '@/lib/tablePresentation/labelVocabulary';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import type {
  QuestionIdEntry,
  SurveyMetadata,
  ParsedSurveyQuestion,
  TriagedEntry,
} from '../questionId/types';

// Re-export question-id types used throughout the canonical chain
export type { QuestionIdEntry, SurveyMetadata, ParsedSurveyQuestion, TriagedEntry };

// =============================================================================
// Table Kind
// =============================================================================

export type TableKind =
  | 'standard_overview'
  | 'standard_item_detail'
  | 'standard_cluster_detail'
  | 'grid_row_detail'
  | 'grid_col_detail'
  | 'numeric_overview_mean'
  | 'numeric_item_detail'
  | 'numeric_per_value_detail'
  | 'numeric_optimized_bin_detail'
  | 'scale_overview_full'
  | 'scale_overview_rollup_t2b'
  | 'scale_overview_rollup_middle'
  | 'scale_overview_rollup_b2b'
  | 'scale_overview_rollup_nps'
  | 'scale_overview_rollup_combined'
  | 'scale_overview_rollup_mean'
  | 'scale_item_detail_full'
  | 'scale_dimension_compare'
  | 'ranking_overview_rank'
  | 'ranking_overview_topk'
  | 'ranking_item_rank'
  | 'allocation_overview'
  | 'allocation_item_detail'
  | 'maxdiff_api'
  | 'maxdiff_ap'
  | 'maxdiff_sharpref';

export type PlannerBaseComparability =
  | 'shared'
  | 'varying_but_acceptable'
  | 'split_recommended'
  | 'ambiguous';

export type PlannedTableBaseViewRole = 'anchor' | 'precision';

export type PlannerBaseSignal = BaseSignal;

export type ComputeRiskSignal =
  | 'compute-mask-required'
  | 'row-base-varies-within-anchor-view'
  | 'net-uses-table-universe';

// =============================================================================
// Planner Config (Phase A — toggleable feature gates)
// =============================================================================

export interface LowBaseSuppressionConfig {
  enabled: boolean;
  threshold: number;
}

export interface PlannerConfig {
  lowBaseSuppression: LowBaseSuppressionConfig;
}

// =============================================================================
// Base Decision Diagnostic (Phase A — planner audit trail)
// =============================================================================

export interface BaseDecision {
  decision: string;
  detail: string;
  affectedTableKinds: string[];
  affectedTableCount: number;
}

export type PrecisionRoutingDecision =
  | 'none'
  | 'cluster'
  | 'item_detail'
  | 'existing_subtype_detail';

export type CanonicalBaseNoteToken =
  | 'anchor-base-varies-by-item'
  | 'anchor-base-range'
  | 'rebased-exclusion'
  | 'low-base-caution';

export interface CanonicalBaseRangeDisclosure {
  min: number;
  max: number;
}

export interface CanonicalBaseDisclosure {
  referenceBaseN: number | null;
  itemBaseRange: [number, number] | null;
  defaultBaseText: string;
  defaultNoteTokens: CanonicalBaseNoteToken[];
  excludedResponseLabels?: string[];
  rangeDisclosure: CanonicalBaseRangeDisclosure | null;
  source: 'contract' | 'legacy_fallback';
}

// =============================================================================
// Planned Table (13b output unit)
// =============================================================================

export interface PlannedTable {
  dataset: string;
  sourceQuestionId: string | null;
  sourceLoopQuestionId: string | null;
  familyRoot: string;
  analyticalSubtype: string;
  normalizedType: string;
  tableKind: TableKind;
  tableRole: string;
  tableIdCandidate: string;
  sortBlock: string;
  sortFamily: string;
  basePolicy: string;
  baseSource: string;
  splitReason: string | null;
  baseViewRole: PlannedTableBaseViewRole;
  plannerBaseComparability?: PlannerBaseComparability;
  plannerBaseSignals?: PlannerBaseSignal[];
  computeRiskSignals?: ComputeRiskSignal[];
  questionBase: number | null;
  itemBase: number | null;
  baseContract: BaseContractV1;
  /** Planner-resolved base disclosure hints for canonical assembly */
  baseDisclosure?: CanonicalBaseDisclosure;
  appliesToItem: string | null;
  computeMaskAnchorVariable: string | null;
  appliesToColumn: string | null;
  stimuliSetSlice: StimuliSetSlice | null;
  binarySide: 'selected' | 'unselected' | null;
  /** Flagged for StructureGateAgent to review base/split decision */
  structureGateReviewRequired?: boolean;
  /** Compute mask intent verified at planning time */
  computeMaskVerified?: boolean;
  notes: string[];
  inputsUsed: string[];
}

// =============================================================================
// Planner Ambiguity
// =============================================================================

export interface PlannerAmbiguity {
  dataset: string;
  questionId: string | null;
  code: string;
  detail: string;
}

// =============================================================================
// Scale Classification
// =============================================================================

export type ScaleMode =
  | 'treat_as_standard'
  | 'odd_substantive'
  | 'even_bipolar'
  | 'odd_plus_non_sub_tail'
  | 'nps'
  | 'admin_artifact'
  | 'unknown';

export interface ScaleClassification {
  mode: ScaleMode;
  pointCount: number | null;
  hasNonSubstantiveTail: boolean;
  tailLabel: string | null;
  tailLabels: string[];
}

// =============================================================================
// Planner Overrides (for re-derivation in 13c stages)
// =============================================================================

export interface PlannerOverrides {
  /** Skip analyzeConceptualGridStructure call in planStandardFrequencyTables */
  skipConceptualGrid?: boolean;
  /** Bypass classifyScale, use this mode directly in planScaleTables */
  forceScaleMode?: string;
  /** Skip binary selected/unselected pairing — re-plan with affirmative-only default */
  skipBinarySplit?: boolean;
  /** Skip per-set table cloning — re-plan without stimuli set segmentation */
  skipStimuliSets?: boolean;
}

// =============================================================================
// Question Diagnostic (13b per-question metadata)
// =============================================================================

export interface QuestionDiagnostic {
  dataset: string;
  questionId: string;
  analyticalSubtype: string;
  normalizedType: string;
  itemCount: number;
  tableCount: number;
  splitReason: string | null;
  genuineSplit: boolean;
  clusterRouting: 'population' | 'individual' | 'none' | null;
  baseSituation?: BaseContractV1['classification']['situation'];
  baseVariationClass?: BaseContractV1['classification']['variationClass'];
  baseComparability?: PlannerBaseComparability;
  baseSignals?: PlannerBaseSignal[];
  computeRiskSignals?: ComputeRiskSignal[];
  minBase?: number | null;
  maxBase?: number | null;
  absoluteSpread?: number | null;
  relativeSpread?: number | null;
  precisionRouting?: PrecisionRoutingDecision;
  lowBase?: boolean;
  isHidden: boolean;
  isLoop: boolean;
  loopQuestionId: string | null;
  tableKinds: Record<string, number>;
  suppressed: boolean;
  suppressionCode: string | null;
  suppressedWouldHaveTableCount: number | null;
  gridDims: string | null;
  maxValueCount: number | null;
  baseDecisions?: BaseDecision[];
  stimuliSetResolution?: StimuliSetResolutionDiagnostic;
}

// =============================================================================
// Stimuli Set Resolution Diagnostic
// =============================================================================

export type StimuliSetMatchMethod =
  | 'code'
  | 'message_text'
  | 'label'
  | 'variable_pattern'
  | 'mixed';

export interface StimuliSetResolutionDiagnostic {
  detected: boolean;
  setCount: number;
  matchMethod: StimuliSetMatchMethod;
  averageScore: number;
  ambiguous: boolean;
  binarySplitApplied: boolean;
  familySource?: string;
  blockMatch?: boolean;
  candidateCount?: number;
  scoreGap?: number | null;
  setSizes?: number[];
}

// =============================================================================
// Suppression Decision
// =============================================================================

export type SuppressionReasonCode =
  | 'hidden_sparse_high_overlap'
  | 'hidden_linked_message_matrix'
  | 'maxdiff_parent_linked_hidden_matrix'
  | 'hidden_ranking_derivative'
  | 'choice_model_iteration'
  | 'maxdiff_exercise_family';

export interface HiddenSuppressionDecision {
  dataset: string;
  questionId: string;
  analyticalSubtype: string;
  normalizedType: string;
  itemCount: number;
  zeroItemCount: number;
  zeroItemPct: number;
  nonZeroItemCount: number;
  linkedToQuestionId: string | null;
  linkedParentResolved: boolean;
  overlapQuestionId: string;
  overlapIntersection: number;
  overlapJaccard: number;
  overlapContainment: number;
  reasonCode: SuppressionReasonCode;
  detail: string;
  wouldHaveTableCount: number;
  wouldHaveByKind: Record<string, number>;
}

// =============================================================================
// Entry Context (working context during planning)
// =============================================================================

export interface QuestionItem {
  column: string;
  label: string;
  /** Original label from .sav. Passed through from QuestionIdItem for downstream divergence analysis. */
  savLabel?: string;
  /** Label from survey parse. Passed through from QuestionIdItem for downstream divergence analysis. */
  surveyLabel?: string;
  normalizedType: string;
  itemBase: number;
  scaleLabels?: Array<{
    value: number | string;
    label: string;
    /** Original scale label from .sav. */
    savLabel?: string;
    /** Scale label from survey parse. */
    surveyLabel?: string;
  }>;
  messageCode: string | null;
  messageText: string | null;
  altCode: string | null;
  altText: string | null;
  matchMethod: string | null;
  matchConfidence: number;
  /** Count of distinct non-NA observed values (from .sav) */
  nUnique?: number | null;
  /** Minimum observed value (numeric only, from .sav) */
  observedMin?: number | null;
  /** Maximum observed value (numeric only, from .sav) */
  observedMax?: number | null;
  /** Sorted unique observed values when nUnique <= 50 (from .sav) */
  observedValues?: number[] | null;
}

export interface BaseCluster {
  base: number;
  items: QuestionItem[];
  isUniversal: boolean;
}

export interface ClusterAnalysis {
  routingType: 'population' | 'individual' | 'none';
  clusters: BaseCluster[];
  populationClusters: BaseCluster[];
}

export interface StimuliSetSlice {
  familySource: string;
  setIndex: number;
  setLabel: string;
  sourceQuestionId: string;
}

export interface EntryStimuliSetSlice extends StimuliSetSlice {
  columns: string[];
}

export interface EntryContext {
  dataset: string;
  entry: QuestionIdEntry;
  isMessageTestingSurvey: boolean;
  isConceptTestingSurvey: boolean;
  familyRoot: string;
  sortBlock: string;
  sortFamily: string;
  substantiveItems: QuestionItem[];
  basePlanning: {
    totalN: number | null;
    questionBase: number | null;
    itemBaseRange: [number, number] | null;
    situation: BaseContractV1['classification']['situation'];
    referenceUniverse: BaseContractV1['classification']['referenceUniverse'];
    variationClass: BaseContractV1['classification']['variationClass'];
    comparabilityStatus: PlannerBaseComparability;
    rebasePolicy: BaseContractV1['policy']['rebasePolicy'];
    effectiveBaseMode: BaseContractV1['policy']['effectiveBaseMode'];
    signals: PlannerBaseSignal[];
    minBase: number | null;
    maxBase: number | null;
    absoluteSpread: number | null;
    relativeSpread: number | null;
    materialSplit: boolean;
    borderlineMateriality: boolean;
    lowBase: boolean;
    hasVaryingItemBases: boolean;
    computeRiskSignals: ComputeRiskSignal[];
    legacyMismatchReasons: string[];
  };
  splitReason: string | null;
  genuineSplit: boolean;
  rankingArtifactBases: boolean;
  clusterAnalysis: ClusterAnalysis | null;
  precisionRouting: PrecisionRoutingDecision;
  stimuliSetSlices: EntryStimuliSetSlice[];
  stimuliSetResolution?: StimuliSetResolutionDiagnostic | null;
}

// =============================================================================
// Dataset Plan Summary (13b output per-dataset)
// =============================================================================

export interface DatasetPlanSummary {
  dataset: string;
  reportableQuestions: number;
  plannedTables: number;
  byKind: Record<string, number>;
  bySubtype: Record<string, number>;
  maxdiffDetectedFamilies: string[];
  siblingDimensionGroups: Array<{
    stem: string;
    memberCount: number;
    memberIds: string[];
    dimensionLabels: string[];
    itemCount: number;
    tablesAdded: number;
  }>;
  questionDiagnostics: QuestionDiagnostic[];
  suppressedQuestions: number;
  suppressedPlannedTables: number;
  suppressionDecisions: HiddenSuppressionDecision[];
}

// =============================================================================
// Table Plan Output (13b full output)
// =============================================================================

export interface TablePlanOutput {
  metadata: {
    generatedAt: string;
    plannerVersion: string;
    dataset: string;
    suppressionPolicy: {
      minItemCount: number;
      minZeroItemPct: number;
      minOverlapJaccard: number;
      minOverlapItems: number;
      linkedMessageMinItemCount: number;
      linkedMessageMinCoveragePct: number;
      linkedParentMaxItems: number;
      linkedMessageRequiresMaxDiff: boolean;
      linkedMessageMinLabelAlignPct: number;
      linkedMessageLabelTokenJaccardMin: number;
      parentLinkedMaxItems: number;
      parentLinkedRequireAllLinkedHidden: boolean;
      choiceModelMinIterationCount: number;
    };
  };
  summary: DatasetPlanSummary;
  ambiguities: PlannerAmbiguity[];
  plannedTables: PlannedTable[];
}

// =============================================================================
// Subtype Review (13c1 output)
// =============================================================================

export interface SubtypeReview {
  questionId: string;
  reviewOutcome: 'confirmed' | 'corrected' | 'flagged_for_human';
  confidence: number;
  oldSubtype: string;
  newSubtype: string | null;
  reasoning: string;
  tablesReplaced: number;
  tablesAfter: number;
  plannerOverrodeCorrection: boolean;
}

// =============================================================================
// Block Confidence (used by 13c1 and 13c2)
// =============================================================================

export interface BlockConfidence {
  questionId: string;
  confidence: number;
  source: 'ai_review' | 'ai_review_structure' | 'deterministic';
}

// =============================================================================
// Structure Review (13c2 output)
// =============================================================================

export interface StructureReview {
  questionId: string;
  reviewOutcome: 'confirmed' | 'corrected' | 'flagged_for_human';
  confidence: number;
  triageSignals: string[];
  corrections: Array<{
    correctionType: string;
    newValue: string;
    oldValue: string;
    reasoning: string;
    applied: boolean;
    tablesRemoved?: number;
    tablesAfter?: number;
  }>;
  reasoning: string;
}

// =============================================================================
// Validated Plan Output (13c1/13c2 output)
// =============================================================================

export interface ValidatedPlanOutput {
  metadata: Record<string, unknown>;
  plannedTables: PlannedTable[];
  subtypeReviews: SubtypeReview[];
  structureReviews?: StructureReview[];
  blockConfidence: BlockConfidence[];
}

// =============================================================================
// Canonical Table (13d output) — per docs/v3-13d-canonical-table-spec.md
// =============================================================================

export type TableType = 'frequency' | 'mean_rows';

export type RowKind = 'value' | 'net' | 'stat' | 'bin' | 'rank' | 'topk' | 'not_answered';

export interface StatsSpec {
  mean: boolean;
  meanWithoutOutliers: boolean;
  median: boolean;
  stdDev: boolean;
  stdErr: boolean;
  valueRange: [number, number] | null;
  excludeTailValues: number[];
}

export interface DerivationHint {
  parentTableId: string;
  variableMapping: string | null;
  rangeMapping: string | null;
}

export interface RollupConfig {
  scalePoints: number;
  boxPosition: 'top' | 'middle' | 'bottom';
  boxWidth: number;
  defaultLabel: string;
}

export interface StatTestSpec {
  testType: 'z_test' | 't_test' | null;
  confidenceLevel: number;
}

export type WinCrossDenominatorSemantic =
  | 'answering_base'
  | 'sample_base'
  | 'qualified_respondents'
  | 'filtered_sample'
  | 'response_level';

export interface CanonicalRow {
  variable: string;
  label: string;
  filterValue: string;

  rowKind: RowKind;
  isNet: boolean;
  indent: number;

  netLabel: string;
  netComponents: string[];

  statType: '' | 'mean' | 'median' | 'stddev' | 'stderr';
  binRange: [number, number] | null;
  binLabel: string;
  rankLevel: number | null;
  topKLevel: number | null;

  excludeFromStats: boolean;
  rollupConfig: RollupConfig | null;
}

export interface CanonicalTable {
  // Identity and lineage
  tableId: string;
  questionId: string;
  familyRoot: string;
  sourceTableId: string;
  splitFromTableId: string;

  // Classification
  tableKind: TableKind;
  analyticalSubtype: string;
  normalizedType: string;
  tableType: TableType;

  // Content
  questionText: string;
  rows: CanonicalRow[];

  // Stats and rollup semantics
  statsSpec: StatsSpec | null;
  derivationHint: DerivationHint | null;
  statTestSpec: StatTestSpec | null;
  wincrossDenominatorSemantic?: WinCrossDenominatorSemantic;
  wincrossQualifiedCodes?: string[];
  wincrossFilteredTotalExpr?: string | null;

  // Base and context
  basePolicy: string;
  baseSource: string;
  questionBase: number | null;
  itemBase: number | null;
  baseContract: BaseContractV1;
  baseViewRole?: PlannedTableBaseViewRole;
  plannerBaseComparability?: PlannerBaseComparability;
  plannerBaseSignals?: PlannerBaseSignal[];
  computeRiskSignals?: ComputeRiskSignal[];
  sumConstraint?: QuestionIdEntry['sumConstraint'];
  baseDisclosure?: CanonicalBaseDisclosure;
  baseText: string;

  // Presentation/order metadata
  isDerived: boolean;
  sortOrder: number;
  sortBlock: string;
  surveySection: string;
  userNote: string;
  tableSubtitle: string;

  // Filters/splits
  splitReason: string | null;
  appliesToItem: string | null;
  computeMaskAnchorVariable: string | null;
  appliesToColumn: string | null;
  stimuliSetSlice: StimuliSetSlice | null;
  binarySide: 'selected' | 'unselected' | null;
  additionalFilter: string;

  // Pipeline controls
  exclude: boolean;
  excludeReason: string;
  filterReviewRequired: boolean;
  lastModifiedBy: string;

  // Planner/assembler notes
  notes: string[];
}

// =============================================================================
// Canonical Table Output (13d full output)
// =============================================================================

export interface CanonicalTableOutput {
  metadata: {
    generatedAt: string;
    assemblerVersion: string;
    dataset: string;
    inputPlanPath: string;
    inputQuestionIdPath: string;
    totalTables: number;
    isMessageTestingSurvey?: boolean;
    hasMaxDiff?: boolean;
    isDemandSurvey?: boolean;
  };
  summary: {
    byTableKind: Record<string, number>;
    byTableType: Record<string, number>;
    byAnalyticalSubtype: Record<string, number>;
    totalRows: number;
  };
  tables: CanonicalTable[];
}

// =============================================================================
// Pipeline Input / Output (full canonical chain 13b→13d)
// =============================================================================

export interface CanonicalChainInput {
  /** Enriched question-id entries from stage 12 */
  entries: QuestionIdEntry[];
  /** Loop mappings derived from stage-12 loop metadata. */
  loopMappings?: LoopGroupMapping[];
  /** Survey-level metadata */
  metadata: SurveyMetadata;
  /** Triage flagged entries from stage 10 (for 13c1 subtype gate) */
  triageFlagged: TriagedEntry[];
  /** Parsed survey questions from stage 08a (for 13c2 structure gate) */
  surveyParsed: ParsedSurveyQuestion[];
  /** Output directory for artifacts and checkpoint */
  outputDir: string;
  /** Pipeline run identifier */
  pipelineId: string;
  /** Dataset name */
  dataset: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Existing checkpoint for resume */
  checkpoint?: V3PipelineCheckpoint | null;
  /** Planner configuration (low-base suppression, etc.) */
  plannerConfig?: PlannerConfig;
  /** Project-scoped table presentation settings. */
  tablePresentationConfig?: TablePresentationConfig;
}

export interface CanonicalChainResult {
  /** Canonical tables (table.json content) */
  tables: CanonicalTable[];
  /** Validated planned tables (intermediate) */
  validatedPlan: ValidatedPlanOutput;
  /** Table plan output (intermediate) */
  tablePlan: TablePlanOutput;
  /** Updated pipeline checkpoint */
  checkpoint: V3PipelineCheckpoint;
}
