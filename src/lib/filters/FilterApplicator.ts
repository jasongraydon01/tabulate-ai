/**
 * FilterApplicator
 *
 * Deterministic code that applies pre-computed filters from FilterTranslatorAgent
 * to table definitions. NOT an AI agent — just applies the translations.
 *
 * Logic per table:
 * 1. Look up ALL filters for this table's questionId
 * 2. No filters → pass through unchanged
 * 3. Table-level filter only → set additionalFilter + baseText
 * 4. Row-level split only → create one table per split definition
 * 5. Both table-level + row-level → each split table gets combined filter using &
 */

/**
 * @deprecated Replaced by BaseDirectiveApplicator (src/lib/bases/BaseDirectiveApplicator.ts).
 * Skip logic AI pipeline removed in favor of data-driven base inference.
 * This file is retained for reference only. Do not invoke from active pipeline code.
 */

import type { ExtendedTableDefinition } from '../../schemas/verificationAgentSchema';
import type { FilterTranslationOutput, TableFilter } from '../../schemas/skipLogicSchema';
import type { FilterApplicatorResult } from '../../schemas/skipLogicSchema';
import { validateFilterVariables } from './filterUtils';
import { shouldFlagForReview, getReviewThresholds } from '../review';

/**
 * Apply pre-computed filters to tables.
 *
 * @param tables - Extended table definitions (from TableGenerator → toExtendedTable)
 * @param filters - Translated filter output from FilterTranslatorAgent
 * @param validVariables - Set of valid variable names from datamap
 */
