/**
 * Question-centric context module.
 *
 * Provides adapters, renderers, and utilities for building question-grouped
 * input for CrosstabAgent V2 and BannerGenerateAgent V2.
 */

// Types (canonical Zod schemas)
export type {
  QuestionContext,
  QuestionContextItem,
  BannerQuestionSummary,
  BaseSummary,
  ValueLabel,
} from '@/schemas/questionContextSchema';

export {
  QuestionContextSchema,
  QuestionContextItemSchema,
  BannerQuestionSummarySchema,
  BaseSummarySchema,
  ValueLabelSchema,
} from '@/schemas/questionContextSchema';

// Source types (questionid-final.json shape)
export type {
  QuestionIdEntry,
  QuestionIdFinalFile,
  LoopSemanticsExcerptEntry,
} from './adapters';

// Adapters — from questionid-final.json (v3 enrichment chain)
export {
  buildQuestionContext,
  buildBannerContext,
  buildLoopSemanticsExcerpt,
  deriveLoopIterationCount,
  extractAllColumns,
  toBannerVerboseDataMap,
} from './adapters';

// Shared utilities
export { extractVariableNames } from './extractVariableNames';

// Adapter — from VerboseDataMap (production pipeline)
export {
  buildQuestionContextFromVerboseDataMap,
} from './buildFromVerboseDataMap';

// Renderers
export {
  renderQuestionContextForCrosstab,
  renderBannerContext,
} from './renderers';
