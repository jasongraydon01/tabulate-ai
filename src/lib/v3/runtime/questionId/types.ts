/**
 * V3 Runtime — Question ID Chain Types
 *
 * Shared type definitions for the question-id enrichment chain (stages 00-12).
 * These types define the growing artifact shape at each stage boundary and the
 * pipeline input/output contracts.
 *
 * The canonical artifact is a `QuestionIdEntry[]` that grows richer as it
 * passes through each stage: 00 seeds it, 03 adds base fields, 08a adds
 * survey labels, 09d adds message matching, 10a resolves loops, 10 triages,
 * 11 validates, and 12 reconciles into the final form.
 */

import type { V3PipelineCheckpoint } from '../contracts';
import type { BaseContractV1 } from '../baseContract';

// =============================================================================
// Dataset Intake Configuration
// =============================================================================

/**
 * Per-dataset intake configuration. In production this comes from the intake
 * form / wizard. For script testing it was hard-coded per dataset.
 */
export interface DatasetIntakeConfig {
  /** Is this a message testing / stimulus evaluation survey? */
  isMessageTesting: boolean;
  /** Is this a concept testing survey? */
  isConceptTesting: boolean;
  /** Does it include a MaxDiff exercise? null if isMessageTesting is false. */
  hasMaxDiff: boolean | null;
  /** Are anchored probability / index scores appended to the .sav? null if hasMaxDiff is false/null. */
  hasAnchoredScores: boolean | null;
  /** Relative path (from dataset inputs dir) to the uploaded message/stimulus template, or null. */
  messageTemplatePath: string | null;
  /** Is this a demand / choice-model survey (e.g., discrete choice, conjoint)? */
  isDemandSurvey: boolean;
  /** Does it include a choice model exercise (Sawtooth CBC/ACBC)? null if isDemandSurvey is false. */
  hasChoiceModelExercise: boolean | null;
}

// =============================================================================
// Survey-level Metadata
// =============================================================================

/**
 * Metadata wrapper written alongside questionid entries at every stage boundary.
 * Preserves dataset identity and intake configuration through the chain.
 */
export interface SurveyMetadata {
  dataset: string;
  generatedAt: string;
  scriptVersion: string;

  // Intake fields
  isMessageTestingSurvey: boolean;
  isConceptTestingSurvey: boolean;
  hasMaxDiff: boolean | null;
  hasAnchoredScores: boolean | null;
  messageTemplatePath: string | null;
  isDemandSurvey: boolean;
  hasChoiceModelExercise: boolean | null;
}

// =============================================================================
// Item-level Types
// =============================================================================

/** A single variable (column) within a question group. */
export interface QuestionIdItem {
  column: string;
  label: string;
  /** Original label from the .sav file. Set once in stage 08a, never overwritten. */
  savLabel?: string;
  /** Label matched from survey parse. Set by stage 08a when a survey option matches. */
  surveyLabel?: string;
  normalizedType: string;
  scaleLabels?: Array<{
    value: number | string;
    label: string;
    /** Original scale label from .sav. Set once, never overwritten. */
    savLabel?: string;
    /** Scale label from survey parse. */
    surveyLabel?: string;
  }>;
  /** Added by step 03: per-item respondent count */
  itemBase: number | null;
  /** Added by step 09d: message code matched to this item */
  messageCode: string | null;
  /** Added by step 09d: message text matched to this item */
  messageText: string | null;
  /** Added by step 09d: alternate message code */
  altCode: string | null;
  /** Added by step 09d: alternate message text */
  altText: string | null;
  /** Added by step 09d: how the match was found */
  matchMethod: 'code_extraction' | 'truncation_prefix' | 'scale_label_code' | null;
  /** Added by step 09d: confidence of the message match */
  matchConfidence: number;
  /** Added by step 00: count of distinct non-NA observed values */
  nUnique?: number | null;
  /** Added by step 00: minimum observed value (numeric only) */
  observedMin?: number | null;
  /** Added by step 00: maximum observed value (numeric only) */
  observedMax?: number | null;
  /** Added by step 00: sorted unique values when nUnique <= 50 */
  observedValues?: number[] | null;
  [key: string]: unknown;
}

// =============================================================================
// Hidden Link
// =============================================================================

export interface HiddenLinkInfo {
  linkedTo: string | null;
  linkMethod: string | null;
}

// =============================================================================
// Loop Info
// =============================================================================

export interface LoopInfo {
  detected: boolean;
  familyBase: string;
  iterationIndex: number;
  iterationCount: number;
  siblingFamilyBases: string[];
  [key: string]: unknown;
}

// =============================================================================
// Ranking Detail
// =============================================================================

