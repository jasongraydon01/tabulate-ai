/**
 * Question-centric schemas for the banner/crosstab pipeline.
 *
 * These define the canonical production types for question-grouped
 * survey data. Used by CrosstabAgentV2, BannerGenerateAgentV2,
 * and all three pipeline code paths when USE_QUESTION_CENTRIC=true.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Value label — shared between items and question-level summaries
// ---------------------------------------------------------------------------

export const ValueLabelSchema = z.object({
  value: z.union([z.string(), z.number()]),
  label: z.string(),
});

export type ValueLabel = z.infer<typeof ValueLabelSchema>;

// ---------------------------------------------------------------------------
// QuestionContextItem — one executable variable within a question
// ---------------------------------------------------------------------------

export const QuestionContextItemSchema = z.object({
  column: z.string(),
  label: z.string(),
  normalizedType: z.string(),
  valueLabels: z.array(ValueLabelSchema),
});

export type QuestionContextItem = z.infer<typeof QuestionContextItemSchema>;

// ---------------------------------------------------------------------------
// BaseSummary — lightweight projection of BaseContractV1 for agent context
// ---------------------------------------------------------------------------

export const BaseSummarySchema = z.object({
  /** Base situation classification (uniform, filtered, varying_items, model_derived, etc.) */
  situation: z.string().nullable(),
  /** Structural base signals (e.g., filtered-base, model-derived-base, low-base) */
  signals: z.array(z.string()),
  /** Respondents eligible for this question */
  questionBase: z.number().nullable(),
  /** Total dataset respondent count */
  totalN: z.number().nullable(),
  /** Min/max item base range when items have varying bases */
  itemBaseRange: z.tuple([z.number(), z.number()]).nullable(),
});

export type BaseSummary = z.infer<typeof BaseSummarySchema>;

// ---------------------------------------------------------------------------
// QuestionContext — one reportable question with nested items
// ---------------------------------------------------------------------------

export const QuestionContextSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  normalizedType: z.string(),
  analyticalSubtype: z.string().nullable(),
  disposition: z.literal('reportable'),
  isHidden: z.boolean(),
  hiddenLink: z.object({
    linkedTo: z.string(),
    method: z.string(),
  }).nullable(),
  loop: z.object({
    familyBase: z.string(),
    iterationIndex: z.number(),
    iterationCount: z.number(),
  }).nullable(),
  loopQuestionId: z.string().nullable(),
  surveyMatch: z.string().nullable(),
  /** Base situation summary from the enrichment chain (Phase D). Nullable for backward compat. */
  baseSummary: BaseSummarySchema.nullable(),
  items: z.array(QuestionContextItemSchema),
});

export type QuestionContext = z.infer<typeof QuestionContextSchema>;

// ---------------------------------------------------------------------------
// BannerQuestionSummary — question-level projection for BannerGenerateAgent
// ---------------------------------------------------------------------------

export const BannerQuestionSummarySchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  normalizedType: z.string(),
  analyticalSubtype: z.string().nullable(),
  itemCount: z.number(),
  valueLabels: z.array(ValueLabelSchema),
  itemLabels: z.array(z.object({
    column: z.string(),
    label: z.string(),
  })),
  loopIterationCount: z.number().nullable(),
  isHidden: z.boolean(),
  hiddenLinkedTo: z.string().nullable(),
});

export type BannerQuestionSummary = z.infer<typeof BannerQuestionSummarySchema>;
