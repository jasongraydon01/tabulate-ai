/**
 * Compiled Loop Contract — Deterministic Compiler
 *
 * Takes the raw LoopSemanticsPolicy (agent output) and produces a validated,
 * downstream-consumable CompiledLoopContract. This contract is the single source
 * of truth for all downstream consumers (R script, Q export, WinCross export).
 *
 * Pure functions, no I/O, no AI. Fully testable.
 *
 * Reuses:
 *   - transformCutForAlias() from src/lib/r/transformStackedCuts.ts
 *   - validateTransformedCuts() from src/lib/r/transformStackedCuts.ts
 */

import { createHash } from 'crypto';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import type { LoopSemanticsPolicy, BannerGroupPolicy } from '@/schemas/loopSemanticsPolicySchema';
import type {
  CompiledLoopContract,
  CompiledGroupEntry,
  CompiledCut,
  ClassificationSource,
} from '@/schemas/compiledLoopContractSchema';
import { transformCutForAlias, validateTransformedCuts } from '@/lib/r/transformStackedCuts';

// =============================================================================
// Constants
// =============================================================================

/**
 * Minimum agent confidence required to override the deterministic pre-classifier.
 * When the pre-classifier sees no loop variables in a group's cuts but the agent
 * classified entity-anchored, the agent's classification is trusted only if its
 * confidence meets or exceeds this threshold. Below it, the deterministic signal wins.
 */
const AGENT_OVERRIDE_CONFIDENCE_THRESHOLD = 0.75;

// =============================================================================
// Input Types
// =============================================================================

export interface CompileLoopContractInput {
  /** Raw agent policy output (or fallback policy) */
  policy: LoopSemanticsPolicy;

  /** All cuts from the crosstab plan */
  cuts: Array<{ name: string; groupName: string; rExpression: string }>;

  /** Loop group mappings (from LoopCollapser / loopMappingsFromQuestionId) */
  loopMappings: LoopGroupMapping[];

  /** Set of all known column names in the dataset (for source variable validation) */
  knownColumns: Set<string>;
}

// =============================================================================
// Portable Helper Name Generation
// =============================================================================

/**
 * Generate a portable SPSS-safe helper column name for an entity-anchored group.
 *
 * Rules for SPSS variable names:
 *   - Must start with a letter (A-Z, a-z)
 *   - Can contain letters, digits, underscores
 *   - No dots, hyphens, or other special characters
 *   - Max 64 characters
 *
 * Algorithm:
 *   1. Sanitize groupName: lowercase, non-alphanum → underscore, collapse, trim
 *   2. Prefix with HT_ (HawkTab — portable, starts with letter)
 *   3. Suffix with 4-char hex hash for uniqueness
 *   4. Truncate to 64 chars
 *   5. Collision guard against existing names
 */
export function generatePortableHelperName(
  groupName: string,
  existingNames?: Set<string>,
): string {
  // Sanitize: lowercase, non-alphanum → underscore
  let sanitized = groupName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')        // collapse consecutive underscores
    .replace(/^_|_$/g, '');     // trim leading/trailing underscores

  // Ensure non-empty after sanitization
  if (!sanitized) {
    sanitized = 'group';
  }

  // Hash for uniqueness (frame-agnostic — same alias injected into all compatible frames)
  const hash = createHash('md5')
    .update(groupName)
    .digest('hex')
    .slice(0, 4);

  // Build name: HT_{sanitized}_{hash}
  // Reserve 4 for "HT_", 5 for "_{hash}", leaves 55 for sanitized body
  const maxBodyLength = 64 - 4 - 5; // = 55
  const truncatedBody = sanitized.slice(0, maxBodyLength);
  let candidate = `HT_${truncatedBody}_${hash}`;

  // Collision guard
  if (existingNames) {
    let attempt = 0;
    while (existingNames.has(candidate) && attempt < 100) {
      attempt++;
      candidate = `HT_${truncatedBody.slice(0, maxBodyLength - 2)}_${hash}${attempt}`;
    }
  }

  return candidate;
}