export interface RankingDetail {
  /** Number of ranks each respondent selects (e.g. 5 for "rank top 5") */
  K: number;
  /** Total number of items available to rank from */
  N: number;
  /** Human-readable pattern descriptor */
  pattern: string;
  /** Where K was derived from */
  source: 'sum-constraint' | 'scale-labels' | 'observed-range' | 'reconciliation';
}

// =============================================================================
// Item Activity Summary
// =============================================================================

/**
 * Derived summary of item-level activity within a question group.
 * Computed in step 12 from itemBase values. Gives downstream consumers
 * a pre-computed sparsity signal without needing to iterate items.
 */
export interface ItemActivitySummary {
  /** Number of items with itemBase > 0 */
  activeItemCount: number;
  /** Number of items with itemBase === 0 or null */
  inactiveItemCount: number;
  /** Fraction of items that are active (activeItemCount / variableCount), 0–1 */
  activePct: number;
}

// =============================================================================
// Sum Constraint
// =============================================================================

export interface SumConstraintInfo {
  detected: boolean;
  constraintValue: number | null;
  constraintAxis: 'down-rows' | 'across-cols' | null;
  confidence: number;
}

// =============================================================================
// Stimuli Sets
// =============================================================================

export interface StimuliSetDefinition {
  /** 0-based stimuli set index within the family */
  setIndex: number;
  /** Question iteration whose items defined this set */
  sourceQuestionId: string;
  /** Variable columns belonging to this set */
  items: string[];
  /** Number of variables in this set */
  itemCount: number;
}

export interface StimuliSetInfo {
  detected: boolean;
  setCount: number;
  /** Cleared loop family that surfaced the distinct item sets */
  familySource: string;
  sets: StimuliSetDefinition[];
  detectionMethod: 'label_comparison';
}

// =============================================================================
// QuestionIdEntry — The Growing Artifact
// =============================================================================

/**
 * The core enrichment artifact. This shape grows as it passes through stages:
 * - Step 00: Seeds all core fields (disposition, hidden, subtype, loop, survey match)
 * - Step 03: Adds base fields (totalN, questionBase, isFiltered, proposedBase, etc.)
 * - Step 08a: Updates questionText/item labels from survey, adds surveyText
 * - Step 09d: Adds message matching fields to items, adds hasMessageMatches
 * - Step 10a: Resolves loop fields (clears false positives), detects stimuli sets
 * - Step 10: Adds triageReasons (on flagged entries only, via TriagedEntry)
 * - Step 11: Adds _aiGateReview provenance, applies mutations
 * - Step 12: Adds _reconciliation provenance, final label/subtype reconciliation
 *
 * Fields are progressively added — downstream consumers should guard with optional checks.
 */
export interface QuestionIdEntry {
  questionId: string;
  questionText: string;
  variables: string[];
  variableCount: number;

  // Disposition & hidden linking (step 00)
  disposition: 'reportable' | 'excluded' | 'text_open_end';
  exclusionReason: string | null;
  isHidden: boolean;
  hiddenLink: HiddenLinkInfo | null;

  // Analytical subtype (step 00, may be mutated by 11/12)
  analyticalSubtype: string | null;
  subtypeSource: string | null;
  subtypeConfidence: number | null;
  rankingDetail: RankingDetail | null;

  // Sum constraints (step 00)
  sumConstraint: SumConstraintInfo | null;

  // Pipe columns (step 00)
  pipeColumns: string[];

  // Survey matching (step 00, enriched by 08a)
  surveyMatch: 'exact' | 'suffix' | 'none' | null;
  surveyText: string | null;

  // Priority (step 00, may be recomputed by 12)
  priority: 'primary' | 'secondary';

  // Loop detection (step 00, resolved by 10a)
  loop: LoopInfo | null;
  loopQuestionId: string | null;

  // Type metadata (step 00)
  normalizedType: string;

  // Items (step 00, enriched by 03/08a/09d)
  items: QuestionIdItem[];

  // Base fields (added by step 03)
  totalN: number | null;
  questionBase: number | null;
  isFiltered: boolean | null;
  gapFromTotal: number | null;
  gapPct: number | null;
  hasVariableItemBases: boolean | null;
  variableBaseReason: 'ranking-artifact' | 'genuine' | null;
  itemBaseRange: [number, number] | null;
  /** Phase 1 additive contract. Legacy base fields remain the active compatibility surface. */
  baseContract: BaseContractV1;
  /** Compatibility field retained until later phases migrate consumers onto baseContract. */
  proposedBase: number | null;
  /** Compatibility field retained until later phases migrate consumers onto baseContract. */
  proposedBaseLabel: string | null;

  // Display overrides (added by step 12, for user-facing output)
  /** If set, renderers use this instead of questionId for display */
  displayQuestionId: string | null;
  /** If set, renderers use this instead of questionText for display */
  displayQuestionText: string | null;

