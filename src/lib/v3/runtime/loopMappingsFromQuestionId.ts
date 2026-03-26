/**
 * V3-Native Loop Mapping Derivation
 *
 * Converts V3 per-entry loop metadata (from enrichment chain stages 00/10a)
 * into LoopGroupMapping[] format required by R script generation.
 *
 * This replaces the legacy LoopDetector → LoopCollapser flow. V3 handles
 * loop classification at the question-ID level (family grouping + AI gate),
 * which is more accurate than the legacy skeleton-based pattern matching.
 * This function bridges V3's richer loop representation to the downstream
 * R stacking format.
 *
 * Phase 6a: Created to eliminate legacy loop detection from PipelineRunner.
 */

import type { QuestionIdEntry } from './questionId/types';
import type { LoopGroupMapping, LoopVariableMapping } from '@/lib/validation/LoopCollapser';
import fs from 'fs/promises';
import path from 'path';

// =============================================================================
// Types
// =============================================================================

/** Result of deriving loop mappings from V3 question-ID entries. */
export interface LoopMappingDerivationResult {
  /** Loop group mappings for R script generation */
  loopMappings: LoopGroupMapping[];
  /** Set of original column names that belong to non-first iterations (for LoopContextResolver) */
  collapsedVariableNames: Set<string>;
  /** Lookup: base variable name → index into loopMappings array */
  baseNameToLoopIndex: Map<string, number>;
  /** Whether any loops were detected */
  hasLoops: boolean;
  /** Diagnostic summary */
  summary: string;
}

export async function persistLoopSummaryArtifact(
  outputDir: string,
  derivation: LoopMappingDerivationResult,
): Promise<void> {
  const loopSummaryDir = path.join(outputDir, 'enrichment');
  await fs.mkdir(loopSummaryDir, { recursive: true });
  await fs.writeFile(
    path.join(loopSummaryDir, 'loop-summary.json'),
    JSON.stringify({
      source: 'v3-derived',
      totalLoopGroups: derivation.loopMappings.length,
      totalIterationVars: derivation.collapsedVariableNames.size,
      totalBaseVars: derivation.loopMappings.reduce((sum, mapping) => sum + mapping.variables.length, 0),
      groups: derivation.loopMappings.map(mapping => ({
        stackedFrameName: mapping.stackedFrameName,
        skeleton: mapping.skeleton,
        iterations: mapping.iterations,
        variableCount: mapping.variables.length,
        variables: mapping.variables.map(variable => ({
          baseName: variable.baseName,
          label: variable.label,
          iterationColumns: variable.iterationColumns,
        })),
      })),
    }, null, 2),
    'utf-8',
  );
}

// =============================================================================
// Core Conversion
// =============================================================================

/**
 * Derive LoopGroupMapping[] from V3 question-ID entries.
 *
 * How it works:
 * 1. Find all entries with `loop.detected === true`
 * 2. Group them by `loop.familyBase` (each family = one loop group)
 * 3. Sort members within each family by `loop.iterationIndex`
 * 4. Align items across iterations to build per-variable column mappings
 * 5. Produce LoopGroupMapping with stackedFrameName, iterations, variables
 *
 * The items within each entry provide the actual .sav column names. By
 * aligning items at the same position across iterations, we reconstruct
 * the iterationColumns mapping that R needs for stacking.
 */
