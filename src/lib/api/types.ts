import type { BannerProcessingResult } from '@/agents/BannerAgent';
import type { CrosstabScratchpadByGroup } from '@/agents/CrosstabAgent';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';
import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';
import type { TableAgentOutput } from '@/schemas/tableAgentSchema';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import type { DeterministicResolverResult } from '@/lib/validation/LoopContextResolver';
import type { FilterTranslationResult } from '@/schemas/skipLogicSchema';
import type { ProjectConfig } from '@/schemas/projectConfigSchema';
import type { PipelineDecisions } from '@/lib/v3/runtime/pipelineDecisions';
import type { RegroupDecisionReport } from '@/lib/v3/runtime/questionId/groupingAdapter';
import type { MaxDiffPolicy } from '@/lib/maxdiff/policy';
import type { V3PipelineCheckpoint } from '@/lib/v3/runtime/contracts';
import type { GroupHint } from '@/schemas/crosstabDecisionSchema';

export type PipelineStatus = 'in_progress' | 'pending_review' | 'resuming' | 'success' | 'partial' | 'error' | 'cancelled';

export interface PipelineSummary {
  pipelineId: string;
  dataset: string;
  timestamp: string;
  source: 'ui' | 'cli';
  status: PipelineStatus;
  currentStage?: string;
  options?: {
    loopStatTestingMode?: 'suppress' | 'complement';
  };
  inputs: {
    datamap?: string;
    banner?: string;
    spss: string;
    survey: string | null;
  };
  duration?: {
    ms: number;
    formatted: string;
  };
  outputs?: {
    variables: number;
    tableGeneratorTables: number;
    verifiedTables: number;
    validatedTables: number;
    excludedTables: number;
    totalTablesInR: number;
    cuts: number;
    bannerGroups: number;
    sorting: {
      screeners: number;
      main: number;
      other: number;
    };
    rValidation?: {
      passedFirstTime: number;
      fixedAfterRetry: number;
      excluded: number;
      durationMs: number;
    };
  };
  runDiagnostics?: {
    tableExpansionRatio: number;
    baseTextHallucinationCount: number;
    unresolvedPlaceholderCount: number;
    formatNormalizationAdjustments: number;
    splitCapViolations: number;
    warnings: string[];
  };
  costs?: {
    byAgent: Array<{
      agent: string;
      model: string;
      calls: number;
      inputTokens: number;
      outputTokens: number;
      durationMs: number;
      estimatedCostUsd: number;
    }>;
    totals: {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      totalTokens: number;
      durationMs: number;
      estimatedCostUsd: number;
    };
  };
  error?: string;
  /** V3 runtime stage checkpoint. Present when V3 stage tracking is active. */
  v3Checkpoint?: V3PipelineCheckpoint;
  review?: {
    flaggedColumnCount: number;
    reviewUrl: string;
  };
  errors?: {
    total: number;
    bySource: Record<string, number>;
    bySeverity: Record<string, number>;
    byAgent: Record<string, number>;
    byStageName: Record<string, number>;
    lastErrorAt: string;
    invalidLines: number;
  };
  maxdiff?: {
    detected: boolean;
    familiesFound: string[];
    consolidatedTableCount: number;
    anchorExcluded: boolean;
    alternateGroups: string[];
    messageListUsed: boolean;
    choiceTaskFamiliesDetected?: string[];
    choiceTaskDetectionConfidence?: number;
    policy?: MaxDiffPolicy;
    warnings?: { code: string; message: string; details?: string }[];
  };
  pipelineDecisions?: PipelineDecisions;
  decisionsSummary?: string;
}

export interface AgentDataMapItem {
  Column: string;
  Description: string;
  Answer_Options: string;
  Type?: string;
}

export interface BannerGroupAgent {
  groupName: string;
  columns: Array<{
    name: string;
    original: string;
  }>;
}

export interface PathAResult {
  bannerResult: BannerProcessingResult;
  crosstabResult: { result: ValidationResultType; processingLog: string[]; scratchpadByGroup?: CrosstabScratchpadByGroup };
  agentBanner: BannerGroupAgent[];
  reviewRequired: boolean;
}

export interface PathBResult {
  tableAgentResults: TableAgentOutput[];
  /** @deprecated Verification now runs post-join. Present for backward compat with serialized review state. */
  verifiedTables?: ExtendedTableDefinition[];
  surveyMarkdown: string | null;
  regroupDecisionReport?: RegroupDecisionReport;
  regroupSummary?: string;
}

