/**
 * NET Enrichment schema — Zod output schema for the NETEnrichmentAgent (Stage 13e)
 *
 * Defines the structured output for AI review of standard frequency tables
 * to propose meaningful NET (roll-up) groupings. The agent reviews one table
 * at a time and returns netting instructions; the deterministic apply step
 * builds the companion table.
 *
 * Azure structured output compliance:
 * - All fields required (no .optional())
 * - No z.any() or z.unknown()
 * - Empty array [] for tables with no NETs (never undefined)
 * - Empty string "" for unused text fields (never undefined)
 */

import { z } from 'zod';

/**
 * A single NET group proposed by the AI.
 * Components reference variable names from the source table's rows.
 */
export const NetGroupSchema = z.object({
  /** Display label for the NET row (e.g., "Specialists (NET)") */
  netLabel: z.string(),
  /**
   * Components to include in this NET.
   * Usually variable names (e.g., ["Q12_1", "Q12_2"]).
   * For same-variable tables, filter-value tokens are also accepted
   * (e.g., ["1", "2"] or ["Q8:1", "Q8:2"]).
   */
  components: z.array(z.string()),
  /** Why this grouping makes analytical sense */
  reasoning: z.string(),
});

export type NetGroup = z.infer<typeof NetGroupSchema>;

/**
 * Result of reviewing a single canonical table for NET opportunities.
 */
export const NetEnrichmentResultSchema = z.object({
  /** Table identifier — must match a CanonicalTable.tableId */
  tableId: z.string(),
  /** true → this table doesn't benefit from NETs */
  noNetsNeeded: z.boolean(),
  /** Overall reasoning (especially important when noNetsNeeded=true) */
  reasoning: z.string(),
  /** Subtitle for the companion table (e.g., "NET Summary") — empty string if noNetsNeeded */
  suggestedSubtitle: z.string(),
  /** NET groups — empty array when noNetsNeeded=true */
  nets: z.array(NetGroupSchema),
});

export type NetEnrichmentResult = z.infer<typeof NetEnrichmentResultSchema>;

/**
 * Wrapper output — Azure structured output requires a top-level object.
 */
export const NetEnrichmentOutputSchema = z.object({
  result: NetEnrichmentResultSchema,
});

export type NetEnrichmentOutput = z.infer<typeof NetEnrichmentOutputSchema>;
