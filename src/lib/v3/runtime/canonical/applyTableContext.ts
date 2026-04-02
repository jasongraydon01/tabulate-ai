/**
 * V3 Runtime — Apply Table Context Results (Stage 13e)
 *
 * Pure function that applies AI output from the TableContextAgent
 * to canonical tables. Updates presentation metadata (subtitles, base text,
 * user notes, row labels) and maintains provenance.
 *
 * No AI calls, no file I/O — pure transformation.
 */

import type { CanonicalTableOutput, CanonicalTable } from './types';
import type { TableContextOutput, TableContextTableResult } from '../../../../schemas/tableContextSchema';

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Apply AI table context results to canonical tables.
 *
 * @param canonicalOutput - The enriched canonical output (post-prefill)
 * @param aiResults - Array of AI results (one per group/chunk call)
 * @returns New CanonicalTableOutput with updated tables array
 */
export function applyTableContextResults(
  canonicalOutput: CanonicalTableOutput,
  aiResults: TableContextOutput[],
): CanonicalTableOutput {
  // Flatten all AI results into a lookup by tableId
  const resultsByTableId = new Map<string, TableContextTableResult>();
  for (const result of aiResults) {
    for (const tableResult of result.tables) {
      resultsByTableId.set(tableResult.tableId, tableResult);
    }
  }

  // Validate all tableIds exist in canonical tables
  const canonicalTableIds = new Set(canonicalOutput.tables.map(t => t.tableId));
  for (const tableId of resultsByTableId.keys()) {
    if (!canonicalTableIds.has(tableId)) {
      console.warn(`[applyTableContext] Unknown tableId "${tableId}" in AI results — skipping`);
    }
  }

  // Apply results to tables
  const updatedTables = canonicalOutput.tables.map(table => {
    const aiResult = resultsByTableId.get(table.tableId);
    if (!aiResult) return table;
    if (aiResult.noChangesNeeded) return table;

    return applyToTable(table, aiResult);
  });

  // BaseText consistency post-processing
  const finalTables = enforceBaseTextConsistency(updatedTables, resultsByTableId);

  return {
    ...canonicalOutput,
    tables: finalTables,
  };
}

// =============================================================================
// Per-Table Application
// =============================================================================

function applyToTable(
  table: CanonicalTable,
  aiResult: TableContextTableResult,
): CanonicalTable {
  const updated = { ...table };

  // Update metadata fields (only if AI returned non-empty string)
  if (aiResult.tableSubtitle && shouldApplySubtitleOverride(table, aiResult.tableSubtitle)) {
    updated.tableSubtitle = aiResult.tableSubtitle;
  }
  if (aiResult.baseText && shouldApplyBaseTextOverride(aiResult.baseText)) {
    updated.baseText = aiResult.baseText;
  }
  if (aiResult.userNote) {
    updated.userNote = aiResult.userNote;
  }

  // Apply row label overrides
  if (aiResult.rowLabelOverrides.length > 0) {
    updated.rows = table.rows.map(row => {
      const override = aiResult.rowLabelOverrides.find(o => o.variable === row.variable);
      if (!override) return row;
      return { ...row, label: override.label };
    });

    // Warn about overrides that didn't match any row
    const rowVariables = new Set(table.rows.map(r => r.variable));
    for (const override of aiResult.rowLabelOverrides) {
      if (!rowVariables.has(override.variable)) {
        console.warn(
          `[applyTableContext] Row label override for variable "${override.variable}" ` +
          `not found in table "${table.tableId}" — skipping`,
        );
      }
    }
  }

  updated.lastModifiedBy = 'TableContextAgent';

  return updated;
}

function shouldApplyBaseTextOverride(suggestedBaseText: string): boolean {
  return !/(base varies|rebased|qualified respondents|substantive|\(n\s*varies\))/i.test(
    suggestedBaseText,
  );
}

