import { z } from "zod";

const AnalysisRenderDirectiveFocusSchema = z.object({
  rowLabels: z.array(z.string().min(1).max(400)).max(5).optional(),
  rowRefs: z.array(z.string().min(1).max(200)).max(5).optional(),
  groupNames: z.array(z.string().min(1).max(200)).max(3).optional(),
  groupRefs: z.array(z.string().min(1).max(200)).max(3).optional(),
}).strict();

export const AnalysisStructuredAnswerPartSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("text"),
    text: z.string().min(1).max(4000),
  }).strict(),
  z.object({
    type: z.literal("render"),
    tableId: z.string().min(1).max(200),
    focus: AnalysisRenderDirectiveFocusSchema.optional(),
  }).strict(),
  z.object({
    type: z.literal("cite"),
    cellIds: z.array(z.string().min(1).max(400)).min(1).max(8),
  }).strict(),
]);

export const AnalysisStructuredAnswerSchema = z.object({
  parts: z.array(AnalysisStructuredAnswerPartSchema).min(1).max(80),
}).strict();

export type AnalysisStructuredAnswerPart = z.infer<typeof AnalysisStructuredAnswerPartSchema>;
export type AnalysisStructuredAnswer = z.infer<typeof AnalysisStructuredAnswerSchema>;
