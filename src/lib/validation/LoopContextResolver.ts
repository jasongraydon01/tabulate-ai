/**
 * LoopContextResolver.ts
 *
 * @deprecated This module is deprecated as of 2026-02-14. The deterministic resolver
 * approach created anchor bias in LoopSemanticsPolicyAgent, causing it to trust
 * variable naming patterns over cut structure evidence. The agent now reasons purely
 * from cut structure + datamap descriptions, which is more reliable.
 *
 * Code is kept for now but not used. Can be fully removed in a future cleanup.
 * To revert to the old approach, check out the commit before this deprecation.
 *
 * ---
 *
 * Deterministic resolver for iteration-linked variables in looped survey data.
 * Scans metadata (variable names, labels, descriptions) to identify non-loop columns
 * that are semantically linked to specific loop iterations.
 *
 * NOTE: This provides HIGH-CONFIDENCE HINTS to the LoopSemanticsPolicyAgent, not
 * a validation gate. The agent can and should identify additional variables through
 * semantic reasoning. This resolver catches the obvious cases deterministically;
 * the agent handles the nuanced cases that require context and reasoning.
 *
 * Evidence hierarchy:
 * A0: Variable-name iteration suffixes (e.g., Treatment_1, Treatment_2)
 * A1: Label/description tokens (e.g., ${LOCATION1}, ${LOCATION2} in SPSS labels)
 * A2: Sibling detection — non-loop vars with identical descriptions matching iteration count
 * A3: Cascading — h-prefix/d-prefix variants of confirmed mappings
 *
 * Pure function, no LLM, no I/O.
 */

import type { VerboseDataMap } from '../processors/DataMapProcessor';
import type { LoopGroupMapping } from './LoopCollapser';

// =============================================================================
// Types
// =============================================================================

export interface IterationLinkedVariable {
  /** The variable column name (e.g., "S10a") */
  variableName: string;
  /** Which loop iteration this variable is linked to (e.g., "1") */
  linkedIteration: string;
  /** Which loop group index this is linked to */
  linkedLoopGroup: number;
  /** How the evidence was found (e.g., "label_token:LOCATION1", "variable_suffix:_1") */
  evidenceSource: string;
  /** Confidence in this mapping (0-1) */
  confidence: number;
}

export interface DeterministicResolverResult {
  /** All iteration-linked variables found */
  iterationLinkedVariables: IterationLinkedVariable[];
  /** Human-readable summary for LLM prompt and debugging */
  evidenceSummary: string;
}

// =============================================================================
// Main Entry Point
// =============================================================================

/**
 * Scan metadata to find non-loop variables that are linked to specific loop iterations.
 *
 * @param verboseDataMap - The enriched variable list (after loop collapse)
 * @param loopMappings - Loop group mappings from LoopCollapser
 * @param collapsedVariableNames - Set of original column names that were collapsed (loop vars)
 * @returns Deterministic findings with evidence
 */
export function resolveIterationLinkedVariables(
  verboseDataMap: VerboseDataMap[],
  loopMappings: LoopGroupMapping[],
  collapsedVariableNames: Set<string>,
): DeterministicResolverResult {
  if (loopMappings.length === 0) {
    return { iterationLinkedVariables: [], evidenceSummary: 'No loop groups detected.' };
  }

  // Build lookup: column name → VerboseDataMap entry
  const varByColumn = new Map<string, VerboseDataMap>();
  for (const v of verboseDataMap) {
    varByColumn.set(v.column, v);
  }

  // Non-loop variable columns (candidates for iteration linking)
  const nonLoopVars = verboseDataMap.filter(v => !collapsedVariableNames.has(v.column));

  // Collect findings from all evidence sources
  const findings: IterationLinkedVariable[] = [];
  const foundVars = new Set<string>(); // Prevent duplicates across sources

  // A0: Variable-name iteration suffixes
  const a0Findings = findBySuffixMatch(nonLoopVars, loopMappings, foundVars);
  findings.push(...a0Findings);

  // A1: Label/description token scan
  const a1Findings = findByLabelTokens(nonLoopVars, loopMappings, foundVars);
  findings.push(...a1Findings);

  // A2: Sibling detection (identical descriptions)
  const a2Findings = findBySiblingDetection(nonLoopVars, loopMappings, foundVars);
  findings.push(...a2Findings);

  // A3: Cascading h-prefix/d-prefix variants
  const a3Findings = findByCascading(findings, varByColumn, foundVars);
  findings.push(...a3Findings);

  // Build human-readable summary
  const evidenceSummary = buildEvidenceSummary(findings, loopMappings);

  return { iterationLinkedVariables: findings, evidenceSummary };
}

// =============================================================================
// A0: Variable-name iteration suffixes
// =============================================================================

/**
 * Find non-loop variables whose names end with _N where N is in a loop iteration set.
 * e.g., Treatment_1, Treatment_2 when iterations are ['1', '2']
 */
