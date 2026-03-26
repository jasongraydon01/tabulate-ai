import { z } from 'zod';

/**
 * Feedback on a pipeline run output.
 *
 * Stored on disk at: outputs/<dataset>/<pipelineId>/feedback.json
 *
 * Notes on schema conventions:
 * - Avoid `undefined` in persisted JSON. Use 0 / '' / [] / null where needed.
 * - `rating` uses 0 to represent "not provided".
 */

export const PipelineFeedbackEntrySchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  rating: z.number().int().min(0).max(5),
  notes: z.string(),
  tableIds: z.array(z.string()),
});

export type PipelineFeedbackEntry = z.infer<typeof PipelineFeedbackEntrySchema>;

export const PipelineFeedbackFileSchema = z.object({
  pipelineId: z.string().min(1),
  dataset: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  entries: z.array(PipelineFeedbackEntrySchema),
});

export type PipelineFeedbackFile = z.infer<typeof PipelineFeedbackFileSchema>;

export const PipelineFeedbackSummarySchema = z.object({
  hasFeedback: z.boolean(),
  entryCount: z.number().int().min(0),
  lastSubmittedAt: z.string(), // '' when absent
  lastRating: z.number().int().min(0).max(5), // 0 when absent
});

export type PipelineFeedbackSummary = z.infer<typeof PipelineFeedbackSummarySchema>;

export const SubmitPipelineFeedbackRequestSchema = z.object({
  rating: z.number().int().min(0).max(5),
  notes: z.string(),
  tableIds: z.array(z.string()),
});

export type SubmitPipelineFeedbackRequest = z.infer<typeof SubmitPipelineFeedbackRequestSchema>;