  // Section header (added by step 12 from survey parse)
  sectionHeader: string | null;

  // Item activity summary (added by step 12)
  itemActivity: ItemActivitySummary | null;

  // Message testing (added by step 09d)
  hasMessageMatches: boolean;

  // Stimuli set detection (added by step 10a)
  stimuliSets: StimuliSetInfo | null;

  // AI gate provenance (added by step 11)
  _aiGateReview: {
    reviewOutcome: 'confirmed' | 'corrected' | 'flagged_for_human';
    confidence: number;
    mutationCount: number;
    reasoning: string;
    reviewedAt: string;
    propagatedFrom: string | null;
  } | null;

  // Reconciliation provenance (added by step 12)
  _reconciliation: {
    reconciledAt: string;
    changesApplied: number;
    fields: string[];
  } | null;

  // Allow additional fields from downstream stages
  [key: string]: unknown;
}

// =============================================================================
// Triage Types (step 10)
// =============================================================================

export interface TriageReason {
  rule: string;
  detail: string;
  severity: 'high' | 'medium' | 'low';
}

export interface TriagedEntry {
  questionId: string;
  disposition: string;
  analyticalSubtype: string;
  subtypeConfidence: number;
  questionText: string;
  variableCount: number;
  triageReasons: TriageReason[];
  /** Full entry for downstream AI review */
  entry: QuestionIdEntry;
}

// =============================================================================
// Pipeline Input / Output
// =============================================================================

/**
 * Input configuration for the question-id enrichment chain (stages 00-12).
 */
export interface QuestionIdChainInput {
  /** Path to the .sav data file */
  savPath: string;
  /** Path to the dataset directory (contains inputs/, etc.) */
  datasetPath: string;
  /** Output directory for artifacts and checkpoint */
  outputDir: string;
  /** Pipeline run identifier */
  pipelineId: string;
  /** Dataset name */
  dataset: string;
  /** Abort signal for cancellation */
  abortSignal?: AbortSignal;
  /** Dataset intake configuration (from wizard or defaults) */
  intakeConfig?: DatasetIntakeConfig;
  /** Optional row cap for demo mode. */
  maxRespondents?: number;
  /** Existing checkpoint for resume (null for fresh run) */
  checkpoint?: V3PipelineCheckpoint | null;
}

/**
 * Result of the question-id enrichment chain (stages 00-12).
 */
export interface QuestionIdChainResult {
  /** Final enriched entries (questionid-final.json content) */
  entries: QuestionIdEntry[];
  /** Survey-level metadata */
  metadata: SurveyMetadata;
  /** Updated pipeline checkpoint */
  checkpoint: V3PipelineCheckpoint;
  /** Parsed survey questions (needed by downstream table/banner chains) */
  surveyParsed: ParsedSurveyQuestion[];
}

// =============================================================================
// Parsed Survey Question (from step 08a, consumed by 10a, 11, 12, 20, 21)
// =============================================================================

export type ParsedQuestionType = 'single_select' | 'multi_select' | 'grid' | 'numeric' | 'open_end' | 'unknown';
export type ParsedFormat = 'numbered_list' | 'table' | 'grid_with_items' | 'free_entry' | 'unknown';

export interface ParsedAnswerOption {
  code: number | string;
  text: string;
  isOther: boolean;
  anchor: boolean;
  routing: string | null;
  progNote: string | null;
}

export interface ParsedSurveyQuestion {
  questionId: string;
  rawText: string;
  questionText: string;
  instructionText: string | null;
  answerOptions: ParsedAnswerOption[];
  scaleLabels: Array<{ value: number; label: string }> | null;
  questionType: ParsedQuestionType;
  format: ParsedFormat;
  progNotes: string[];
  strikethroughSegments: string[];
  sectionHeader: string | null;
}

// =============================================================================
// Wrapped Output Format (metadata + entries)
// =============================================================================

/**
 * The JSON envelope used at every stage boundary.
 * Either bare array (legacy) or wrapped with metadata.
 */
export interface WrappedQuestionIdOutput {
  metadata: SurveyMetadata;
  questionIds: QuestionIdEntry[];
}

/**
 * Unwrap a JSON-parsed artifact that may be bare array or wrapped.
 */
export function unwrapQuestionIdArtifact(
  raw: unknown,
): { metadata: SurveyMetadata | null; entries: QuestionIdEntry[] } {
  if (Array.isArray(raw)) {
    return { metadata: null, entries: raw as QuestionIdEntry[] };
  }
  const obj = raw as Record<string, unknown>;
  const metadata = (obj.metadata as SurveyMetadata) ?? null;
  const entries = (obj.questionIds ?? []) as QuestionIdEntry[];
  return { metadata, entries };
}