function findBySuffixMatch(
  nonLoopVars: VerboseDataMap[],
  loopMappings: LoopGroupMapping[],
  foundVars: Set<string>,
): IterationLinkedVariable[] {
  const findings: IterationLinkedVariable[] = [];
  const suffixPattern = /^([A-Za-z][A-Za-z0-9]*)_(\d+)$/;

  for (const v of nonLoopVars) {
    if (foundVars.has(v.column)) continue;

    const match = v.column.match(suffixPattern);
    if (!match) continue;

    const iter = match[2];

    // Check if this iteration value belongs to any loop group
    for (let gi = 0; gi < loopMappings.length; gi++) {
      const group = loopMappings[gi];
      if (group.iterations.includes(iter)) {
        findings.push({
          variableName: v.column,
          linkedIteration: iter,
          linkedLoopGroup: gi,
          evidenceSource: `variable_suffix:_${iter}`,
          confidence: 0.9,
        });
        foundVars.add(v.column);
        break;
      }
    }
  }

  return findings;
}

// =============================================================================
// A1: Label/description token scan
// =============================================================================

/**
 * Scan variable labels/descriptions for iteration-marker tokens.
 * Looks for patterns like ${LOCATION1}, ${Treatment_1}, LOCATION1.r1.val, etc.
 */
function findByLabelTokens(
  nonLoopVars: VerboseDataMap[],
  loopMappings: LoopGroupMapping[],
  foundVars: Set<string>,
): IterationLinkedVariable[] {
  const findings: IterationLinkedVariable[] = [];

  // Build a set of all iteration values across all loop groups
  const iterValues = new Set<string>();
  for (const m of loopMappings) {
    for (const iter of m.iterations) {
      iterValues.add(iter);
    }
  }

  // Token pattern: any identifier followed by an iteration digit
  // Matches: ${LOCATION1}, ${LOCATION2}, LOCATION1.r1.val, Treatment_1, etc.
  const tokenPattern = /([A-Z][A-Z_]*?)(\d+)/gi;

  for (const v of nonLoopVars) {
    if (foundVars.has(v.column)) continue;

    // Search in description and answerOptions
    const textToSearch = `${v.description || ''} ${v.answerOptions || ''}`;
    if (!textToSearch.trim()) continue;

    const matches = [...textToSearch.matchAll(tokenPattern)];
    for (const match of matches) {
      const root = (match[1] || '').toUpperCase();
      const iter = match[2];
      if (!iter || !iterValues.has(iter)) continue;

      // Find which loop group this iteration belongs to
      for (let gi = 0; gi < loopMappings.length; gi++) {
        const group = loopMappings[gi];
        if (group.iterations.includes(iter)) {
          // Avoid matching common non-iteration tokens
          if (isCommonNonIterationToken(root, iter)) continue;

          findings.push({
            variableName: v.column,
            linkedIteration: iter,
            linkedLoopGroup: gi,
            evidenceSource: `label_token:${root}${iter}`,
            confidence: 0.75,
          });
          foundVars.add(v.column);
          break;
        }
      }
      if (foundVars.has(v.column)) break; // Already found for this var
    }
  }

  return findings;
}

/**
 * Filter out common tokens that look like iteration markers but aren't.
 * e.g., "Q1" in "Q1. What is your age?" is a question number, not iteration 1.
 */
function isCommonNonIterationToken(root: string, iter: string): boolean {
  // Question numbers (Q1, Q2, etc.) — too common to be useful
  if (root === 'Q' || root === 'QUESTION') return true;
  // Scale endpoints (1-5, 1-7, etc.)
  if (root === 'SCALE' || root === 'POINT') return true;
  // Page/section numbers
  if (root === 'PAGE' || root === 'P' || root === 'SECTION' || root === 'S') return true;
  // Version markers
  if (root === 'V' || root === 'VERSION') return true;
  // Value labels that happen to end in a number
  if (root === 'VALUE' || root === 'OPTION' || root === 'CHOICE') return true;
  // Very short roots are unreliable
  if (root.length <= 1 && parseInt(iter) > 20) return true;
  return false;
}

// =============================================================================
// A2: Sibling detection
// =============================================================================

/**
 * Find groups of non-loop variables with identical (normalized) descriptions
 * whose count matches the number of loop iterations.
 */
