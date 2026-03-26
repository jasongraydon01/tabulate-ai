/**
 * DataMapGrouper
 *
 * @deprecated V3 Migration: Direct imports of this module from runtime code are
 * prohibited. Use the transitional adapter at
 * src/lib/v3/runtime/questionId/groupingAdapter.ts instead (step 00 parity only).
 * This module will be removed after V3 runtime migration Phase 6 when a V3-native
 * grouper replaces it.
 * See: docs/v3-runtime-architecture-refactor-plan.md
 *
 * Purpose: Group verbose datamap variables by parent question for table generation.
 * Extracted from TableAgent.ts as part of Part 4 refactor.
 */

import { type VerboseDataMapType } from '../../schemas/processingSchemas';
import {
  type RegroupConfig,
  type RegroupConfigOverride,
  resolveRegroupConfig,
  buildRegroupSummaryLine,
} from './regroupConfig';

// =============================================================================
// Configuration
// =============================================================================

/**
 * Options for controlling which variable types to include
 */
export interface DataMapGrouperOptions {
  /** Include open-ended text variables (env: INCLUDE_OPEN_ENDS, default: false) */
  includeOpenEnds?: boolean;
  /** Include admin/metadata variables (env: INCLUDE_ADMIN, default: false) */
  includeAdmin?: boolean;
  /** Highest-precedence regrouping override (run-level) */
  regrouping?: RegroupConfigOverride;
  /** Project-level regrouping override */
  projectRegrouping?: RegroupConfigOverride;
}

/**
 * Get options from environment variables
 */
export function getGrouperOptionsFromEnv(): DataMapGrouperOptions {
  return {
    includeOpenEnds: process.env.INCLUDE_OPEN_ENDS === 'true',
    includeAdmin: process.env.INCLUDE_ADMIN === 'true',
  };
}

// =============================================================================
// Types
// =============================================================================

/**
 * Single item in a question group (one variable from the datamap)
 */
export interface QuestionItem {
  /** SPSS variable name: "S8r1", "A1r1" */
  column: string;
  /** From description field */
  label: string;
  /** Parsed sub-item label (e.g., product/attribute name) when available */
  subItemLabel?: string;
  /** Parent context with identifiers: "A3ar1: Product A - ..." */
  context?: string;
  /** Classified variable type: "numeric_range", "categorical_select", etc. */
  normalizedType: string;
  /** Raw value type: "Values: 0-100", "Values: 1-2" */
  valueType: string;
  /** Minimum value for numeric ranges */
  rangeMin?: number;
  /** Maximum value for numeric ranges */
  rangeMax?: number;
  /** Discrete allowed values for categorical/scale variables */
  allowedValues?: (number | string)[];
  /** Labels for scale points */
  scaleLabels?: Array<{ value: number | string; label: string }>;
}

/**
 * Group of items belonging to the same parent question
 */
export interface QuestionGroup {
  /** Parent question ID: "S8", "A1" */
  questionId: string;
  /** Question text from description or context */
  questionText: string;
  /** All variables for this question */
  items: QuestionItem[];
}

type RegroupAxis = 'sibling_axis' | 'suffix_axis' | 'flat_fallback' | 'none';

interface ParsedSiblingId {
  base: string;
  index: number;
}

interface CandidateFamily {
  base: string;
  firstGroupIndex: number;
  memberGroupIndexes: Set<number>;
  replacementGroups: QuestionGroup[];
}

interface FamilyMemberRef {
  groupIndex: number;
  questionId: string;
  siblingIndex: number;
}

interface AxisScoreBreakdown {
  labelTokenStability: number;
  contextStability: number;
  cardinalityPlausibility: number;
  suffixSemanticPrior: number;
  total: number;
}

interface FitnessResult {
  conservationCheckPassed: boolean;
  rowParityCheckPassed: boolean;
  boundsCheckPassed: boolean;
  orderingCheckPassed: boolean;
}

export interface RegroupFamilyDecision {
  familyBase: string;
  candidateAxes: RegroupAxis[];
  axisScores?: {
    sibling_axis: AxisScoreBreakdown;
    suffix_axis: AxisScoreBreakdown;
  };
  selectedAxis: RegroupAxis;
  scoreMargin: number;
  applied: boolean;
  fallbackReason?: string;
  conservationCheckPassed?: boolean;
  rowParityCheckPassed?: boolean;
  boundsCheckPassed?: boolean;
  orderingCheckPassed?: boolean;
}

export interface RegroupDecisionReport {
  generatedAt: string;
  effectiveConfig: RegroupConfig;
  warnings: string[];
  totals: {
    detected: number;
    candidate: number;
    applied: number;
    fallback: number;
    reverted: number;
    skipped: number;
  };
  families: RegroupFamilyDecision[];
}