// =============================================================================
// Deterministic Pre-Classification
// =============================================================================

/**
 * Identify banner groups that trivially have no loop variables in their cuts.
 * These are deterministically respondent-anchored — no AI needed.
 *
 * A group is trivially respondent-anchored when NONE of its cuts reference
 * any column name that appears in any loop mapping's iterationColumns.
 */
export function preClassifyRespondentGroups(
  cuts: Array<{ name: string; groupName: string; rExpression: string }>,
  loopMappings: LoopGroupMapping[],
): Set<string> {
  // Build set of all loop-associated column names (iteration columns)
  const loopColumns = new Set<string>();
  for (const mapping of loopMappings) {
    for (const variable of mapping.variables) {
      for (const colName of Object.values(variable.iterationColumns)) {
        loopColumns.add(colName);
      }
    }
  }

  if (loopColumns.size === 0) {
    // No loop columns at all — all groups are respondent
    const allGroups = new Set<string>();
    for (const cut of cuts) {
      allGroups.add(cut.groupName);
    }
    return allGroups;
  }

  // Group cuts by groupName
  const cutsByGroup = new Map<string, string[]>();
  for (const cut of cuts) {
    const existing = cutsByGroup.get(cut.groupName) ?? [];
    existing.push(cut.rExpression);
    cutsByGroup.set(cut.groupName, existing);
  }

  // Check each group: does any cut reference any loop column?
  const respondentGroups = new Set<string>();
  for (const [groupName, expressions] of cutsByGroup) {
    const referencesLoopVar = expressions.some(expr =>
      Array.from(loopColumns).some(col => {
        const regex = new RegExp(`\\b${escapeRegex(col)}\\b`);
        return regex.test(expr);
      }),
    );

    if (!referencesLoopVar) {
      respondentGroups.add(groupName);
    }
  }

  return respondentGroups;
}

// =============================================================================
// Main Compiler
// =============================================================================

/**
 * Compile a validated, downstream-consumable contract from the raw agent policy.
 *
 * Steps:
 *   1. Deterministic pre-classify: groups with no loop vars → respondent
 *   2. For each entity group: validate sources, generate helper name, transform cuts
 *   3. For respondent groups: pass through original expressions unchanged
 *   4. Accumulate warnings, tag classification source
 *
 * Pure function — no I/O, no AI.
 */