export interface PathCStatus {
  /** @deprecated Path C is removed from active pipeline flow. Retained for backward compatibility. */
  status: 'running' | 'completed' | 'error' | 'skipped';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface PathCResult {
  /** @deprecated Path C is removed from active pipeline flow. Retained for backward compatibility. */
  filterResult: FilterTranslationResult | null;
  skipLogicRuleCount: number;
  filterCount: number;
}

export interface FlaggedCrosstabColumn {
  groupName: string;
  columnName: string;
  original: string;
  proposed: string;
  confidence: number;
  reasoning: string;
  userSummary: string;
  alternatives: ReviewAlternative[];
  uncertainties: string[];
  expressionType?: string;
}

export type ReviewAlternativeSource = 'model_alternative' | 'literal_original';

export interface ReviewAlternative {
  expression: string;
  rank: number;
  userSummary: string;
  selectable: boolean;
  nonSelectableReason?: string;
  source?: ReviewAlternativeSource;
}

export interface PathBStatus {
  status: 'running' | 'completed' | 'error';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface CrosstabReviewState {
  pipelineId: string;
  status: 'awaiting_review' | 'approved' | 'cancelled';
  createdAt: string;
  projectName?: string;  // For ConsoleCapture log prefix continuity
  crosstabResult: ValidationResultType;
  flaggedColumns: FlaggedCrosstabColumn[];
  bannerResult: BannerProcessingResult;
  agentDataMap: AgentDataMapItem[];
  outputDir: string;
  pathBStatus: 'running' | 'completed' | 'error';
  pathBResult: PathBResult | null;
  /** @deprecated Path C is always `skipped` in active pipeline flow. */
  pathCStatus: 'running' | 'completed' | 'error' | 'skipped';
  /** @deprecated Path C result is always `null` in active pipeline flow. */
  pathCResult: PathCResult | null;
  // Expanded context for post-review pipeline completion
  verboseDataMap: import('@/schemas/processingSchemas').VerboseDataMapType[];
  surveyMarkdown: string | null;
  spssPath: string;
  loopMappings: LoopGroupMapping[];
  baseNameToLoopIndex: Record<string, number>;
  deterministicFindings?: DeterministicResolverResult;
  wizardConfig?: ProjectConfig;
  loopStatTestingMode?: 'suppress' | 'complement';
  /** Path to uploaded message list file (MaxDiff only) */
  messageListPath?: string | null;
  crosstabScratchpadByGroup?: CrosstabScratchpadByGroup;
  /** V3 runtime checkpoint. When present, indicates this is a V3-native run —
   *  both canonical and planning chains completed before review pause. */
  v3Checkpoint?: V3PipelineCheckpoint;
  decisions?: Array<{
    groupName: string;
    columnName: string;
    action: 'approve' | 'select_alternative' | 'provide_hint' | 'edit' | 'skip';
    selectedAlternative?: number;
    hint?: string;
    editedExpression?: string;
  }>;
  groupHints?: GroupHint[];
}

export interface ParsedUploadFiles {
  dataMapFile: File;
  bannerPlanFile: File;
  dataFile: File;
  surveyFile: File | null;
  loopStatTestingMode: 'suppress' | 'complement' | undefined;
}

export interface SavedFilePaths {
  dataMapPath: string;
  bannerPlanPath: string;
  spssPath: string;
  surveyPath: string | null;
  /** Path to uploaded message list file (MaxDiff only) */
  messageListPath?: string | null;
  /** @deprecated Input files are no longer uploaded to R2. This field is kept for backward compatibility. */
  r2Keys?: {
    dataMap: string;
    bannerPlan: string;
    spss: string;
    survey: string | null;
  };
}

// --- Review diff report types ---

export interface ReviewDiffEntry {
  groupName: string;
  columnName: string;
  action: 'approve' | 'select_alternative' | 'provide_hint' | 'edit' | 'skip';
  hint?: string;
  selectedAlternativeIndex?: number;
  before: { expression: string; confidence: number };
  after: { expression: string; confidence: number };
  expressionChanged: boolean;
  status: 'applied' | 'error' | 'fallback';
  error?: string;
}

export interface ReviewDiffSummary {
  totalColumns: number;
  approved: number;
  hinted: number;
  alternativesSelected: number;
  edited: number;
  skipped: number;
  expressionsChanged: number;
  expressionsUnchanged: number;
  errors: number;
}

export interface ReviewDiffReport {
  pipelineId: string;
  reviewedAt: string;
  entries: ReviewDiffEntry[];
  summary: ReviewDiffSummary;
}

// --- Review provenance types ---

export type ReviewAction = 'ai_original' | 'approved' | 'hint_applied' | 'alternative_selected' | 'user_edited';

export type ReviewedColumnType = import('@/schemas/agentOutputSchema').ValidatedColumnType & {
  reviewAction: ReviewAction;
  reviewHint: string;
  preReviewExpression: string;
};

export interface ReviewedValidationResult {
  bannerCuts: Array<{ groupName: string; columns: ReviewedColumnType[] }>;
}

// --- Wizard-specific types (Phase 3.3) ---

export interface ParsedWizardFiles {
  dataFile: File;
  surveyFile: File;
  bannerPlanFile: File | null;
  messageListFile: File | null;
}

export interface SavedWizardPaths {
  spssPath: string;
  surveyPath: string;
  bannerPlanPath: string | null;
  messageListPath: string | null;
  /** @deprecated Input files are no longer uploaded to R2. This field is kept for backward compatibility. */
  r2Keys?: {
    spss: string;
    survey: string;
    bannerPlan: string | null;
    messageList: string | null;
  };
}