export interface GroupDataMapDetailedResult {
  groups: QuestionGroup[];
  regroupDecisionReport?: RegroupDecisionReport;
  effectiveRegroupConfig: RegroupConfig;
}

// =============================================================================
// Filtering Logic
// =============================================================================

/**
 * Normalized types to exclude from processing by default.
 * These types cannot be meaningfully displayed in crosstabs.
 */
export const EXCLUDED_NORMALIZED_TYPES = new Set([
  'admin',
  'text_open',
  'weight',
]);

/**
 * Check if a variable should be included in processing based on its type
 */
export function isProcessableVariable(
  variable: VerboseDataMapType,
  options: DataMapGrouperOptions = {}
): boolean {
  const normalizedType = variable.normalizedType || 'unknown';

  if (normalizedType === 'admin' && !options.includeAdmin) {
    return false;
  }
  if (normalizedType === 'text_open' && !options.includeOpenEnds) {
    return false;
  }
  if (normalizedType === 'weight') {
    return false;
  }

  return true;
}

/**
 * Filter datamap to only processable variables
 */
export function filterProcessableVariables(
  dataMap: VerboseDataMapType[],
  options: DataMapGrouperOptions = {}
): VerboseDataMapType[] {
  const processable = dataMap.filter(v => isProcessableVariable(v, options));

  const excludedCount = dataMap.length - processable.length;
  if (excludedCount > 0) {
    console.log(`[DataMapGrouper] Filtered out ${excludedCount} non-processable variables`);
  }

  return processable;
}

// =============================================================================
// Grouping Logic
// =============================================================================

/**
 * Backward-compatible API for callers that only need grouped output.
 */
export function groupDataMap(
  dataMap: VerboseDataMapType[],
  options?: DataMapGrouperOptions
): QuestionGroup[] {
  return groupDataMapDetailed(dataMap, options).groups;
}

/**
 * Detailed grouping API with regroup diagnostics and resolved config.
 */
export function groupDataMapDetailed(
  dataMap: VerboseDataMapType[],
  options?: DataMapGrouperOptions
): GroupDataMapDetailedResult {
  const effectiveOptions = {
    ...getGrouperOptionsFromEnv(),
    ...options,
  };

  const { config: regroupConfig, warnings: regroupWarnings } = resolveRegroupConfig({
    runOverride: effectiveOptions.regrouping,
    projectOverride: effectiveOptions.projectRegrouping,
  });

  const groups: QuestionGroup[] = [];

  const processableData = filterProcessableVariables(dataMap, effectiveOptions);
  const parents = processableData.filter(v => v.level === 'parent');
  const subs = processableData.filter(v => v.level === 'sub');

  const subGroups = new Map<string, VerboseDataMapType[]>();
  for (const sub of subs) {
    const parent = sub.parentQuestion;
    if (!parent || parent === 'NA') continue;
    if (!subGroups.has(parent)) subGroups.set(parent, []);
    subGroups.get(parent)!.push(sub);
  }

  // -------------------------------------------------------------------------
  // OE-only sub-group detachment
  //
  // When ALL sub-variables of a parent are text_open (e.g., "Other specify"
  // fields like S4r9oe) AND the parent variable itself exists in the .sav as
  // a real categorical/numeric variable, the parent is the primary data
  // carrier — not the OE subs. In this case, detach the OE subs so:
  //   - The parent gets its own group (categorical_select, reportable)
  //   - Each OE sub becomes a standalone group (text_open_end)
  //
  // This does NOT affect normal grid/multi-select questions where subs are
  // the real response items (e.g., Q5r1, Q5r2, Q5r3 — these are not
  // text_open, so the condition never triggers).
  // -------------------------------------------------------------------------
  const parentColumnSet = new Set(parents.map(p => p.column));
  for (const [parentId, items] of subGroups) {
    if (!parentColumnSet.has(parentId)) continue;
    if (!items.every(item => item.normalizedType === 'text_open')) continue;

    // Detach: create standalone groups for each OE sub
    for (const sub of items) {
      groups.push({
        questionId: sub.column,
        questionText: sub.description,
        items: [{
          column: sub.column,
          label: sub.description,
          context: sub.context,
          normalizedType: sub.normalizedType || 'unknown',
          valueType: sub.valueType,
          rangeMin: sub.rangeMin,
          rangeMax: sub.rangeMax,
          allowedValues: sub.allowedValues,
          scaleLabels: sub.scaleLabels,
        }],
      });
    }

    // Remove from subGroups so the parent won't be skipped at line 280
    subGroups.delete(parentId);
  }

  for (const [parentId, items] of subGroups) {
    const subResolution = resolveSubgroupQuestionAndLabels(parentId, items);
    const questionText = subResolution.questionText;

    groups.push({
      questionId: parentId,
      questionText,
      items: items.map(item => ({
        column: item.column,
        label: subResolution.labelByColumn.get(item.column)?.displayLabel || item.description,
        subItemLabel: subResolution.labelByColumn.get(item.column)?.subItemLabel,
        context: item.context,
        normalizedType: item.normalizedType || 'unknown',
        valueType: item.valueType,
        rangeMin: item.rangeMin,
        rangeMax: item.rangeMax,
        allowedValues: item.allowedValues,
        scaleLabels: item.scaleLabels,
      })),
    });
  }

  const parentsWithSubs = new Set(subGroups.keys());
  for (const parent of parents) {
    if (parentsWithSubs.has(parent.column)) continue;

    groups.push({
      questionId: parent.column,
      questionText: parent.description,
      items: [{
        column: parent.column,
        label: parent.description,
        context: parent.context,
        normalizedType: parent.normalizedType || 'unknown',
        valueType: parent.valueType,
        rangeMin: parent.rangeMin,
        rangeMax: parent.rangeMax,
        allowedValues: parent.allowedValues,
        scaleLabels: parent.scaleLabels,
      }],
    });
  }

  const regroupResult = detectAndRegroupFamilies(groups, regroupConfig, regroupWarnings);

  return {
    groups: regroupResult.groups,
    regroupDecisionReport: regroupConfig.emitDecisionReport ? regroupResult.report : undefined,
    effectiveRegroupConfig: regroupConfig,
  };
}

