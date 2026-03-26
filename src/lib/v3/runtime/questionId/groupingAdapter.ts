/**
 * V3 Runtime Grouping Adapter — Transitional Wrapper
 *
 * ⚠️  TRANSITIONAL: This adapter exists for step-00 parity during the V3
 *     runtime migration. It is the SINGLE allowed runtime touchpoint for
 *     the legacy DataMapGrouper. Direct imports of DataMapGrouper from
 *     runtime code outside this file are prohibited.
 *
 *     This file will be removed in Phase 6 when a V3-native grouper
 *     replaces DataMapGrouper entirely.
 *     See: docs/v3-runtime-architecture-refactor-plan.md (Phase 6)
 *
 * Why this exists:
 *   Step 00 (question-id-enricher) needs grouping to seed question IDs.
 *   The legacy DataMapGrouper carries regroup config, admin filtering, and
 *   table-generation concerns that don't belong in the enrichment chain.
 *   This adapter constrains the surface area so the migration can proceed
 *   without a full grouper rewrite up front.
 */

import {
  groupDataMapDetailed,
  type DataMapGrouperOptions,
  type GroupDataMapDetailedResult,
  type QuestionGroup,
  type RegroupDecisionReport,
} from '../../../tables/DataMapGrouper';
import type { VerboseDataMapType } from '../../../../schemas/processingSchemas';

/**
 * Groups verbose datamap variables into question IDs for V3 step 00.
 *
 * This is a thin pass-through to the legacy DataMapGrouper with no
 * behavioral changes. The intent is to centralize the import so that
 * when the V3-native grouper is ready, only this file needs to change.
 *
 * @param dataMap - Verbose datamap from .sav extraction
 * @param options - Grouping options (open-ends, admin, regrouping overrides)
 * @returns Grouped question data with optional regroup report
 *
 * @deprecated Transitional adapter — will be replaced by V3-native grouper in Phase 6.
 */
export function groupDataMapForQuestionId(
  dataMap: VerboseDataMapType[],
  options?: DataMapGrouperOptions,
): GroupDataMapDetailedResult {
  return groupDataMapDetailed(dataMap, options);
}

// Re-export types that downstream code may need
export type {
  QuestionGroup,
  DataMapGrouperOptions,
  GroupDataMapDetailedResult,
  RegroupDecisionReport,
};
