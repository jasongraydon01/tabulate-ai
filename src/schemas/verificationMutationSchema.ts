import { z } from 'zod';

export const RowKeySchema = z.object({
  variable: z.string(),
  filterValue: z.string(),
});

export const MetadataPatchSchema = z.object({
  surveySection: z.string(),
  baseText: z.string(),
  userNote: z.string(),
  tableSubtitle: z.string(),
});

export const UpdateLabelMutationSchema = z.object({
  kind: z.literal('update_label'),
  rowKey: RowKeySchema,
  label: z.string(),
  reason: z.string(),
});

export const SetMetadataMutationSchema = z.object({
  kind: z.literal('set_metadata'),
  patch: MetadataPatchSchema,
  reason: z.string(),
});

export const ConceptualNetPositionSchema = z.union([
  z.literal('top'),
  z.literal('bottom'),
  z.object({ afterRowKey: RowKeySchema }),
]);

export const CreateConceptualNetMutationSchema = z.object({
  kind: z.literal('create_conceptual_net'),
  label: z.string(),
  components: z.array(z.string()).min(2),
  position: ConceptualNetPositionSchema,
  reason: z.string(),
});

export const SetExclusionMutationSchema = z.object({
  kind: z.literal('set_exclusion'),
  exclude: z.boolean(),
  excludeReason: z.string(),
  reason: z.string(),
  redundancyEvidence: z.object({
    overlapsWithTableIds: z.array(z.string()),
    sameFilterSignature: z.boolean(),
    dominanceSignal: z.enum(['high', 'medium', 'low']),
  }),
});

export const RequestStructuralOverrideMutationSchema = z.object({
  kind: z.literal('request_structural_override'),
  reason: z.string(),
  requestedAction: z.string(),
});

export const FlagForReviewMutationSchema = z.object({
  kind: z.literal('flag_for_review'),
  reason: z.string(),
  flag: z.string(),
});

export const SetQuestionTextMutationSchema = z.object({
  kind: z.literal('set_question_text'),
  questionText: z.string().min(1),
  reason: z.string(),
});

export const RowFieldsPatchSchema = z.object({
  label: z.string(),
  filterValue: z.string(),
  isNet: z.enum(['true', 'false', '']),
  netComponents: z.array(z.string()),
  indent: z.number().min(-1).max(2),
});

export const UpdateRowFieldsMutationSchema = z.object({
  kind: z.literal('update_row_fields'),
  rowKey: RowKeySchema,
  patch: RowFieldsPatchSchema,
  reason: z.string(),
});

export const DeleteRowMutationSchema = z.object({
  kind: z.literal('delete_row'),
  rowKey: RowKeySchema,
  reason: z.string(),
});

export const CreateSameVariableNetMutationSchema = z.object({
  kind: z.literal('create_same_variable_net'),
  variable: z.string(),
  label: z.string(),
  filterValues: z.array(z.string()).min(2),
  position: ConceptualNetPositionSchema,
  reason: z.string(),
});

export const MutationOpSchema = z.discriminatedUnion('kind', [
  UpdateLabelMutationSchema,
  SetMetadataMutationSchema,
  CreateConceptualNetMutationSchema,
  SetExclusionMutationSchema,
  RequestStructuralOverrideMutationSchema,
  FlagForReviewMutationSchema,
  SetQuestionTextMutationSchema,
  UpdateRowFieldsMutationSchema,
  DeleteRowMutationSchema,
  CreateSameVariableNetMutationSchema,
]);

export const ApplyTableMutationsInputSchema = z.object({
  targetTableId: z.string(),
  tableVersionHash: z.string(),
  operations: z.array(MutationOpSchema),
});

export const VerificationMutationAgentOutputSchema = z.object({
  mutation: ApplyTableMutationsInputSchema,
  changes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  userSummary: z.string(),
});

export const MutationAuditSchema = z.object({
  applied: z.array(z.string()),
  skipped: z.array(z.string()),
  warnings: z.array(z.string()),
  requestedOverrides: z.array(z.string()),
  reviewFlags: z.array(z.string()),
});

export type RowKey = z.infer<typeof RowKeySchema>;
export type MetadataPatch = z.infer<typeof MetadataPatchSchema>;
export type RowFieldsPatch = z.infer<typeof RowFieldsPatchSchema>;
export type MutationOp = z.infer<typeof MutationOpSchema>;
export type ApplyTableMutationsInput = z.infer<typeof ApplyTableMutationsInputSchema>;
export type MutationAudit = z.infer<typeof MutationAuditSchema>;
export type VerificationMutationAgentOutput = z.infer<typeof VerificationMutationAgentOutputSchema>;