function detectAndRegroupFamilies(
  groups: QuestionGroup[],
  config: RegroupConfig,
  warnings: string[]
): { groups: QuestionGroup[]; report: RegroupDecisionReport } {
  const siblingFamilies = new Map<string, FamilyMemberRef[]>();

  for (let i = 0; i < groups.length; i++) {
    const parsed = parseSiblingQuestionId(groups[i]?.questionId);
    if (!parsed) continue;
    const family = siblingFamilies.get(parsed.base) || [];
    family.push({ groupIndex: i, questionId: groups[i].questionId, siblingIndex: parsed.index });
    siblingFamilies.set(parsed.base, family);
  }

  const allowSuffixRegexes = compileRegexes(config.allowedSuffixPatterns, 'allowedSuffixPatterns', warnings);
  const blockSuffixRegexes = compileRegexes(config.blockedSuffixPatterns, 'blockedSuffixPatterns', warnings);
  const allowFamilyRegexes = compileRegexes(config.allowFamilyPatterns, 'allowFamilyPatterns', warnings);
  const blockFamilyRegexes = compileRegexes(config.blockFamilyPatterns, 'blockFamilyPatterns', warnings);

  const candidates: CandidateFamily[] = [];
  const familyDecisions: RegroupFamilyDecision[] = [];

  let detected = 0;
  let candidate = 0;
  let applied = 0;
  let fallback = 0;
  let reverted = 0;
  let skipped = 0;

  for (const [base, members] of siblingFamilies.entries()) {
    if (members.length < config.minSiblings) continue;
    detected += 1;

    const orderedMembers = [...members].sort((a, b) => a.siblingIndex - b.siblingIndex);
    const memberGroups = orderedMembers.map(m => groups[m.groupIndex]);

    const decision: RegroupFamilyDecision = {
      familyBase: base,
      candidateAxes: ['sibling_axis', 'suffix_axis', 'flat_fallback'],
      selectedAxis: 'none',
      scoreMargin: 0,
      applied: false,
    };

    if (!config.enabled) {
      decision.fallbackReason = 'regroup_disabled';
      skipped += 1;
      familyDecisions.push(decision);
      continue;
    }

    if (!isFamilyAllowed(base, allowFamilyRegexes, blockFamilyRegexes)) {
      decision.fallbackReason = 'family_pattern_blocked';
      skipped += 1;
      familyDecisions.push(decision);
      continue;
    }

    const suffixSet = extractSuffixSet(memberGroups[0]);
    if (!suffixSet || suffixSet.length === 0) {
      decision.fallbackReason = 'missing_suffix_set';
      skipped += 1;
      familyDecisions.push(decision);
      continue;
    }

    if (!suffixSet.every(suffix => isSuffixAllowed(suffix, allowSuffixRegexes, blockSuffixRegexes))) {
      decision.fallbackReason = 'suffix_pattern_blocked';
      skipped += 1;
      familyDecisions.push(decision);
      continue;
    }

    if (!allGroupsHaveMatchingSuffixSet(memberGroups, suffixSet)) {
      decision.fallbackReason = 'mismatched_suffix_set';
      skipped += 1;
      familyDecisions.push(decision);
      continue;
    }

    if (!isScaleCardinalityAllowed(memberGroups, config.maxScaleCardinality)) {
      decision.fallbackReason = 'scale_cardinality_exceeded';
      skipped += 1;
      familyDecisions.push(decision);
      continue;
    }

    candidate += 1;

    const siblingGroups = buildSiblingAxisGroups(base, orderedMembers, groups);
    const suffixGroups = buildSuffixAxisGroups(base, orderedMembers, suffixSet, groups);
    const flatFallbackGroups = buildFlatFallbackGroups(base, orderedMembers, groups);

    const siblingScore = scoreAxis(siblingGroups, base, suffixSet, config, 'sibling_axis');
    const suffixScore = scoreAxis(suffixGroups, base, suffixSet, config, 'suffix_axis');

    decision.axisScores = {
      sibling_axis: siblingScore,
      suffix_axis: suffixScore,
    };

    const bestAxis: RegroupAxis = siblingScore.total >= suffixScore.total ? 'sibling_axis' : 'suffix_axis';
    const second = bestAxis === 'sibling_axis' ? suffixScore.total : siblingScore.total;
    const margin = Math.abs((bestAxis === 'sibling_axis' ? siblingScore.total : suffixScore.total) - second);

    decision.scoreMargin = margin;

    let selectedAxis: RegroupAxis;
    let replacementGroups: QuestionGroup[];

    if (margin < config.minAxisMargin) {
      selectedAxis = 'flat_fallback';
      replacementGroups = flatFallbackGroups;
      decision.fallbackReason = 'low_margin';
    } else if (bestAxis === 'sibling_axis') {
      selectedAxis = 'sibling_axis';
      replacementGroups = siblingGroups;
    } else {
      selectedAxis = 'suffix_axis';
      replacementGroups = suffixGroups;
    }

    decision.selectedAxis = selectedAxis;

    const fitness = validateRegroupFitness(base, memberGroups, replacementGroups, config);
    decision.conservationCheckPassed = fitness.conservationCheckPassed;
    decision.rowParityCheckPassed = fitness.rowParityCheckPassed;
    decision.boundsCheckPassed = fitness.boundsCheckPassed;
    decision.orderingCheckPassed = fitness.orderingCheckPassed;

    const fitnessPassed =
      fitness.conservationCheckPassed &&
      fitness.rowParityCheckPassed &&
      fitness.boundsCheckPassed &&
      fitness.orderingCheckPassed;

    if (!fitnessPassed || replacementGroups.length === 0) {
      decision.applied = false;
      decision.fallbackReason = decision.fallbackReason || 'fitness_check_failed';
      reverted += 1;
      familyDecisions.push(decision);
      continue;
    }

    decision.applied = true;
    applied += 1;
    if (selectedAxis === 'flat_fallback') {
      fallback += 1;
    }

    familyDecisions.push(decision);
    candidates.push({
      base,
      firstGroupIndex: orderedMembers[0].groupIndex,
      memberGroupIndexes: new Set(orderedMembers.map(m => m.groupIndex)),
      replacementGroups,
    });
  }

  const candidateByFirstGroupIndex = new Map<number, CandidateFamily>();
  const allReplacedGroupIndexes = new Set<number>();
  for (const candidateFamily of candidates) {
    candidateByFirstGroupIndex.set(candidateFamily.firstGroupIndex, candidateFamily);
    for (const index of candidateFamily.memberGroupIndexes) {
      allReplacedGroupIndexes.add(index);
    }
  }

  const regrouped: QuestionGroup[] = [];
  for (let i = 0; i < groups.length; i++) {
    const candidateFamily = candidateByFirstGroupIndex.get(i);
    if (candidateFamily) {
      regrouped.push(...candidateFamily.replacementGroups);
      continue;
    }

    if (allReplacedGroupIndexes.has(i)) {
      continue;
    }

    regrouped.push(groups[i]);
  }

  const report: RegroupDecisionReport = {
    generatedAt: new Date().toISOString(),
    effectiveConfig: config,
    warnings,
    totals: {
      detected,
      candidate,
      applied,
      fallback,
      reverted,
      skipped,
    },
    families: familyDecisions,
  };

  if (detected > 0) {
    console.log(`[DataMapGrouper] Regroup summary: ${buildRegroupSummaryLine(report)}`);
  }

  return {
    groups: regrouped,
    report,
  };
}