export function compileLoopContract(input: CompileLoopContractInput): CompiledLoopContract {
  const { policy, cuts, loopMappings, knownColumns } = input;

  const warnings: string[] = [];
  let hasFallbacks = false;

  // Available stacked frame names
  const availableFrames = loopMappings.map(m => m.stackedFrameName);

  // Build frame-by-iteration-count lookup for multi-frame entity matching
  const framesByIterationCount = new Map<number, string[]>();
  for (const m of loopMappings) {
    const count = m.iterations.length;
    const list = framesByIterationCount.get(count) || [];
    list.push(m.stackedFrameName);
    framesByIterationCount.set(count, list);
  }

  // Pre-classify trivially respondent groups
  const triviallyRespondentGroups = preClassifyRespondentGroups(cuts, loopMappings);

  // Build lookup: groupName → agent policy entry
  const policyByGroup = new Map<string, BannerGroupPolicy>();
  for (const bg of policy.bannerGroups) {
    policyByGroup.set(bg.groupName, bg);
  }

  // Track used helper names for collision detection
  const usedHelperNames = new Set<string>();

  // Compile each group
  const groups: CompiledGroupEntry[] = [];

  for (const bg of policy.bannerGroups) {
    const groupCuts = cuts.filter(c => c.groupName === bg.groupName);

    // --- Deterministic pre-classify: no loop vars in cuts ---
    // Only override to respondent if the agent ALSO classified as respondent,
    // OR the agent classified as entity but with low confidence.
    // The agent exists precisely to catch entity-anchored patterns in variables
    // that the loop detector missed (e.g., S10a/S11a without _1/_2 suffixes).
    if (triviallyRespondentGroups.has(bg.groupName)) {
      if (bg.anchorType === 'respondent') {
        // Both signals agree — confidently respondent
        groups.push(buildRespondentEntry(
          bg,
          groupCuts,
          'deterministic_no_loop_vars',
          1.0,
          ['No loop variables referenced in any cut expression — deterministically respondent-anchored'],
        ));
        continue;
      }

      // Agent says entity but pre-classifier sees no loop vars.
      // Trust the agent if confidence is high enough — it may have detected
      // iteration-linked variables that the loop detector missed.
      if (bg.anchorType === 'entity' && bg.confidence < AGENT_OVERRIDE_CONFIDENCE_THRESHOLD) {
        warnings.push(
          `Group "${bg.groupName}": agent classified as entity (conf=${bg.confidence}) ` +
          `but no loop variables found in cuts and confidence below threshold ` +
          `(${AGENT_OVERRIDE_CONFIDENCE_THRESHOLD}). Using respondent.`,
        );
        groups.push(buildRespondentEntry(
          bg,
          groupCuts,
          'deterministic_no_loop_vars',
          bg.confidence,
          [
            ...bg.evidence,
            `Overridden: agent confidence ${bg.confidence} below threshold ${AGENT_OVERRIDE_CONFIDENCE_THRESHOLD}`,
          ],
        ));
        continue;
      }
      // Agent says entity with high confidence — fall through to entity compilation
    }

    // --- Agent classified as respondent ---
    if (bg.anchorType === 'respondent') {
      groups.push(buildRespondentEntry(
        bg,
        groupCuts,
        'agent_respondent',
        bg.confidence,
        bg.evidence,
      ));
      continue;
    }

    // --- Agent classified as entity — validate and compile ---
    const compiled = compileEntityGroup(
      bg,
      groupCuts,
      framesByIterationCount,
      knownColumns,
      usedHelperNames,
      warnings,
    );

    if (compiled.fallback) {
      hasFallbacks = true;
    }

    groups.push(compiled.entry);
  }

  return {
    contractVersion: '1.0',
    compiledAt: new Date().toISOString(),
    groups,
    availableFrames,
    warnings,
    hasFallbacks: hasFallbacks || policy.fallbackApplied,
    sourcePolicyVersion: policy.policyVersion,
    sourcePolicyWasFallback: policy.fallbackApplied,
  };
}

// =============================================================================
// Internal Helpers
// =============================================================================

function buildRespondentEntry(
  bg: BannerGroupPolicy,
  groupCuts: Array<{ name: string; rExpression: string }>,
  classificationSource: ClassificationSource,
  confidence: number,
  evidence: string[],
): CompiledGroupEntry {
  return {
    groupName: bg.groupName,
    anchorType: 'respondent',
    shouldPartition: bg.shouldPartition,
    comparisonMode: bg.comparisonMode,
    targetFrame: '',
    targetFrames: [],
    helperColumnName: '',
    helperBranches: [],
    compiledCuts: groupCuts.map(cut => ({
      cutName: cut.name,
      originalExpression: cut.rExpression,
      compiledExpression: cut.rExpression,
      wasTransformed: false,
    })),
    classificationSource,
    confidence,
    evidence,
  };
}

/**
 * Compile an entity-anchored group. Runs validation gates and falls back
 * to respondent-anchored if any gate fails.
 *
 * Entity-anchored groups apply to ALL stacked frames with compatible iteration
 * counts (strict equality). The alias column is frame-agnostic — source variables
 * and .loop_iter exist in every stacked frame.
 */