export function deriveLoopMappings(
  entries: QuestionIdEntry[],
): LoopMappingDerivationResult {
  // Step 1: Find all loop-detected entries
  const loopEntries = entries.filter(
    e => e.loop?.detected === true && e.loopQuestionId !== null,
  );

  if (loopEntries.length === 0) {
    return {
      loopMappings: [],
      collapsedVariableNames: new Set(),
      baseNameToLoopIndex: new Map(),
      hasLoops: false,
      summary: 'No loop groups detected in V3 entries.',
    };
  }

  // Step 2: Group by familyBase
  const familyMap = new Map<string, QuestionIdEntry[]>();
  for (const entry of loopEntries) {
    const base = entry.loop!.familyBase;
    if (!familyMap.has(base)) familyMap.set(base, []);
    familyMap.get(base)!.push(entry);
  }

  // Step 3: Build LoopGroupMapping for each family
  const loopMappings: LoopGroupMapping[] = [];
  const collapsedVariableNames = new Set<string>();
  const baseNameToLoopIndex = new Map<string, number>();

  let groupIndex = 0;
  for (const [_familyBase, members] of familyMap) {
    // Sort by iterationIndex
    const sorted = [...members].sort(
      (a, b) => (a.loop!.iterationIndex) - (b.loop!.iterationIndex),
    );

    if (sorted.length < 2) continue; // Not a real loop

    // Derive iteration labels from sibling indices
    // Question IDs are like Q5_1, Q5_2 — extract the suffix as iteration value
    const iterations: string[] = sorted.map((entry) => {
      const match = entry.questionId.match(/_(\d+)$/);
      return match ? match[1] : String(entry.loop!.iterationIndex + 1);
    });

    // Use iteration 0 (first iteration) as the reference for variable count and structure
    const referenceEntry = sorted[0];
    const referenceItems = referenceEntry.items;

    // Step 4: Align items across iterations to build variable mappings
    const variables: LoopVariableMapping[] = [];
    // Use second iteration for cross-iteration alignment (more reliable than suffix guessing)
    const secondEntry = sorted.length > 1 ? sorted[1] : undefined;

    for (let itemIdx = 0; itemIdx < referenceItems.length; itemIdx++) {
      const refItem = referenceItems[itemIdx];
      const secondIterItem = secondEntry?.items[itemIdx];

      // Derive base name using cross-iteration alignment when possible
      const baseName = deriveBaseName(refItem.column, iterations[0], secondIterItem?.column);

      // Build iterationColumns mapping
      const iterationColumns: Record<string, string> = {};

      for (let iterIdx = 0; iterIdx < sorted.length; iterIdx++) {
        const iterEntry = sorted[iterIdx];
        const iterItem = iterEntry.items[itemIdx];

        if (iterItem) {
          iterationColumns[iterations[iterIdx]] = iterItem.column;

          // Track non-first-iteration columns as "collapsed"
          if (iterIdx > 0) {
            collapsedVariableNames.add(iterItem.column);
          }
        }
      }

      variables.push({
        baseName,
        label: refItem.label,
        iterationColumns,
      });

      baseNameToLoopIndex.set(baseName, groupIndex);
    }

    // Safety net: detect duplicate baseNames within this loop group.
    // If alignment produced collisions, fall back to using reference column names.
    const seenBases = new Map<string, number>();
    let hasDuplicates = false;
    for (let i = 0; i < variables.length; i++) {
      const bn = variables[i].baseName;
      if (seenBases.has(bn)) {
        hasDuplicates = true;
        break;
      }
      seenBases.set(bn, i);
    }
    if (hasDuplicates) {
      console.warn(
        `[loopMappings] Duplicate baseNames detected in loop group "${_familyBase}"; ` +
        `falling back to reference column names to prevent R errors`
      );
      for (let i = 0; i < variables.length; i++) {
        variables[i].baseName = referenceItems[i].column;
        baseNameToLoopIndex.delete(variables[i].baseName);
        baseNameToLoopIndex.set(referenceItems[i].column, groupIndex);
      }
    }

    // Derive skeleton from column patterns (informational)
    const skeleton = deriveSkeletonFromColumns(
      referenceItems.map(i => i.column),
      iterations[0],
    );

    loopMappings.push({
      skeleton,
      stackedFrameName: `stacked_loop_${groupIndex + 1}`,
      iterations,
      variables,
      familyBase: _familyBase,
    });

    groupIndex++;
  }

  const totalVars = loopMappings.reduce((s, m) => s + m.variables.length, 0);
  const summary = `${loopMappings.length} loop group(s) derived from V3 entries: ` +
    `${totalVars} base variables, ${collapsedVariableNames.size} iteration columns collapsed. ` +
    `Groups: ${loopMappings.map(m => `${m.stackedFrameName} (${m.variables.length} vars x ${m.iterations.length} iterations)`).join(', ')}`;

  return {
    loopMappings,
    collapsedVariableNames,
    baseNameToLoopIndex,
    hasLoops: loopMappings.length > 0,
    summary,
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Derive a base variable name by stripping the iteration suffix.
 *
 * Uses a two-tier strategy:
 * 1. Clean separator match: column ends with `_N` → strip it (handles A1_1 → A1)
 * 2. Cross-iteration alignment: compare corresponding columns across iterations
 *    to identify exactly which part varies (handles hCHANNEL_1r1 + hCHANNEL_2r1 → hCHANNEL_r1)
 *
 * The old approach had a greedy bare-digit fallback (strip any trailing digit matching
 * the iteration value) that produced wrong baseNames for grid-in-loop variables like
 * hCHANNEL_1r1 → hCHANNEL_1r (stripping the row suffix instead of the iteration marker).
 *
 * Examples:
 *   deriveBaseName('A1_1', '1')                        → 'A1'
 *   deriveBaseName('hBrand_2', '2')                     → 'hBrand'
 *   deriveBaseName('hCHANNEL_1r1', '1', 'hCHANNEL_2r1') → 'hCHANNEL_r1'
 *   deriveBaseName('Brand1', '1', 'Brand2')              → 'Brand'
 */
function deriveBaseName(column: string, iterationValue: string, otherIterCol?: string): string {
  // Tier 1: Clean separator match — column ends with _N or _NN
  const suffixPattern = new RegExp(`[_]${escapeRegex(iterationValue)}$`);
  if (suffixPattern.test(column)) {
    return column.replace(suffixPattern, '');
  }

  // Tier 2: Cross-iteration alignment — compare with corresponding column from another iteration
  if (otherIterCol) {
    const aligned = deriveBaseFromAlignment(column, otherIterCol);
    if (aligned) return aligned;
  }

  // Fallback: return as-is (don't guess with greedy digit stripping)
  return column;
}

/**
 * Derive a base name by comparing two corresponding columns across iterations.
 *
 * Finds the longest common prefix and suffix, strips the varying part (the iteration digit).
 * Handles double-separator cleanup (e.g., prefix `A1_` + suffix `_r1` → `A1_r1`, not `A1__r1`).
 */
function deriveBaseFromAlignment(col1: string, col2: string): string | null {
  if (col1 === col2) return col1; // identical columns — no iteration variation

  const minLen = Math.min(col1.length, col2.length);

  // Find longest common prefix
  let prefixLen = 0;
  while (prefixLen < minLen && col1[prefixLen] === col2[prefixLen]) {
    prefixLen++;
  }

  if (prefixLen === 0) return null; // No common structure

  // Find longest common suffix (from the end, not overlapping with prefix)
  let suffixLen = 0;
  while (
    suffixLen < minLen - prefixLen &&
    col1[col1.length - 1 - suffixLen] === col2[col2.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  let prefix = col1.slice(0, prefixLen);
  const suffix = suffixLen > 0 ? col1.slice(col1.length - suffixLen) : '';

  // Clean double separators: if prefix ends with _ and suffix starts with _, trim one
  if (prefix.match(/[_-]$/) && suffix.match(/^[_-]/)) {
    prefix = prefix.replace(/[_-]$/, '');
  }

  let base = prefix + suffix;

  // Clean trailing separator if suffix is empty (e.g., 'Brand_' → 'Brand')
  if (!suffix) {
    base = base.replace(/[_-]$/, '');
  }

  return base || null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Derive an informational skeleton pattern from column names.
 *
 * This is used for logging/diagnostics only — R doesn't need it.
 * Produces something like 'A-N-_-N' from columns like ['A1_1', 'A2_1'].
 */
function deriveSkeletonFromColumns(
  columns: string[],
  _iterationValue: string,
): string {
  if (columns.length === 0) return 'unknown';
  // Use first column as representative
  const col = columns[0];
  // Replace digit sequences with N, keep separators
  return col.replace(/\d+/g, 'N');
}

// Exported for testing only
export const _testing = { deriveBaseName, deriveBaseFromAlignment };