function scoreAxis(
  projectedGroups: QuestionGroup[],
  base: string,
  suffixSet: string[],
  config: RegroupConfig,
  axis: 'sibling_axis' | 'suffix_axis'
): AxisScoreBreakdown {
  const labelTokenStability = calculateLabelTokenStability(projectedGroups);
  const contextStability = calculateContextStability(projectedGroups);
  const cardinalityPlausibility = calculateCardinalityPlausibility(projectedGroups, config);
  const suffixSemanticPrior = calculateSuffixSemanticPrior(base, suffixSet, config, axis);

  const total =
    0.45 * labelTokenStability +
    0.30 * contextStability +
    0.20 * cardinalityPlausibility +
    0.05 * suffixSemanticPrior;

  return {
    labelTokenStability,
    contextStability,
    cardinalityPlausibility,
    suffixSemanticPrior,
    total,
  };
}

function validateRegroupFitness(
  base: string,
  sourceGroups: QuestionGroup[],
  outputGroups: QuestionGroup[],
  config: RegroupConfig
): FitnessResult {
  const sourceColumns = sourceGroups.flatMap(group => group.items.map(item => item.column));
  const outputColumns = outputGroups.flatMap(group => group.items.map(item => item.column));

  const sourceSet = new Set(sourceColumns);
  const outputSet = new Set(outputColumns);

  const conservationCheckPassed =
    sourceColumns.length === outputColumns.length &&
    sourceSet.size === outputSet.size &&
    [...sourceSet].every(column => outputSet.has(column));

  const rowParityCheckPassed = sourceColumns.length === outputColumns.length;

  const boundsCheckPassed = outputGroups.every(group => {
    const len = group.items.length;
    return len >= config.minRowsPerRegroupedTable && len <= config.maxRowsPerRegroupedTable;
  });

  const orderingCheckPassed = outputGroups.every(group => {
    const sorted = [...group.items].sort((a, b) => compareFamilyColumns(a.column, b.column, base));
    return group.items.every((item, index) => item.column === sorted[index]?.column);
  });

  return {
    conservationCheckPassed,
    rowParityCheckPassed,
    boundsCheckPassed,
    orderingCheckPassed,
  };
}

