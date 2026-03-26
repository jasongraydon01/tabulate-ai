import type { WeightDetectionResult } from '@/lib/validation/types';
import type { PipelineErrorRecord } from '@/schemas/pipelineErrorSchema';
import {
  deriveStudyFlagsFromConfig,
  type ProjectConfig,
  type StudyFlags,
} from '@/schemas/projectConfigSchema';

import type { CanonicalTable } from './canonical/types';
import type { V3PipelineCheckpoint } from './contracts';
import type { QuestionIdEntry, SurveyMetadata } from './questionId/types';

export interface PipelineDecisions {
  enrichment: {
    totalQuestions: number;
    loopsDetected: number;
    aiTriageRequired: number;
    aiValidationPassed: number;
    messageCodesMatched: number;
  };
  tables: {
    canonicalTablesPlanned: number;
    finalTableCount: number;
    netsAdded: number;
    tablesExcluded: number;
  };
  banners: {
    source: 'uploaded' | 'auto_generated';
    bannerGroupCount: number;
    totalCuts: number;
    flaggedForReview: number;
  };
  weights: {
    detected: boolean;
    variableUsed: string | null;
    candidateCount: number;
  };
  errors: {
    total: number;
    recovered: number;
    warnings: number;
  };
  timing: {
    enrichmentMs: number;
    tableGenerationMs: number;
    computeMs: number;
    excelMs: number;
    totalMs: number;
  };
  studyFlags: StudyFlags;
}

export interface BuildPipelineDecisionsInput {
  config?: ProjectConfig;
  fallbackStudyFlags?: StudyFlags;
  questionId: {
    entries: QuestionIdEntry[];
    metadata?: SurveyMetadata;
  };
  checkpoint: V3PipelineCheckpoint;
  tables: {
    canonicalTablesPlanned: number;
    canonicalTables: CanonicalTable[];
    finalTableCount: number;
  };
  banners: {
    source: 'uploaded' | 'auto_generated';
    bannerGroupCount: number;
    totalCuts: number;
    flaggedForReview: number;
  };
  weights: {
    detection?: WeightDetectionResult | null;
    variableUsed?: string | null;
  };
  errors?: {
    records?: PipelineErrorRecord[];
    validationWarningCount?: number;
  };
  timing: {
    postRMs?: number;
    excelMs?: number;
    totalMs: number;
  };
}

const ENRICHMENT_STAGE_IDS = new Set(['00', '03', '08a', '09d', '10a', '10', '11', '12']);
const TABLE_GENERATION_STAGE_IDS = new Set(['13b', '13c1', '13c2', '13d', '13e', '20', '21']);
const COMPUTE_STAGE_IDS = new Set(['22', '14']);

export function buildPipelineDecisions(input: BuildPipelineDecisionsInput): PipelineDecisions {
  const aiReviewedEntries = input.questionId.entries.filter((entry) => entry._aiGateReview !== null);
  const recoveredErrors = (input.errors?.records ?? []).filter((record) =>
    record.actionTaken === 'continued' ||
    record.actionTaken === 'fallback_used' ||
    record.actionTaken === 'skipped_item',
  ).length;
  const studyFlags = resolveStudyFlags(input);
  const computeStageMs = sumStageDurations(input.checkpoint, COMPUTE_STAGE_IDS);
  const postRMs = input.timing.postRMs ?? 0;
  const canonicalTables = input.tables.canonicalTables;

  return {
    enrichment: {
      totalQuestions: input.questionId.entries.length,
      loopsDetected: countLoopFamilies(input.questionId.entries),
      aiTriageRequired: aiReviewedEntries.length,
      aiValidationPassed: aiReviewedEntries.filter(
        (entry) => entry._aiGateReview?.reviewOutcome !== 'flagged_for_human',
      ).length,
      messageCodesMatched: countMessageCodesMatched(input.questionId.entries),
    },
    tables: {
      canonicalTablesPlanned: input.tables.canonicalTablesPlanned,
      finalTableCount: input.tables.finalTableCount,
      netsAdded: countNetSummaryTables(canonicalTables),
      tablesExcluded: canonicalTables.filter((table) => table.exclude).length,
    },
    banners: {
      ...input.banners,
    },
    weights: {
      detected: !!input.weights.detection?.bestCandidate,
      variableUsed: input.weights.variableUsed ?? null,
      candidateCount: input.weights.detection?.candidates.length ?? 0,
    },
    errors: {
      total: input.errors?.records?.length ?? 0,
      recovered: recoveredErrors,
      warnings:
        (input.errors?.validationWarningCount ?? 0) +
        (input.errors?.records?.filter((record) => record.severity === 'warning').length ?? 0),
    },
    timing: {
      enrichmentMs: sumStageDurations(input.checkpoint, ENRICHMENT_STAGE_IDS),
      tableGenerationMs: sumStageDurations(input.checkpoint, TABLE_GENERATION_STAGE_IDS),
      computeMs: computeStageMs + postRMs,
      excelMs: input.timing.excelMs ?? 0,
      totalMs: input.timing.totalMs,
    },
    studyFlags,
  };
}

