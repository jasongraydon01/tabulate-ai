/**
 * V3 Runtime — Post-R Validation QC (Stage 14)
 *
 * Validation hook that runs after the compute package is assembled (stage 22).
 * Checks the compute output for structural issues before R execution.
 *
 * This stage produces NO chained artifact (V3_STAGE_ARTIFACTS['14'] === null).
 * It serves as a quality gate that catches misconfigurations early.
 *
 * Current validations:
 *   - At least one table present
 *   - At least one cut present (beyond Total)
 *   - Stat testing thresholds are valid (0 < t < 1)
 *   - Cut stat letters are unique
 *   - No empty cut groups
 *
 * Future extensions:
 *   - Post-R output validation (after R execution moves into runtime)
 *   - Cross-reference validation between tables and cuts
 */

import type { PostRQcInput, PostRQcResult } from './types';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';

function validateComputeContexts(
  tables: TableWithLoopFrame[],
  warnings: string[],
  errors: string[],
): void {
  for (const table of tables) {
    const computeContext = table.computeContext;
    if (!computeContext) continue;

    if (
      computeContext.computeRiskSignals.includes('compute-mask-required')
      && computeContext.tableMaskRecipe == null
    ) {
      errors.push(`Table "${table.tableId}" requires a compute mask but has no tableMaskRecipe`);
    }

    if (
      computeContext.referenceUniverse === 'model'
      && computeContext.tableMaskRecipe
      && computeContext.tableMaskRecipe.kind !== 'model'
    ) {
      errors.push(`Model-derived table "${table.tableId}" must not carry a respondent mask recipe`);
    }

    if (
      computeContext.rebasePolicy !== 'none'
      && (
        computeContext.rebaseSourceVariables.length === 0
        || computeContext.rebaseExcludedValues.length === 0
      )
    ) {
      errors.push(`Rebased table "${table.tableId}" is missing rebase exclusion metadata`);
    }

    if (computeContext.referenceBaseN == null && computeContext.itemBaseRange == null) {
      warnings.push(`Table "${table.tableId}" compute context has no audit base counts`);
    }

    for (const row of table.rows) {
      const rowContext = row.computeContext;
      if (!rowContext) continue;

      if (
        (rowContext.aggregationMode === 'any_component_selected'
          || rowContext.aggregationMode === 'row_sum_components')
        && rowContext.componentVariables.length === 0
      ) {
        errors.push(`Table "${table.tableId}" row "${row.label}" is missing NET component variables`);
      }

      if (rowContext.aggregationMode === 'single_variable_value_set' && rowContext.componentValues.length === 0) {
        errors.push(`Table "${table.tableId}" row "${row.label}" is missing component values`);
      }

      if (rowContext.aggregationMode === 'not_answered' && rowContext.universeMode !== 'masked_shared_table_n') {
        errors.push(`Table "${table.tableId}" row "${row.label}" must use masked_shared_table_n`);
      }

      if (
        (rowContext.aggregationMode === 'any_component_selected'
          || rowContext.aggregationMode === 'row_sum_components')
        && rowContext.universeMode !== 'masked_shared_table_n'
      ) {
        errors.push(`Table "${table.tableId}" row "${row.label}" must use masked_shared_table_n`);
      }

      if (
        rowContext.aggregationMode === 'stat_summary'
        && rowContext.universeMode === 'masked_shared_table_n'
      ) {
        warnings.push(`Table "${table.tableId}" row "${row.label}" uses shared-table base for stat summary`);
      }
    }

    const resolvedBaseMode = table.resolvedBaseMode ?? null;
    const resolvedValidation = table.resolvedBaseValidation;
    if (
      resolvedBaseMode
      && !resolvedValidation
    ) {
      errors.push(`Table "${table.tableId}" is missing resolvedBaseValidation metadata`);
    }

    if (
      resolvedValidation?.requiresSharedDisplayedBase
      && computeContext.effectiveBaseMode !== 'table_mask_shared_n'
      && resolvedBaseMode !== 'model_base'
    ) {
      errors.push(`Table "${table.tableId}" violates shared displayed base contract`);
    }

    if (
      resolvedValidation?.substantiveRebasingForbidden
      && computeContext.rebasePolicy !== 'none'
    ) {
      errors.push(`Table "${table.tableId}" still carries a substantive rebase policy`);
    }

    if (
      resolvedValidation?.tautologicalSplitForbidden
      && table.resolvedSplitPolicy === 'required'
    ) {
      errors.push(`Table "${table.tableId}" requests a tautological split`);
    }

    if (
      resolvedValidation?.requiresSharedDisplayedBase
      && /(base varies|rebased|qualified respondents|substantive|\(n\s*varies\))/i.test(table.baseText)
    ) {
      errors.push(`Table "${table.tableId}" uses legacy base text that conflicts with the simplified base contract`);
    }
  }
}

/**
 * Run post-R QC validation on the compute package.
 *
 * @param input Compute package output from stage 22.
 * @returns Validation result with warnings and errors.
 */
export function runPostRQc(input: PostRQcInput): PostRQcResult {
  const warnings: string[] = [];
  const errors: string[] = [];

  const { rScriptInput, cutsSpec } = input;

  // Validate tables
  if (!rScriptInput.tables || rScriptInput.tables.length === 0) {
    errors.push('No tables in compute package');
  }
  if (rScriptInput.tables && rScriptInput.tables.length > 0) {
    validateComputeContexts(rScriptInput.tables, warnings, errors);
  }

  // Validate cuts
  if (!rScriptInput.cuts || rScriptInput.cuts.length === 0) {
    errors.push('No cuts in compute package');
  } else if (rScriptInput.cuts.length === 1) {
    warnings.push('Only Total cut present — no banner columns will be computed');
  }

  // Validate stat testing thresholds
  if (rScriptInput.statTestingConfig) {
    const { thresholds } = rScriptInput.statTestingConfig;
    if (!thresholds || thresholds.length === 0) {
      errors.push('No significance thresholds configured');
    } else {
      for (const t of thresholds) {
        if (t <= 0 || t >= 1) {
          errors.push(`Invalid significance threshold: ${t} (must be 0 < t < 1)`);
        }
      }
    }
  }

  // Validate cut stat letter uniqueness
  if (rScriptInput.cuts && rScriptInput.cuts.length > 0) {
    const letters = rScriptInput.cuts.map(c => c.statLetter);
    const unique = new Set(letters);
    if (unique.size !== letters.length) {
      const duplicates = letters.filter((l, i) => letters.indexOf(l) !== i);
      warnings.push(`Duplicate stat letters detected: ${[...new Set(duplicates)].join(', ')}`);
    }
  }

  // Validate cut groups are non-empty
  if (cutsSpec.groups) {
    for (const group of cutsSpec.groups) {
      if (group.cuts.length === 0) {
        warnings.push(`Empty cut group: "${group.groupName}"`);
      }
    }
  }

  // Log validation results
  if (errors.length > 0) {
    console.warn(`[V3:14] Post-R QC errors: ${errors.join('; ')}`);
  }
  if (warnings.length > 0) {
    console.log(`[V3:14] Post-R QC warnings: ${warnings.join('; ')}`);
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
  };
}