function buildSiblingAxisGroups(
  base: string,
  orderedMembers: FamilyMemberRef[],
  groups: QuestionGroup[]
): QuestionGroup[] {
  return orderedMembers.map(member => {
    const source = groups[member.groupIndex];
    const items = [...source.items].sort((a, b) => compareFamilyColumns(a.column, b.column, base));
    return {
      questionId: source.questionId,
      questionText: source.questionText,
      items,
    };
  });
}

function buildSuffixAxisGroups(
  base: string,
  orderedMembers: FamilyMemberRef[],
  suffixSet: string[],
  groups: QuestionGroup[]
): QuestionGroup[] {
  const sortedSuffixes = [...suffixSet].sort(compareSuffix);
  const sourceGroups = orderedMembers.map(member => groups[member.groupIndex]);
  const resolvedQuestionText = resolveRegroupedQuestionText(sourceGroups, base);

  return sortedSuffixes
    .map(suffix => {
      const regroupedItems = orderedMembers.flatMap(member => {
        const sourceGroup = groups[member.groupIndex];
        return sourceGroup.items
          .filter(item => getItemSuffix(item.column, member.questionId) === suffix)
          .map(item => ({ ...item }));
      });

      regroupedItems.sort((a, b) => compareFamilyColumns(a.column, b.column, base));

      return {
        questionId: `${base}_${suffix}`,
        questionText: resolvedQuestionText || `${base}_${suffix}`,
        items: regroupedItems,
      };
    })
    .filter(group => group.items.length > 0);
}

function buildFlatFallbackGroups(
  base: string,
  orderedMembers: FamilyMemberRef[],
  groups: QuestionGroup[]
): QuestionGroup[] {
  const sourceGroups = orderedMembers.map(member => groups[member.groupIndex]);
  const resolvedQuestionText = resolveRegroupedQuestionText(sourceGroups, base);

  const flattenedItems = orderedMembers.flatMap(member => {
    const sourceGroup = groups[member.groupIndex];
    return sourceGroup.items.map(item => ({ ...item }));
  });

  flattenedItems.sort((a, b) => compareFamilyColumns(a.column, b.column, base));

  return [{
    questionId: base,
    questionText: resolvedQuestionText || base,
    items: flattenedItems,
  }];
}

function isFamilyAllowed(base: string, allow: RegExp[], block: RegExp[]): boolean {
  if (block.some(regex => regex.test(base))) return false;
  if (allow.length === 0) return true;
  return allow.some(regex => regex.test(base));
}