function compileEntityGroup(
  bg: BannerGroupPolicy,
  groupCuts: Array<{ name: string; rExpression: string }>,
  framesByIterationCount: Map<number, string[]>,
  knownColumns: Set<string>,
  usedHelperNames: Set<string>,
  warnings: string[],
): { entry: CompiledGroupEntry; fallback: boolean } {
  const sourcesByIteration = bg.implementation.sourcesByIteration;
  const sourceVars = sourcesByIteration.map(s => s.variable);

  // --- Gate 1: Find all compatible frames (iteration count match) ---
  const iterationCount = sourcesByIteration.length;
  const compatibleFrames = (framesByIterationCount.get(iterationCount) || []).sort();
  if (compatibleFrames.length === 0) {
    const allCounts = [...framesByIterationCount.keys()].sort().join(', ');
    warnings.push(
      `Group "${bg.groupName}": entity-anchored with ${iterationCount} source(s), ` +
      `but no frames have ${iterationCount} iteration(s) (available counts: [${allCounts}]). ` +
      `Falling back to respondent-anchored.`,
    );
    return {
      entry: buildRespondentEntry(bg, groupCuts, 'fallback_no_compatible_frames', bg.confidence, [
        ...bg.evidence,
        `Fallback: no frames with ${iterationCount} iteration(s)`,
      ]),
      fallback: true,
    };
  }

  // --- Gate 2: Source variables exist ---
  const missingVars = sourceVars.filter(v => !knownColumns.has(v));
  if (missingVars.length > 0 && missingVars.length === sourceVars.length) {
    // ALL source variables missing — can't compile any helper branches
    warnings.push(
      `Group "${bg.groupName}": all source variables missing from known columns ` +
      `[${missingVars.join(', ')}]. Falling back to respondent-anchored.`,
    );
    return {
      entry: buildRespondentEntry(bg, groupCuts, 'fallback_missing_sources', bg.confidence, [
        ...bg.evidence,
        `Fallback: all source variables missing: ${missingVars.join(', ')}`,
      ]),
      fallback: true,
    };
  }

  // Partial missing: warn but continue with available branches
  if (missingVars.length > 0) {
    warnings.push(
      `Group "${bg.groupName}": some source variables missing [${missingVars.join(', ')}]. ` +
      `Helper column will have NA for those iterations.`,
    );
  }

  // --- Generate portable helper name (frame-agnostic) ---
  const helperColumnName = generatePortableHelperName(bg.groupName, usedHelperNames);
  usedHelperNames.add(helperColumnName);

  // --- Build helper branches (only for existing variables) ---
  const helperBranches = sourcesByIteration
    .filter(s => knownColumns.has(s.variable))
    .map(s => ({ iteration: s.iteration, sourceVariable: s.variable }));

  // --- Transform cuts ---
  const compiledCuts: CompiledCut[] = [];
  const transformedExpressions: string[] = [];

  for (const cut of groupCuts) {
    const transformed = transformCutForAlias(cut.rExpression, sourceVars, helperColumnName);
    const wasTransformed = transformed !== cut.rExpression;
    compiledCuts.push({
      cutName: cut.name,
      originalExpression: cut.rExpression,
      compiledExpression: transformed,
      wasTransformed,
    });
    if (wasTransformed) {
      transformedExpressions.push(transformed);
    }
  }

  // --- Gate 3: Duplicate transform detection ---
  if (transformedExpressions.length > 0) {
    const validation = validateTransformedCuts(transformedExpressions, bg.groupName);
    if (validation.hasDuplicates) {
      warnings.push(
        `Group "${bg.groupName}": duplicate transformed expressions detected ` +
        `[${validation.duplicates.join(', ')}]. Falling back to respondent-anchored.`,
      );
      return {
        entry: buildRespondentEntry(bg, groupCuts, 'fallback_duplicate_transform', bg.confidence, [
          ...bg.evidence,
          `Fallback: duplicate transformed expressions: ${validation.duplicates.join(', ')}`,
        ]),
        fallback: true,
      };
    }
  }

  // --- All gates passed: emit entity entry for all compatible frames ---
  return {
    entry: {
      groupName: bg.groupName,
      anchorType: 'entity',
      shouldPartition: bg.shouldPartition,
      comparisonMode: bg.comparisonMode,
      targetFrame: compatibleFrames[0] || '',
      targetFrames: compatibleFrames,
      helperColumnName,
      helperBranches,
      compiledCuts,
      classificationSource: 'agent_entity',
      confidence: bg.confidence,
      evidence: bg.evidence,
    },
    fallback: false,
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
