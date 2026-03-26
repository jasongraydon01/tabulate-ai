import { z } from 'zod';

export const VerificationEditReportSchema = z.object({
  tableId: z.string(),
  familyId: z.string(),
  labelsChanged: z.number(),
  labelsTotal: z.number(),
  structuralMutations: z.array(z.string()),
  netsAdded: z.number(),
  netsRemoved: z.number(),
  exclusionChanged: z.boolean(),
  metadataChanges: z.array(z.string()),
  confidence: z.number(),
  verificationOutcome: z.enum(['confirmed', 'refined', 'passthrough', 'error']),
  operationKindCounts: z.record(z.string(), z.number()),
});

export type VerificationEditReport = z.infer<typeof VerificationEditReportSchema>;