function isSuffixAllowed(suffix: string, allow: RegExp[], block: RegExp[]): boolean {
  if (block.some(regex => regex.test(suffix))) return false;
  if (allow.length === 0) return true;
  return allow.some(regex => regex.test(suffix));
}

function compileRegexes(patterns: string[], label: string, warnings: string[]): RegExp[] {
  const regexes: RegExp[] = [];
  for (const pattern of patterns) {
    try {
      regexes.push(new RegExp(pattern, 'i'));
    } catch {
      warnings.push(`[DataMapGrouper] Invalid ${label} regex ignored: ${pattern}`);
    }
  }
  return regexes;
}

function calculateLabelTokenStability(groups: QuestionGroup[]): number {
  if (groups.length === 0) return 0;
  const scores = groups.map(group => {
    const tokenSets = group.items.map(item => tokenizeLabel(item.label));
    if (tokenSets.length <= 1) return 1;

    let total = 0;
    let pairs = 0;
    for (let i = 0; i < tokenSets.length; i++) {
      for (let j = i + 1; j < tokenSets.length; j++) {
        total += jaccardSimilarity(tokenSets[i], tokenSets[j]);
        pairs += 1;
      }
    }

    return pairs > 0 ? total / pairs : 1;
  });

  return average(scores);
}

function calculateContextStability(groups: QuestionGroup[]): number {
  if (groups.length === 0) return 0;

  const scores = groups.map(group => {
    const stems = group.items.map(item => normalizeStem(item.context || group.questionText || item.label));
    if (stems.length === 0) return 0;

    const counts = new Map<string, number>();
    for (const stem of stems) {
      counts.set(stem, (counts.get(stem) || 0) + 1);
    }

    const dominant = Math.max(...counts.values());
    return dominant / stems.length;
  });

  return average(scores);
}

function calculateCardinalityPlausibility(groups: QuestionGroup[], config: RegroupConfig): number {
  if (groups.length === 0) return 0;

  const scores = groups.map(group => {
    const n = group.items.length;
    if (n < config.minRowsPerRegroupedTable) {
      return n / config.minRowsPerRegroupedTable;
    }
    if (n > config.maxRowsPerRegroupedTable) {
      return config.maxRowsPerRegroupedTable / n;
    }
    return 1;
  });

  return average(scores);
}

function calculateSuffixSemanticPrior(
  _base: string,
  suffixSet: string[],
  config: RegroupConfig,
  axis: 'sibling_axis' | 'suffix_axis'
): number {
  const classes = new Set(suffixSet.map(suffix => {
    const match = suffix.toLowerCase().match(/^([a-z]+)/);
    return match?.[1] || '';
  }));

  let suffixWeight = config.suffixClassPriorWeights.default;
  if (classes.size === 1) {
    const cls = [...classes][0];
    if (cls === 'r') {
      suffixWeight = config.suffixClassPriorWeights.r;
    } else if (cls === 'c') {
      suffixWeight = config.suffixClassPriorWeights.c;
    }
  }

  return axis === 'suffix_axis' ? suffixWeight : 1 - suffixWeight;
}

function tokenizeLabel(label: string): Set<string> {
  const normalized = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(Boolean)
    .filter(token => !/^[0-9]+$/.test(token))
    .filter(token => !STOPWORDS.has(token));

  return new Set(normalized);
}

function normalizeStem(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b[0-9]+\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;

  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }

  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return intersection / union;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isScaleCardinalityAllowed(groups: QuestionGroup[], maxScaleCardinality: number): boolean {
  for (const group of groups) {
    for (const item of group.items) {
      if (!Array.isArray(item.allowedValues)) continue;
      if (item.allowedValues.length > maxScaleCardinality) {
        return false;
      }
    }
  }
  return true;
}

function parseSiblingQuestionId(questionId: string): ParsedSiblingId | null {
  const match = questionId.match(/^(.*)_(\d+)$/);
  if (!match) return null;

  const index = Number(match[2]);
  if (!Number.isInteger(index)) return null;

  return {
    base: match[1],
    index,
  };
}

function extractSuffixSet(group: QuestionGroup): string[] | null {
  if (group.items.length === 0) return null;

  const suffixes = new Set<string>();
  for (const item of group.items) {
    const suffix = getItemSuffix(item.column, group.questionId);
    if (!suffix) return null;
    suffixes.add(suffix);
  }

  return [...suffixes];
}