export function buildDecisionsSummary(decisions: PipelineDecisions): string {
  const lines = [
    `Processed ${decisions.enrichment.totalQuestions} questions and planned ${decisions.tables.canonicalTablesPlanned} canonical tables${formatNetClause(decisions.tables.netsAdded)}${formatExcludedClause(decisions.tables.tablesExcluded)}, yielding ${decisions.tables.finalTableCount} final tables. ${formatLoopClause(decisions.enrichment.loopsDetected)} ${formatAiClause(decisions.enrichment.aiTriageRequired, decisions.enrichment.aiValidationPassed)}${formatMaxDiffClause(decisions.studyFlags.hasMaxDiff)}`,
    `Bannering was ${decisions.banners.source === 'uploaded' ? 'uploaded' : 'auto-generated'} across ${decisions.banners.bannerGroupCount} groups and ${decisions.banners.totalCuts} cuts${formatReviewClause(decisions.banners.flaggedForReview)}. ${formatWeightClause(decisions.weights)} ${formatErrorClause(decisions.errors)} Total runtime was ${formatDuration(decisions.timing.totalMs)}.`,
  ];

  return lines.join('\n\n');
}

export function countLoopFamilies(entries: QuestionIdEntry[]): number {
  return new Set(
    entries
      .map((entry) => entry.loop)
      .filter((loop): loop is NonNullable<QuestionIdEntry['loop']> => !!loop?.detected && !!loop.familyBase)
      .map((loop) => loop.familyBase),
  ).size;
}

export function countMessageCodesMatched(entries: QuestionIdEntry[]): number {
  return new Set(
    entries.flatMap((entry) =>
      entry.items
        .map((item) => item.messageCode)
        .filter((code): code is string => typeof code === 'string' && code.length > 0),
    ),
  ).size;
}

export function countNetSummaryTables(tables: CanonicalTable[]): number {
  return tables.filter(
    (table) => table.lastModifiedBy === 'NETEnrichmentAgent' || table.tableId.endsWith('__net_summary'),
  ).length;
}

function sumStageDurations(
  checkpoint: V3PipelineCheckpoint,
  includedStages: Set<string>,
): number {
  return checkpoint.completedStages.reduce((total, stage) => (
    includedStages.has(stage.completedStage) ? total + stage.durationMs : total
  ), 0);
}

function resolveStudyFlags(input: BuildPipelineDecisionsInput): StudyFlags {
  if (input.config) return deriveStudyFlagsFromConfig(input.config);
  if (input.fallbackStudyFlags) return input.fallbackStudyFlags;

  return {
    isDemandSurvey: input.questionId.metadata?.isDemandSurvey ?? false,
    hasChoiceModelExercise: input.questionId.metadata?.hasChoiceModelExercise ?? null,
    hasMaxDiff: input.questionId.metadata?.hasMaxDiff ?? false,
  };
}

function formatAiClause(required: number, passed: number): string {
  if (required === 0) return 'No AI validation pass was needed.';
  return `${required} question${required === 1 ? '' : 's'} required AI validation, and ${passed} passed without human escalation.`;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)}s`;

  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function formatErrorClause(errors: PipelineDecisions['errors']): string {
  if (errors.total === 0 && errors.warnings === 0) return 'No persisted pipeline errors or warnings were recorded.';

  const parts = [`${errors.total} persisted error${errors.total === 1 ? '' : 's'}`];
  if (errors.recovered > 0) parts.push(`${errors.recovered} recovered`);
  if (errors.warnings > 0) parts.push(`${errors.warnings} warning${errors.warnings === 1 ? '' : 's'}`);
  return `${parts.join(', ')} were recorded.`;
}

function formatExcludedClause(tablesExcluded: number): string {
  return tablesExcluded > 0 ? `, excluding ${tablesExcluded}` : '';
}

function formatLoopClause(loopsDetected: number): string {
  if (loopsDetected === 0) return 'No loop structures were detected.';
  return `${loopsDetected} loop structure${loopsDetected === 1 ? '' : 's'} ${loopsDetected === 1 ? 'was' : 'were'} detected.`;
}

function formatMaxDiffClause(hasMaxDiff: boolean): string {
  return hasMaxDiff ? ' MaxDiff structure was detected in the study configuration.' : '';
}

function formatNetClause(netsAdded: number): string {
  return netsAdded > 0 ? `, added ${netsAdded} NET roll-up table${netsAdded === 1 ? '' : 's'}` : '';
}

function formatReviewClause(flaggedForReview: number): string {
  return flaggedForReview > 0
    ? `, with ${flaggedForReview} cut${flaggedForReview === 1 ? '' : 's'} flagged for review`
    : '';
}

function formatWeightClause(weights: PipelineDecisions['weights']): string {
  if (weights.variableUsed) {
    return `Weighting used \`${weights.variableUsed}\`${weights.detected ? '' : ' via explicit configuration'}.`;
  }
  if (weights.detected) {
    return `A weight candidate was detected, but no weighting variable was applied.`;
  }
  return `No weight variable was detected or applied.`;
}
