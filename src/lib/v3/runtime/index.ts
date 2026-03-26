/**
 * V3 Runtime — Public API
 *
 * Barrel export for the V3 runtime module.
 * Import from '@/lib/v3/runtime' for stage order, contracts, and helpers.
 */

export {
  V3_STAGE_ORDER,
  V3_STAGE_COUNT,
  V3_STAGE_NAMES,
  V3_STAGE_PHASES,
  type V3StageId,
  getStageIndex,
  getNextStage,
  isBefore,
  getStageRange,
  isV3StageId,
} from './stageOrder';

export {
  V3_CONTRACT_SCHEMA_VERSION,
  V3_STAGE_ARTIFACTS,
  V3_CHECKPOINT_FILENAME,
  type V3StageCheckpoint,
  type V3PipelineCheckpoint,
  createPipelineCheckpoint,
  recordStageCompletion,
  isCheckpointCompatible,
} from './contracts';

export {
  getStagesDir,
  getSubDir,
  getArtifactPath,
  getCheckpointPath,
  writeArtifact,
  writeCheckpoint,
  loadArtifact,
  loadCheckpoint,
} from './persistence';

// Question-ID chain
export { runQuestionIdPipeline } from './questionId/runQuestionIdPipeline';
export type {
  QuestionIdChainInput,
  QuestionIdChainResult,
  QuestionIdEntry,
  SurveyMetadata,
  DatasetIntakeConfig,
} from './questionId/types';

// Canonical chain (table planning + validation + assembly)
export { runCanonicalPipeline } from './canonical/runCanonicalPipeline';
export { runTablePlanner, buildContext, planEntryTables, classifyScale } from './canonical/plan';
export { runSubtypeGate } from './canonical/subtypeGate';
export { runStructureGate } from './canonical/structureGate';
export { runCanonicalAssembly } from './canonical/assemble';
export type { TablePlannerInput } from './canonical/plan';
export type { SubtypeGateInput, SubtypeGateResult } from './canonical/subtypeGate';
export type { StructureGateInput, StructureGateResult } from './canonical/structureGate';
export type { CanonicalAssemblyInput } from './canonical/assemble';
export type {
  CanonicalChainInput,
  CanonicalChainResult,
  PlannedTable,
  TableKind,
  PlannerAmbiguity,
  QuestionDiagnostic,
  HiddenSuppressionDecision,
  SuppressionReasonCode,
  DatasetPlanSummary,
  ScaleMode,
  TablePlanOutput,
  ValidatedPlanOutput,
  TableType,
  RowKind,
  StatsSpec,
  DerivationHint,
  RollupConfig,
  StatTestSpec,
  CanonicalTable,
  CanonicalRow,
  CanonicalTableOutput,
  SubtypeReview,
  StructureReview,
  BlockConfidence,
  EntryContext,
  ScaleClassification,
  PlannerOverrides,
} from './canonical/types';

// Planning chain (banner + crosstab planning)
export { runPlanningPipeline } from './planning/runPlanningPipeline';
export { runBannerPlan } from './planning/bannerPlan';
export type { BannerPlanInput } from './planning/bannerPlan';
export { runCrosstabPlan } from './planning/crosstabPlan';
export type { CrosstabPlanInput } from './planning/crosstabPlan';
export { runBannerDiagnostic, extractBannerTokens, classifyColumnStatus } from './planning/bannerDiagnostic';
export type { BannerDiagnosticInput } from './planning/bannerDiagnostic';
export type {
  BannerPlanInputType,
  ValidationResultType,
  QuestionContext,
  BannerQuestionSummary,
  PlanningChainInput,
  PlanningChainResult,
  BannerPlanResult,
  CrosstabPlanResult,
  BannerRouteUsed,
  BannerGenerateInputSource,
  BannerRouteMetadata,
  BannerPlanSource,
  CrosstabFallbackReason,
  ResolvedBannerPlanInfo,
  DiagnosticQuestionIdEntry,
  ColumnDispositionStatus,
  QuestionMatchType,
  QuestionMatch,
  ColumnDiagnostic,
  BannerDiagnosticSummary,
  BannerDiagnosticResult,
} from './planning/types';

// Compute chain (compute handoff + post-R QC)
export { runComputePipeline } from './compute/runComputePipeline';
export { buildComputePackage, buildComputePackageFromPlan } from './compute/buildComputePackage';
export { resolveStatConfig } from './compute/resolveStatConfig';
export type { CliStatTestingOverrides } from './compute/resolveStatConfig';
export { runPostRQc } from './compute/postRQc';
export type {
  ComputeChainInput,
  ComputeChainResult,
  BuildComputePackageInput,
  ComputePackageOutput,
  ComputeRouteMetadata,
  WizardStatTestingOverrides,
  PostRQcInput,
  PostRQcResult,
} from './compute/types';

// Top-level V3 pipeline orchestrator (Phase 5: fork/join)
export {
  runV3Pipeline,
  mergeParallelCheckpoints,
  getResumePhase,
} from './runV3Pipeline';
export type {
  V3PipelineInput,
  V3PipelineResult,
} from './runV3Pipeline';

// Review module (Phase 5: HITL/review contract alignment)
export {
  V3_REVIEW_STAGE,
  V3_REVIEW_CHECKPOINT_FILENAME,
  createReviewCheckpoint,
  completeReviewCheckpoint,
  isReviewCheckpointCompatible,
  canResumeAfterReview,
} from './review';
export type {
  V3ReviewStatus,
  V3ReviewCheckpoint,
} from './review';

// Post-V3 processing (Phase 6a: shared R+Excel module)
export { runPostV3Processing } from './postV3Processing';
export type { PostV3ProcessingInput, PostV3ProcessingResult } from './postV3Processing';
export { buildPipelineSummary, getCostSummaryString } from './buildPipelineSummary';
export type { PipelineSummaryInput, PipelineSummary as V3PipelineSummary } from './buildPipelineSummary';
