/**
 * Transform Stacked Cuts
 *
 * Deterministic expression transformation for entity-anchored banner groups.
 * Replaces iteration-linked variable references in R expressions with alias column names,
 * then deduplicates OR branches that become identical after replacement.
 *
 * Pure function, no I/O.
 */

/**
 * Transform an R expression to use an alias column instead of per-iteration variables.
 *
 * Algorithm:
 * 1. Word-boundary match each source variable in the expression
 * 2. If none match, return unchanged (respondent-anchored cut)
 * 3. Replace each source variable name with alias name
 * 4. Deduplicate OR branches (split on ` | `, trim, dedup, rejoin)
 * 5. Clean up unnecessary outer parens from single-branch result
 *
 * @param rExpression - The original R filter expression (e.g., "(S10a == 1 | S11a == 1)")
 * @param sourceVariables - The per-iteration source variable names (e.g., ["S10a", "S11a"])
 * @param aliasName - The alias column name (e.g., ".hawktab_needs_state")
 * @returns The transformed expression, or unchanged if no source variables are referenced
 *
 * @example
 * transformCutForAlias("(S10a == 1 | S11a == 1)", ["S10a", "S11a"], ".hawktab_ns")
 * // => ".hawktab_ns == 1"
 *
 * @example
 * transformCutForAlias("S10a %in% c(1,2) | S11a %in% c(1,2)", ["S10a", "S11a"], ".hawktab_ns")
 * // => ".hawktab_ns %in% c(1,2)"
 *
 * @example
 * transformCutForAlias("(S10a == 1 | S11a == 1) & S6 == 1", ["S10a", "S11a"], ".hawktab_ns")
 * // => ".hawktab_ns == 1 & S6 == 1"
 *
 * @example
 * transformCutForAlias("S9r1 == 1", ["S10a", "S11a"], ".hawktab_ns")
 * // => "S9r1 == 1" (unchanged — no source variables referenced)
 */
export function transformCutForAlias(
  rExpression: string,
  sourceVariables: string[],
  aliasName: string,
): string {
  if (!rExpression || sourceVariables.length === 0 || !aliasName) {
    return rExpression;
  }

  // Step 1: Check if ANY source variable is referenced
  const hasAnySource = sourceVariables.some(v => {
    const regex = new RegExp(`\\b${escapeRegex(v)}\\b`);
    return regex.test(rExpression);
  });

  if (!hasAnySource) {
    return rExpression; // No transformation needed
  }

  // Step 2: Replace each source variable with alias name
  let transformed = rExpression;
  for (const sourceVar of sourceVariables) {
    const regex = new RegExp(`\\b${escapeRegex(sourceVar)}\\b`, 'g');
    transformed = transformed.replace(regex, aliasName);
  }

  // Step 3: Clean up unnecessary outer parens BEFORE dedup
  // This ensures that expressions like "(.hawktab_ns == 1 | .hawktab_ns == 1)"
  // have their outer parens stripped so the | is at depth 0 for splitting
  transformed = cleanOuterParens(transformed);

  // Step 4: Deduplicate OR branches
  // Split on top-level ` | ` (not inside parens), trim, dedup, rejoin
  transformed = deduplicateOrBranches(transformed);

  return transformed;
}

/**
 * Deduplicate OR branches that become identical after variable replacement.
 *
 * First tries splitting at the top level. If that yields only 1 branch
 * (the whole expression is wrapped in parens), it also processes
 * parenthesized sub-groups that contain ` | `.
 */
function deduplicateOrBranches(expr: string): string {
  // Try top-level split first
  const branches = splitTopLevelOr(expr);

  if (branches.length > 1) {
    // Deduplicate top-level branches
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const branch of branches) {
      const trimmed = branch.trim();
      if (trimmed && !seen.has(trimmed)) {
        seen.add(trimmed);
        unique.push(trimmed);
      }
    }

    if (unique.length < branches.length) {
      return unique.join(' | ');
    }
    return expr; // No duplicates found
  }

  // If top-level split yielded only 1 branch, look for parenthesized OR groups
  // and deduplicate within them. e.g., "(.hawktab == 1 | .hawktab == 1) & S6 == 1"
  return deduplicateParenGroups(expr);
}

/**
 * Find parenthesized groups containing ` | `, deduplicate branches within them,
 * and replace the group with the deduplicated result.
 */
