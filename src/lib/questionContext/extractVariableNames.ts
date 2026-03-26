/**
 * Extract variable names from R expressions.
 *
 * Shared utility used by:
 * - buildLoopSemanticsExcerpt (questionContext adapter)
 * - buildDatamapExcerpt (deprecated, in LoopSemanticsPolicyAgent)
 */

const R_KEYWORDS = new Set([
  'TRUE', 'FALSE', 'NA', 'NULL', 'Inf', 'NaN',
  'if', 'else', 'for', 'in', 'while', 'repeat', 'next', 'break',
  'function', 'return', 'c', 'rep', 'nrow', 'ncol',
  'with', 'data', 'eval', 'parse', 'text',
  'is', 'na', 'as', 'numeric', 'character', 'logical',
  'sum', 'mean', 'max', 'min', 'length',
]);

const R_FUNCTIONS = new Set(['grepl', 'nchar', 'paste', 'paste0']);

/**
 * Extract variable names from an R expression.
 * Finds word-boundary identifiers that look like SPSS variable names,
 * excluding R keywords and functions.
 */
export function extractVariableNames(rExpression: string): string[] {
  // Match word-boundary identifiers (but not numbers, not inside strings)
  const matches = rExpression.match(/\b([A-Za-z][A-Za-z0-9_.]*)\b/g) || [];

  const vars = new Set<string>();
  for (const m of matches) {
    // Skip R keywords, operators, and functions
    if (R_KEYWORDS.has(m)) continue;
    // Skip pure numbers
    if (/^\d+$/.test(m)) continue;
    // Skip common R functions
    if (R_FUNCTIONS.has(m)) continue;
    vars.add(m);
  }

  return [...vars];
}