export function applyFilters(
  tables: ExtendedTableDefinition[],
  filters: FilterTranslationOutput,
  validVariables: Set<string>,
): FilterApplicatorResult {
  console.warn('[DEPRECATED] applyFilters() called — this should not be invoked in the active pipeline. Use DeterministicBaseEngine instead.');
  // Build lookup: questionId → filters
  const filtersByQuestion = new Map<string, TableFilter[]>();
  for (const filter of filters.filters) {
    const existing = filtersByQuestion.get(filter.questionId) || [];
    existing.push(filter);
    filtersByQuestion.set(filter.questionId, existing);
  }

  const outputTables: ExtendedTableDefinition[] = [];
  let passCount = 0;
  let filterCount = 0;
  let splitCount = 0;
  let columnSplitCount = 0;
  let reviewRequiredCount = 0;

  for (const table of tables) {
    const questionId = table.questionId;

    // Look up filters for this question
    const questionFilters = filtersByQuestion.get(questionId);

    // No filters → pass through unchanged
    if (!questionFilters || questionFilters.length === 0) {
      outputTables.push(table);
      passCount++;
      continue;
    }

    // Separate filter types
    const tableLevelFilters = questionFilters.filter(f => f.action === 'filter' && f.filterExpression.trim() !== '');
    const rowLevelFilters = questionFilters.filter(f => f.action === 'split' && f.splits.length > 0);
    const columnSplitFilters = questionFilters.filter(f => f.action === 'column-split' && f.columnSplits.length > 0);

    // Track review requirements — derived from confidence threshold + validation
    const filterThreshold = getReviewThresholds().filter;
    const hasReviewRequired = questionFilters.some(f => shouldFlagForReview(f.confidence, filterThreshold));
    if (hasReviewRequired) {
      reviewRequiredCount++;
    }

    // Case: No actionable filters (expressions may have been cleared by validation)
    if (tableLevelFilters.length === 0 && rowLevelFilters.length === 0 && columnSplitFilters.length === 0) {
      // Pass through but flag if review is needed
      outputTables.push({
        ...table,
        filterReviewRequired: hasReviewRequired || table.filterReviewRequired,
      });
      passCount++;
      continue;
    }

    // =====================================================================
    // Compute table-level expression (shared across all layers)
    // =====================================================================
    const tableLevelExpression = tableLevelFilters.length > 0
      ? tableLevelFilters.map(f => f.filterExpression).join(' & ')
      : '';
    const tableLevelBaseText = tableLevelFilters.length > 0
      ? tableLevelFilters.map(f => f.baseText).filter(t => t.trim() !== '').join('; ')
      : '';

    // Validate table-level expression if present
    if (tableLevelExpression) {
      const validation = validateFilterVariables(tableLevelExpression, validVariables);
      if (!validation.valid) {
        console.warn(
          `[FilterApplicator] Skipping invalid table-level filter for ${table.tableId}: ` +
          `variables ${validation.invalidVariables.join(', ')} not found`
        );
        outputTables.push({
          ...table,
          filterReviewRequired: true,
        });
        passCount++;
        continue;
      }
    }

    // =====================================================================
    // Layer 1 — Column split: produce intermediate tables (one per column group)
    // If no column splits, pass through as a single intermediate table.
    // =====================================================================
    interface IntermediateTable {
      table: ExtendedTableDefinition;
      additionalFilter: string;
      baseText: string;
      isColumnSplit: boolean;
    }

    let intermediates: IntermediateTable[];

    if (columnSplitFilters.length > 0) {
      intermediates = [];
      for (const colFilter of columnSplitFilters) {
        for (const colSplit of colFilter.columnSplits) {
          // Find matching rows (columns in the grid) for this column group
          const matchingRows = table.rows.filter(row =>
            colSplit.columnVariables.includes(row.variable)
          );

          // Skip if no matching rows found
          if (matchingRows.length === 0) continue;

          // Column split filter expression — empty means "always shown" (NO additional filter)
          let colExpression = '';
          if (colSplit.filterExpression.trim() !== '') {
            // Validate the column-level expression
            const validation = validateFilterVariables(colSplit.filterExpression, validVariables);
            if (!validation.valid) {
              console.warn(
                `[FilterApplicator] Skipping invalid column-split for ${table.tableId}/${colSplit.splitLabel}: ` +
                `variables ${validation.invalidVariables.join(', ')} not found`
              );
              continue;
            }
            colExpression = colSplit.filterExpression;
          }

          // Combine table-level + column-level expressions
          let combinedExpression: string;
          if (tableLevelExpression && colExpression) {
            combinedExpression = `(${tableLevelExpression}) & (${colExpression})`;
          } else if (tableLevelExpression) {
            combinedExpression = tableLevelExpression;
          } else {
            combinedExpression = colExpression;
          }

          const combinedBaseText = [tableLevelBaseText, colSplit.baseText]
            .filter(t => t.trim() !== '')
            .join('; ');

          const colTableId = `${table.tableId}_${colSplit.splitLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

          intermediates.push({
            table: {
              ...table,
              tableId: colTableId,
              rows: matchingRows,
              splitFromTableId: table.tableId,
              tableSubtitle: colSplit.splitLabel || table.tableSubtitle,
            },
            additionalFilter: combinedExpression,
            baseText: combinedBaseText,
            isColumnSplit: true,
          });
        }
      }
      columnSplitCount++;
    } else {
      // No column splits — single intermediate representing the whole table
      intermediates = [{
        table,
        additionalFilter: tableLevelExpression,
        baseText: tableLevelBaseText,
        isColumnSplit: false,
      }];
    }

    // =====================================================================
    // Layer 2 — Row split: for each intermediate table, apply row splits.
    // If no row splits, output the intermediate tables directly.
    // =====================================================================
    if (rowLevelFilters.length > 0) {
      for (const intermediate of intermediates) {
        for (const rowFilter of rowLevelFilters) {
          for (const split of rowFilter.splits) {
            // Skip splits with empty expressions (cleared by validation)
            if (split.filterExpression.trim() === '') continue;

            // Find matching rows in the intermediate table
            const matchingRows = intermediate.table.rows.filter(row =>
              split.rowVariables.includes(row.variable)
            );

            // Skip if no matching rows found
            if (matchingRows.length === 0) continue;

            // Combine intermediate filter + row-split expression
            const combinedExpression = intermediate.additionalFilter
              ? `(${intermediate.additionalFilter}) & (${split.filterExpression})`
              : split.filterExpression;

            // Final validation
            const validation = validateFilterVariables(combinedExpression, validVariables);
            if (!validation.valid) {
              console.warn(
                `[FilterApplicator] Skipping invalid split for ${intermediate.table.tableId}/${split.splitLabel}: ` +
                `variables ${validation.invalidVariables.join(', ')} not found`
              );
              continue;
            }

            const splitTableId = `${intermediate.table.tableId}_${split.splitLabel.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`;

            outputTables.push({
              ...intermediate.table,
              tableId: splitTableId,
              rows: matchingRows,
              additionalFilter: combinedExpression,
              baseText: [intermediate.baseText, split.baseText]
                .filter(t => t.trim() !== '').join('; '),
              splitFromTableId: intermediate.isColumnSplit ? intermediate.table.splitFromTableId : intermediate.table.tableId,
              tableSubtitle: split.splitLabel || intermediate.table.tableSubtitle,
              filterReviewRequired: hasReviewRequired,
              lastModifiedBy: 'FilterApplicator',
            });
          }
        }
      }

      splitCount++;
      continue;
    }

    // No row splits — output intermediate tables directly
    if (columnSplitFilters.length > 0 || tableLevelFilters.length > 0) {
      for (const intermediate of intermediates) {
        outputTables.push({
          ...intermediate.table,
          additionalFilter: intermediate.additionalFilter || '',
          baseText: intermediate.baseText || intermediate.table.baseText,
          filterReviewRequired: hasReviewRequired,
          lastModifiedBy: 'FilterApplicator',
        });
      }
      if (columnSplitFilters.length === 0) {
        filterCount++;
      }
      continue;
    }
  }

  console.log(
    `[FilterApplicator] Applied filters: ${tables.length} input → ${outputTables.length} output tables ` +
    `(pass: ${passCount}, filter: ${filterCount}, split: ${splitCount}, colSplit: ${columnSplitCount}, review: ${reviewRequiredCount})`
  );

  return {
    tables: outputTables,
    summary: {
      totalInputTables: tables.length,
      totalOutputTables: outputTables.length,
      passCount,
      filterCount,
      splitCount,
      columnSplitCount,
      reviewRequiredCount,
    },
  };
}
