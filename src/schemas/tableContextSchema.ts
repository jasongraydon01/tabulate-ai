/**
 * Table Context schema — Zod output schema for the TableContextAgent (Stage 13e)
 *
 * Defines the structured output for AI review of flagged canonical tables.
 * The agent reviews groups of tables by questionId and refines presentation
 * metadata (subtitles, base descriptions, user notes, row labels) to make
 * each table publication-ready.
 *
 * Azure structured output compliance:
 * - All fields required (no .optional())
 * - No z.any() or z.unknown()
 * - Empty array [] for tables with no row label changes (never undefined)
 */

import { z } from 'zod';

/**
 * A single row label override proposed by the AI.
 * The variable must match a CanonicalRow.variable in the target table.
 */
export const TableContextRowLabelOverrideSchema = z.object({
  /** SPSS column name — must match a CanonicalRow.variable */
  variable: z.string(),
  /** Corrected label text */
  label: z.string(),
  /** Why the label was changed */
  reason: z.string(),
});

export type TableContextRowLabelOverride = z.infer<typeof TableContextRowLabelOverrideSchema>;

/**
 * Result of reviewing a single canonical table.
 */
export const TableContextTableResultSchema = z.object({
  /** Table identifier — must match a CanonicalTable.tableId */
  tableId: z.string(),
  /** Refined or pass-through subtitle from prefill */
  tableSubtitle: z.string(),
  /** User-facing note for the table */
  userNote: z.string(),
  /** Base description text */
  baseText: z.string(),
  /** true → keep prefill as-is, no changes needed */
  noChangesNeeded: z.boolean(),
  /** Audit trail — reasoning for changes or confirmation */
  reasoning: z.string(),
  /** Row label overrides — empty array if no row changes */
  rowLabelOverrides: z.array(TableContextRowLabelOverrideSchema),
});

export type TableContextTableResult = z.infer<typeof TableContextTableResultSchema>;

/**
 * Wrapper output — what the AI returns for a group of tables.
 */
export const TableContextOutputSchema = z.object({
  tables: z.array(TableContextTableResultSchema),
});

export type TableContextOutput = z.infer<typeof TableContextOutputSchema>;
