/**
 * @deprecated Legacy Review Tables request schema removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not use in new production routes.
 */
import { z } from 'zod';

// --- Phase 1: Exclude/Include ---

export const ExcludeUpdateSchema = z.object({
  tableId: z.string().min(1).max(200),
  exclude: z.boolean(),
  excludeReason: z.string().max(500).optional(),
});

export type ExcludeUpdate = z.infer<typeof ExcludeUpdateSchema>;

export const ExcludeRequestSchema = z.object({
  updates: z.array(ExcludeUpdateSchema).min(1).max(500),
});

export type ExcludeRequest = z.infer<typeof ExcludeRequestSchema>;

// --- Phase 2: Table Regeneration ---

export const RegenerateTableRequestSchema = z.object({
  tableId: z.string().min(1).max(200),
  feedback: z.string().min(1).max(2000),
  includeRelated: z.boolean().optional(),
});

export type RegenerateTableRequest = z.infer<typeof RegenerateTableRequestSchema>;

export const RegenerateRequestSchema = z.object({
  tables: z.array(RegenerateTableRequestSchema).min(1).max(20),
});

export type RegenerateRequest = z.infer<typeof RegenerateRequestSchema>;