function allGroupsHaveMatchingSuffixSet(groups: QuestionGroup[], expected: string[]): boolean {
  for (const group of groups) {
    const current = extractSuffixSet(group);
    if (!current) return false;
    if (!areEqualSets(expected, current)) return false;
  }
  return true;
}

function getItemSuffix(column: string, questionId: string): string | null {
  if (!column.startsWith(questionId)) return null;
  const suffix = column.slice(questionId.length);
  return suffix.length > 0 ? suffix : null;
}

function areEqualSets(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  for (const value of b) {
    if (!setA.has(value)) return false;
  }
  return true;
}

function compareSuffix(a: string, b: string): number {
  const aNum = Number(a.replace(/^\D+/g, ''));
  const bNum = Number(b.replace(/^\D+/g, ''));
  if (Number.isInteger(aNum) && Number.isInteger(bNum)) {
    return aNum - bNum;
  }
  return a.localeCompare(b);
}

function compareFamilyColumns(a: string, b: string, base: string): number {
  const aParsed = parseFamilyColumn(base, a);
  const bParsed = parseFamilyColumn(base, b);

  if (aParsed && bParsed) {
    if (aParsed.index !== bParsed.index) {
      return aParsed.index - bParsed.index;
    }
    const suffixCmp = compareSuffix(aParsed.suffix, bParsed.suffix);
    if (suffixCmp !== 0) return suffixCmp;
  }

  return a.localeCompare(b);
}