function deduplicateParenGroups(expr: string): string {
  let result = '';
  let i = 0;

  while (i < expr.length) {
    if (expr[i] === '(') {
      // Find the matching closing paren
      let depth = 1;
      let j = i + 1;
      while (j < expr.length && depth > 0) {
        if (expr[j] === '(') depth++;
        else if (expr[j] === ')') depth--;
        j++;
      }

      // Extract the inner content (without parens)
      const inner = expr.slice(i + 1, j - 1);

      // Try to split and dedup the inner content
      const innerBranches = splitTopLevelOr(inner);
      if (innerBranches.length > 1) {
        const seen = new Set<string>();
        const unique: string[] = [];
        for (const branch of innerBranches) {
          const trimmed = branch.trim();
          if (trimmed && !seen.has(trimmed)) {
            seen.add(trimmed);
            unique.push(trimmed);
          }
        }

        if (unique.length < innerBranches.length) {
          // Deduplication happened — if single branch remains, no parens needed
          if (unique.length === 1) {
            result += unique[0];
          } else {
            result += '(' + unique.join(' | ') + ')';
          }
          i = j;
          continue;
        }
      }

      // No dedup possible, keep as-is
      result += expr.slice(i, j);
      i = j;
    } else {
      result += expr[i];
      i++;
    }
  }

  return result;
}

/**
 * Split an expression on top-level ` | ` operators, respecting parenthesis nesting.
 */
function splitTopLevelOr(expr: string): string[] {
  const branches: string[] = [];
  let depth = 0;
  let current = '';

  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];

    if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (depth === 0 && ch === '|' && expr[i - 1] === ' ' && expr[i + 1] === ' ') {
      branches.push(current);
      current = '';
      i++; // skip the space after |
    } else {
      current += ch;
    }
  }

  if (current) {
    branches.push(current);
  }

  return branches;
}

/**
 * Remove unnecessary outer parentheses when only a single branch remains.
 *
 * e.g., "(.hawktab_ns == 1)" → ".hawktab_ns == 1"
 * But keeps: "(.hawktab_ns == 1) & S6 == 1" unchanged
 */
function cleanOuterParens(expr: string): string {
  const trimmed = expr.trim();

  if (!trimmed.startsWith('(') || !trimmed.endsWith(')')) {
    return trimmed;
  }

  // Check if the outermost parens wrap the ENTIRE expression
  let depth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === '(') depth++;
    else if (trimmed[i] === ')') depth--;

    // If we return to depth 0 before the end, parens don't wrap the whole thing
    if (depth === 0 && i < trimmed.length - 1) {
      return trimmed;
    }
  }

  // Parens wrap the entire expression — remove them
  return trimmed.slice(1, -1).trim();
}

/**
 * Escape special regex characters in a string
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Validate transformed cuts for an entity-anchored group.
 *
 * CRITICAL SAFETY CHECK: If multiple cuts in a group produce identical transformed
 * expressions, this indicates the transformation is not suitable for entity-anchored
 * classification. This typically happens when:
 * - Cuts reference different variables (e.g., hLOCATIONr1, hLOCATIONr2)
 * - But both check the same value (e.g., both == 1)
 * - After transformation, both become the same expression (e.g., .hawktab_location_flag == 1)
 *
 * When duplicates are detected, the group should fall back to respondent-anchored
 * classification (use original cuts without transformation).
 *
 * @param transformedExpressions - Array of transformed R expressions for cuts in a group
 * @param groupName - Name of the banner group (for logging)
 * @returns Object with hasDuplicates flag and duplicate expressions if found
 *
 * @example
 * validateTransformedCuts(
 *   [".hawktab_location_flag == 1", ".hawktab_location_flag == 1", ".hawktab_location_flag == 3"],
 *   "Location"
 * )
 * // => { hasDuplicates: true, duplicates: [".hawktab_location_flag == 1"] }
 *
 * @example
 * validateTransformedCuts(
 *   [".hawktab_needs_state == 1", ".hawktab_needs_state == 2", ".hawktab_needs_state == 3"],
 *   "Needs State"
 * )
 * // => { hasDuplicates: false, duplicates: [] }
 */
export function validateTransformedCuts(
  transformedExpressions: string[],
  groupName: string,
): { hasDuplicates: boolean; duplicates: string[] } {
  const seen = new Map<string, number>(); // expression → count
  const duplicates = new Set<string>();

  for (const expr of transformedExpressions) {
    const normalized = expr.trim();
    const count = seen.get(normalized) || 0;
    seen.set(normalized, count + 1);

    if (count > 0) {
      duplicates.add(normalized);
    }
  }

  const hasDuplicates = duplicates.size > 0;

  if (hasDuplicates) {
    console.warn(
      `[transformStackedCuts] Group "${groupName}" has ${duplicates.size} duplicate transformed expression(s): ` +
      `${Array.from(duplicates).join(', ')}. This indicates the cuts are not suitable for entity-anchored ` +
      `transformation. Group should fall back to respondent-anchored.`
    );
  }

  return {
    hasDuplicates,
    duplicates: Array.from(duplicates),
  };
}
