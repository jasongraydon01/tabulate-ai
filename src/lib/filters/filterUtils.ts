/**
 * Shared filter utilities
 *
 * Used by:
 * - FilterTranslatorAgent (validating translated expressions)
 * - FilterApplicator (validating before applying)
 */

import type { VerboseDataMapType } from '../../schemas/processingSchemas';

/**
 * @deprecated Replaced by DeterministicBaseEngine. Filter agents no longer need full datamap context.
 *
 * Format the full datamap as context for an agent.
 *
 * We provide the ENTIRE datamap (not just table-specific variables) because:
 * - Skip/show logic often references RELATED variables (e.g., Q8 usage counts when processing Q10 follow-ups)
 * - The agent needs to verify that filter variables exist before using them
 * - Per-row logic like "ONLY SHOW [ITEM] WHERE usage > 0" requires seeing all related variables
 */
export function formatFullDatamapContext(verboseDataMap: VerboseDataMapType[]): string {
  if (verboseDataMap.length === 0) {
    return 'No datamap context available';
  }

  const entries: string[] = [];
  for (const entry of verboseDataMap) {
    entries.push(
      `${entry.column}:
  Description: ${entry.description}
  Type: ${entry.normalizedType || 'unknown'}
  Values: ${entry.valueType}
  ${entry.scaleLabels ? `Scale Labels: ${JSON.stringify(entry.scaleLabels)}` : ''}
  ${entry.allowedValues ? `Allowed Values: ${entry.allowedValues.join(', ')}` : ''}`
    );
  }

  return entries.join('\n\n');
}

/**
 * Extract variable names from an R filter expression.
 * Handles expressions like "A3r2 > 0", "Q5 == 1 & Q6 > 0", "A3ar1c2 > 0 | A3ar2c2 > 0"
 */
export function extractVariablesFromFilter(filterExpr: string): string[] {
  if (!filterExpr || filterExpr.trim() === '') {
    return [];
  }

  // Remove R operators, numbers, parentheses, and quotes
  // Match potential variable names (alphanumeric with underscores)
  const cleaned = filterExpr
    .replace(/[=!<>&|()%]/g, ' ')  // Replace operators
    .replace(/\bin\b/g, ' ')       // Remove 'in' keyword
    .replace(/\bc\b/g, ' ')        // Remove 'c' function
    .replace(/\bis\.na\b/g, ' ')   // Remove is.na
    .replace(/\bTRUE\b/gi, ' ')    // Remove TRUE
    .replace(/\bFALSE\b/gi, ' ')   // Remove FALSE
    .replace(/"[^"]*"/g, ' ')      // Remove quoted strings
    .replace(/'[^']*'/g, ' ')      // Remove single-quoted strings
    .replace(/\b\d+\.?\d*\b/g, ' '); // Remove numbers

  // Extract words that look like variable names
  const matches = cleaned.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) || [];

  // Deduplicate
  return [...new Set(matches)];
}

/**
 * @deprecated Replaced by DeterministicBaseEngine. Filter validation is now handled deterministically.
 *
 * Validate that all variables in a filter expression exist in the datamap.
 * Returns validation result with any invalid variables found.
 */
export function validateFilterVariables(
  filterExpr: string,
  validVariables: Set<string>
): { valid: boolean; invalidVariables: string[] } {
  const usedVariables = extractVariablesFromFilter(filterExpr);
  const invalidVariables = usedVariables.filter(v => !validVariables.has(v));

  return {
    valid: invalidVariables.length === 0,
    invalidVariables,
  };
}