function parseFamilyColumn(base: string, column: string): { index: number; suffix: string } | null {
  const escapedBase = escapeRegex(base);
  const match = column.match(new RegExp(`^${escapedBase}_(\\d+)(.+)$`, 'i'));
  if (!match) return null;
  const index = Number.parseInt(match[1], 10);
  if (!Number.isInteger(index)) return null;

  return {
    index,
    suffix: match[2],
  };
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface ParsedDescriptionParts {
  body: string;
  parts: string[];
}

interface SubgroupItemLabelInfo {
  displayLabel: string;
  subItemLabel?: string;
}

interface SubgroupResolution {
  questionText: string;
  labelByColumn: Map<string, SubgroupItemLabelInfo>;
}

function resolveSubgroupQuestionAndLabels(
  parentId: string,
  items: VerboseDataMapType[],
): SubgroupResolution {
  const parsedByColumn = new Map<string, ParsedDescriptionParts>();
  for (const item of items) {
    parsedByColumn.set(item.column, parseDescriptionParts(item.column, item.description));
  }

  const contextQuestion = resolveQuestionTextFromContext(parentId, items);
  const descriptionQuestion = resolveQuestionTextFromDescriptions(items, parsedByColumn, parentId);
  const questionText = contextQuestion || descriptionQuestion || parentId;
  const canonicalQuestion = descriptionQuestion || questionText;
  const normalizedQuestion = normalizeComparableText(canonicalQuestion);

  const labelByColumn = new Map<string, SubgroupItemLabelInfo>();
  for (const item of items) {
    const parsed = parsedByColumn.get(item.column);
    const subItemLabel = parsed ? extractSubItemLabel(parsed, normalizedQuestion) : undefined;
    if (subItemLabel) {
      labelByColumn.set(item.column, {
        displayLabel: subItemLabel,
        subItemLabel,
      });
    }
  }

  return {
    questionText,
    labelByColumn,
  };
}

function resolveQuestionTextFromContext(parentId: string, items: VerboseDataMapType[]): string | undefined {
  const normalizedToOriginal = new Map<string, string>();
  for (const item of items) {
    const context = (item.context || '').trim();
    if (!context) continue;
    const candidate = normalizeContextQuestionText(parentId, context);
    const normalized = normalizeComparableText(candidate);
    if (!normalized || isLikelyQuestionIdText(candidate)) continue;
    if (!normalizedToOriginal.has(normalized)) {
      normalizedToOriginal.set(normalized, candidate);
    }
  }

  if (normalizedToOriginal.size !== 1) return undefined;
  return normalizedToOriginal.values().next().value;
}

function resolveQuestionTextFromDescriptions(
  items: VerboseDataMapType[],
  parsedByColumn: Map<string, ParsedDescriptionParts>,
  parentId: string,
): string | undefined {
  if (items.length < 2) return undefined;

  const tails: string[] = [];
  for (const item of items) {
    const parsed = parsedByColumn.get(item.column);
    if (!parsed || parsed.parts.length < 2) continue;
    const tail = parsed.parts[parsed.parts.length - 1].trim();
    if (!tail || isLikelyQuestionIdText(tail)) continue;
    tails.push(tail);
  }

  if (tails.length < 2) return undefined;
  const minCount = Math.max(2, Math.ceil(items.length * 0.6));
  const dominant = pickDominantText(tails, minCount);
  if (!dominant) return undefined;
  if (isLikelyQuestionIdText(dominant)) return undefined;
  if (normalizeComparableText(dominant) === normalizeComparableText(parentId)) return undefined;
  return dominant;
}

function parseDescriptionParts(column: string, description: string): ParsedDescriptionParts {
  const body = stripColumnPrefix(column, description);
  return {
    body,
    parts: splitDescriptionParts(body),
  };
}

function stripColumnPrefix(column: string, description: string): string {
  const raw = (description || '').trim();
  if (!raw) return '';

  const prefixPattern = new RegExp(`^${escapeRegex(column)}\\s*:\\s*`, 'i');
  return raw.replace(prefixPattern, '').trim();
}

function splitDescriptionParts(value: string): string[] {
  if (!value) return [];
  return value
    .split(/\s+[—–-]\s+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function extractSubItemLabel(parsed: ParsedDescriptionParts, normalizedQuestion: string): string | undefined {
  if (!normalizedQuestion || parsed.parts.length < 2) return undefined;

  const tail = parsed.parts[parsed.parts.length - 1];
  if (normalizeComparableText(tail) !== normalizedQuestion) return undefined;

  const left = parsed.parts.slice(0, -1).join(' - ').trim();
  return left || undefined;
}

function normalizeContextQuestionText(parentId: string, context: string): string {
  const trimmed = context.trim();
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.+)$/);
  if (!match) return trimmed;

  const [, prefix, remainder] = match;
  if (prefix.toLowerCase() === parentId.toLowerCase() || isLikelyQuestionIdText(prefix)) {
    return remainder.trim();
  }

  return trimmed;
}

function resolveRegroupedQuestionText(sourceGroups: QuestionGroup[], fallbackId: string): string | undefined {
  const candidates: string[] = [];

  for (const group of sourceGroups) {
    const questionText = (group.questionText || '').trim();
    if (questionText && !isLikelyQuestionIdText(questionText)) {
      candidates.push(questionText);
    }

    for (const item of group.items) {
      const context = (item.context || '').trim();
      if (!context) continue;
      const fromContext = normalizeContextQuestionText(fallbackId, context);
      if (fromContext && !isLikelyQuestionIdText(fromContext)) {
        candidates.push(fromContext);
      }
    }
  }

  return pickDominantText(candidates, 1);
}

function pickDominantText(values: string[], minCount: number): string | undefined {
  if (values.length === 0) return undefined;

  const byNormalized = new Map<string, { text: string; count: number }>();
  for (const value of values) {
    const normalized = normalizeComparableText(value);
    if (!normalized) continue;
    const existing = byNormalized.get(normalized);
    if (existing) {
      existing.count += 1;
    } else {
      byNormalized.set(normalized, { text: value.trim(), count: 1 });
    }
  }

  let best: { text: string; count: number } | undefined;
  for (const entry of byNormalized.values()) {
    if (!best) {
      best = entry;
      continue;
    }
    if (entry.count > best.count) {
      best = entry;
      continue;
    }
    if (entry.count === best.count && entry.text.length > best.text.length) {
      best = entry;
    }
  }

  if (!best || best.count < minCount) return undefined;
  return best.text;
}

function normalizeComparableText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function isLikelyQuestionIdText(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^[A-Za-z]+\d+(?:_[A-Za-z0-9]+)?$/i.test(trimmed);
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'at', 'by', 'is', 'are',
  'was', 'were', 'be', 'been', 'being', 'with', 'from', 'that', 'this', 'these', 'those',
  'as', 'it', 'its', 'your', 'you', 'their', 'his', 'her', 'our', 'what', 'which', 'who',
  'whom', 'how', 'when', 'where', 'why', 'do', 'does', 'did', 'have', 'has', 'had',
]);

// =============================================================================
// Utilities
// =============================================================================

/**
 * Get statistics about a grouped datamap
 */
export function getGroupingStats(groups: QuestionGroup[]): {
  totalGroups: number;
  totalItems: number;
  avgItemsPerGroup: number;
  typeDistribution: Record<string, number>;
} {
  const totalItems = groups.reduce((sum, g) => sum + g.items.length, 0);
  const typeDistribution: Record<string, number> = {};

  for (const group of groups) {
    for (const item of group.items) {
      const type = item.normalizedType;
      typeDistribution[type] = (typeDistribution[type] || 0) + 1;
    }
  }

  return {
    totalGroups: groups.length,
    totalItems,
    avgItemsPerGroup: groups.length > 0 ? totalItems / groups.length : 0,
    typeDistribution,
  };
}