function shouldApplySubtitleOverride(table: CanonicalTable, suggestedSubtitle: string): boolean {
  const currentSubtitle = table.tableSubtitle.trim();
  const nextSubtitle = suggestedSubtitle.trim();
  if (!nextSubtitle) return false;

  const isRankingOverviewTable =
    table.tableKind === 'ranking_overview_rank' || table.tableKind === 'ranking_overview_topk';
  if (!isRankingOverviewTable) return true;

  const currentLower = currentSubtitle.toLowerCase();
  const nextLower = nextSubtitle.toLowerCase();
  const currentHasRankingContext = currentLower.includes('summary')
    || currentLower.includes('ranked ')
    || currentLower.includes('top ');
  const nextHasRankingContext = nextLower.includes('summary')
    || nextLower.includes('ranked ')
    || nextLower.includes('top ');

  if (currentHasRankingContext && !nextHasRankingContext) {
    return false;
  }

  const currentHasSetContext = currentLower.includes('set ');
  const nextHasSetContext = nextLower.includes('set ');
  if (currentHasSetContext && !nextHasSetContext) {
    return false;
  }

  return true;
}

// =============================================================================
// BaseText Consistency Post-Processing
// =============================================================================

/**
 * Group tables by questionId + disclosure scope. If AI set baseText on some
 * but not others in the same group, propagate the most common AI-set baseText
 * to the remaining tables in that exact scope only.
 */
function enforceBaseTextConsistency(
  tables: CanonicalTable[],
  resultsByTableId: Map<string, TableContextTableResult>,
): CanonicalTable[] {
  // Group tables by shared disclosure scope so AI wording does not flatten
  // anchor/precision or differing base disclosure variants onto each other.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < tables.length; i++) {
    const t = tables[i];
    const rangeKey = t.baseDisclosure?.rangeDisclosure
      ? `${t.baseDisclosure.rangeDisclosure.min}-${t.baseDisclosure.rangeDisclosure.max}`
      : 'none';
    const key = [
      t.questionId,
      t.basePolicy,
      t.baseViewRole ?? 'na',
      t.baseDisclosure?.source ?? 'na',
      String(t.baseDisclosure?.referenceBaseN ?? 'na'),
      rangeKey,
      t.baseDisclosure?.defaultBaseText ?? 'na',
      t.binarySide ?? 'na', // Phase F: prevent cross-side baseText flattening
    ].join('||');
    const indices = groups.get(key) ?? [];
    indices.push(i);
    groups.set(key, indices);
  }

  const result = [...tables];

  for (const indices of groups.values()) {
    if (indices.length <= 1) continue;

    // Count AI-set baseText values in this group
    const baseTextCounts = new Map<string, number>();
    for (const idx of indices) {
      const aiResult = resultsByTableId.get(result[idx].tableId);
      if (
        aiResult
        && !aiResult.noChangesNeeded
        && aiResult.baseText
        && shouldApplyBaseTextOverride(aiResult.baseText)
      ) {
        const count = baseTextCounts.get(aiResult.baseText) ?? 0;
        baseTextCounts.set(aiResult.baseText, count + 1);
      }
    }

    if (baseTextCounts.size === 0) continue;

    // Find the most common AI-set baseText
    let mostCommonBaseText = '';
    let maxCount = 0;
    for (const [text, count] of baseTextCounts.entries()) {
      if (count > maxCount) {
        mostCommonBaseText = text;
        maxCount = count;
      }
    }

    // Propagate to tables in the group that weren't explicitly set by AI
    for (const idx of indices) {
      const aiResult = resultsByTableId.get(result[idx].tableId);
      const wasSetByAI = Boolean(
        aiResult
        && !aiResult.noChangesNeeded
        && aiResult.baseText
        && shouldApplyBaseTextOverride(aiResult.baseText),
      );
      if (!wasSetByAI && result[idx].baseText !== mostCommonBaseText) {
        result[idx] = {
          ...result[idx],
          baseText: mostCommonBaseText,
          lastModifiedBy: 'TableContextAgent',
        };
      }
    }
  }

  return result;
}