function findBySiblingDetection(
  nonLoopVars: VerboseDataMap[],
  loopMappings: LoopGroupMapping[],
  foundVars: Set<string>,
): IterationLinkedVariable[] {
  const findings: IterationLinkedVariable[] = [];

  // Group non-loop vars by normalized description
  const descGroups = new Map<string, VerboseDataMap[]>();
  for (const v of nonLoopVars) {
    if (foundVars.has(v.column)) continue;
    if (!v.description) continue;

    const key = normalizeDescription(v.description);
    if (!key) continue;

    if (!descGroups.has(key)) {
      descGroups.set(key, []);
    }
    descGroups.get(key)!.push(v);
  }

  // Check each description group against loop iteration counts
  for (const [, group] of descGroups) {
    if (group.length < 2) continue; // Need at least 2 siblings

    for (let gi = 0; gi < loopMappings.length; gi++) {
      const mapping = loopMappings[gi];

      if (group.length !== mapping.iterations.length) continue;

      // Check if any member is already anchored (from A0/A1)
      const anchored = group.filter(v => foundVars.has(v.column));
      if (anchored.length > 0) {
        // Cascade from anchored members to unanchored ones
        // Try to pair unanchored members with remaining iterations
        const usedIters = new Set(
          findings
            .filter(f => group.some(g => g.column === f.variableName) && f.linkedLoopGroup === gi)
            .map(f => f.linkedIteration)
        );
        const remainingIters = mapping.iterations.filter(i => !usedIters.has(i));
        const unanchored = group.filter(v => !foundVars.has(v.column));

        if (unanchored.length === remainingIters.length) {
          // Sort both by column name and iteration for deterministic assignment
          const sortedUnanchored = [...unanchored].sort((a, b) => a.column.localeCompare(b.column));
          const sortedIters = [...remainingIters].sort((a, b) => parseInt(a) - parseInt(b));

          for (let i = 0; i < sortedUnanchored.length; i++) {
            findings.push({
              variableName: sortedUnanchored[i].column,
              linkedIteration: sortedIters[i],
              linkedLoopGroup: gi,
              evidenceSource: `sibling_cascade:${group.map(g => g.column).join(',')}`,
              confidence: 0.7,
            });
            foundVars.add(sortedUnanchored[i].column);
          }
        }
      } else {
        // No anchor — flag as candidates with low confidence
        // Sort by column name for deterministic ordering, pair with sorted iterations
        const sorted = [...group].sort((a, b) => a.column.localeCompare(b.column));
        const sortedIters = [...mapping.iterations].sort((a, b) => parseInt(a) - parseInt(b));

        for (let i = 0; i < sorted.length; i++) {
          findings.push({
            variableName: sorted[i].column,
            linkedIteration: sortedIters[i],
            linkedLoopGroup: gi,
            evidenceSource: `sibling_candidate:${group.map(g => g.column).join(',')}`,
            confidence: 0.5,
          });
          foundVars.add(sorted[i].column);
        }
      }
    }
  }

  return findings;
}

/**
 * Normalize a description for sibling comparison.
 * Strips leading question markers, numbering, whitespace, and case.
 */
function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .replace(/^[a-z0-9_]+\.\s*/i, '') // Strip "Q1. " prefix
    .replace(/\s+/g, ' ')
    .trim();
}

// =============================================================================
// A3: Cascading h-prefix / d-prefix variants
// =============================================================================

/**
 * For every confirmed mapping, check if h-prefix or d-prefix variants exist.
 * e.g., if S10a → iter 1, then hS10a → iter 1 and dS10a → iter 1 (if they exist).
 */
function findByCascading(
  existingFindings: IterationLinkedVariable[],
  varByColumn: Map<string, VerboseDataMap>,
  foundVars: Set<string>,
): IterationLinkedVariable[] {
  const findings: IterationLinkedVariable[] = [];
  const prefixes = ['h', 'd'];

  for (const existing of existingFindings) {
    for (const prefix of prefixes) {
      const candidateName = `${prefix}${existing.variableName}`;
      if (foundVars.has(candidateName)) continue;
      if (!varByColumn.has(candidateName)) continue;

      findings.push({
        variableName: candidateName,
        linkedIteration: existing.linkedIteration,
        linkedLoopGroup: existing.linkedLoopGroup,
        evidenceSource: `cascade_${prefix}prefix:${existing.variableName}`,
        confidence: existing.confidence * 0.9, // Slightly lower than parent
      });
      foundVars.add(candidateName);
    }
  }

  return findings;
}

// =============================================================================
// Evidence Summary Builder
// =============================================================================

/**
 * Build a human-readable summary of all findings, grouped by loop group.
 */
function buildEvidenceSummary(
  findings: IterationLinkedVariable[],
  loopMappings: LoopGroupMapping[],
): string {
  if (findings.length === 0) {
    return 'No iteration-linked variables found via deterministic evidence.';
  }

  const lines: string[] = [];
  lines.push(`Found ${findings.length} iteration-linked variable(s):`);

  // Group by loop group
  for (let gi = 0; gi < loopMappings.length; gi++) {
    const group = loopMappings[gi];
    const groupFindings = findings.filter(f => f.linkedLoopGroup === gi);
    if (groupFindings.length === 0) continue;

    lines.push(`\n  Loop group ${gi + 1} (${group.stackedFrameName}, iterations: ${group.iterations.join(',')}):`);

    for (const f of groupFindings) {
      lines.push(`    ${f.variableName} → iteration ${f.linkedIteration} (${f.evidenceSource}, confidence: ${f.confidence})`);
    }
  }

  return lines.join('\n');
}
