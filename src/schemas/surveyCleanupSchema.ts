/**
 * Survey Cleanup schema — Zod output schema for the SurveyCleanupAgent (Step 08b)
 *
 * Defines the AI output shape for the survey parse cleanup pass.
 * Only cleanable fields are included — immutable fields (rawText, format,
 * progNotes, strikethroughSegments) are preserved from the original.
 *
 * Azure structured output compliance:
 * - All fields required (no .optional())
 * - No z.any() or z.unknown()
 * - Use plain z.string() (not .default('')) — Azure requires all in 'required'
 * - Empty array [] for null-equivalent arrays
 */

import { z } from 'zod';

/**
 * Cleaned answer option — only code + text.
 * Other fields (isOther, anchor, routing, progNote) are preserved from the original.
 */
export const SurveyCleanupAnswerOptionSchema = z.object({
  code: z.union([z.number(), z.string()]),
  text: z.string(),
});

export type SurveyCleanupAnswerOption = z.infer<typeof SurveyCleanupAnswerOptionSchema>;

/**
 * Cleaned scale label — only value + label.
 */
export const SurveyCleanupScaleLabelSchema = z.object({
  value: z.number(),
  label: z.string(),
});

export type SurveyCleanupScaleLabel = z.infer<typeof SurveyCleanupScaleLabelSchema>;

/**
 * Cleaned version of a single parsed survey question.
 * questionId is the join key to match back to the original.
 */
export const SurveyCleanupQuestionSchema = z.object({
  questionId: z.string(),
  questionText: z.string(),
  instructionText: z.string(),
  answerOptions: z.array(SurveyCleanupAnswerOptionSchema),
  scaleLabels: z.array(SurveyCleanupScaleLabelSchema),
  questionType: z.string(),
  sectionHeader: z.string(),
});

export type SurveyCleanupQuestion = z.infer<typeof SurveyCleanupQuestionSchema>;

/**
 * Full output schema for a single SurveyCleanupAgent call.
 */
export const SurveyCleanupOutputSchema = z.object({
  questions: z.array(SurveyCleanupQuestionSchema),
});

export type SurveyCleanupOutput = z.infer<typeof SurveyCleanupOutputSchema>;
