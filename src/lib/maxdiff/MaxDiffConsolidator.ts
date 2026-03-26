/**
 * MaxDiff Table Consolidator
 *
 * Deterministic processor (no AI) that merges N individual MaxDiff score tables
 * into composite tables — one per score family. Runs after the survey filter
 * and before distribution extension / verification.
 *
 * Input:  TableAgentOutput[] (groups from survey filter, some are MaxDiff score families)
 * Output: TableAgentOutput[] (same array, but MaxDiff score groups replaced with consolidated ones)
 *
 * Consolidated tables have `tableType: 'mean_rows'` and one row per message
 * (excluding the anchor variable). When alternates are detected (e.g. I1 + I1A),
 * they are grouped into a single row with a combined label.
 */

import type { DetectedFamily, MaxDiffFamilyDetectionResult } from './detectMaxDiffFamilies';
import type { TableAgentOutput } from '@/schemas/tableAgentSchema';
import { parseMaxDiffLabel, formatMaxDiffDisplayLabel } from './parseMaxDiffLabel';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ConsolidationResult {
  /** Modified table groups (non-MaxDiff unchanged, MaxDiff score groups replaced) */
  groups: TableAgentOutput[];
  /** Consolidation report */
  report: ConsolidationReport;
}

export interface ConsolidationReport {
  /** Families that were consolidated */
  consolidatedFamilies: string[];
  /** Total individual tables consumed by consolidation */
  tablesConsumed: number;
  /** Total consolidated tables produced */
  tablesProduced: number;
  /** Anchor variables excluded */
  anchorsExcluded: string[];
  /** Alternate groups detected and merged (e.g., ["I1/I1A", "E1/E1A"]) */
  alternateGroups: string[];
  /** Per-family details */
  details: {
    family: string;
    displayName: string;
    inputGroups: number;
    outputRows: number;
    anchorExcluded: string | null;
  }[];
}

export interface ConsolidationOptions {
  /** Whether to group alternate message variants (default: true) */
  groupAlternates?: boolean;
  /** Whether to enhance labels using parseMaxDiffLabel (default: true) */
  enhanceLabels?: boolean;
  /** Map of variant code → primary code (case-insensitive uppercase keys) from enrichment */
  variantOfMap?: Map<string, string>;
}

// ─── Consolidator ────────────────────────────────────────────────────────────

/**
 * Consolidate MaxDiff score tables from individual per-variable tables into
 * composite tables — one per score family.
 *
 * Non-MaxDiff groups pass through completely unchanged.
 *
 * @param groups - Table groups from the survey filter stage
 * @param detection - MaxDiff family detection result from detectMaxDiffFamilies()
 * @param options - Optional consolidation settings
 * @returns Consolidated groups + report
 */
export function consolidateMaxDiffTables(
  groups: TableAgentOutput[],
  detection: MaxDiffFamilyDetectionResult,
  options: ConsolidationOptions = {},
): ConsolidationResult {
  const { groupAlternates = true, enhanceLabels = true, variantOfMap } = options;

  if (!detection.detected) {
    return {
      groups,
      report: {
        consolidatedFamilies: [],
        tablesConsumed: 0,
        tablesProduced: 0,
        anchorsExcluded: [],
        alternateGroups: [],
        details: [],
      },
    };
  }

  // Build a lookup: questionId → DetectedFamily (for publishable families only)
  const publishableFamilies = new Map<string, DetectedFamily>();
  const publishableVariableToFamily = new Map<string, string>();
  for (const family of detection.families) {
    if (family.publishable) {
      publishableFamilies.set(family.name, family);
      for (const variable of family.variables) {
        publishableVariableToFamily.set(variable, family.name);
      }
    }
  }

  // Partition groups into MaxDiff score families vs everything else
  const maxdiffGroupsByFamily = new Map<string, TableAgentOutput[]>();
  const nonMaxDiffGroups: TableAgentOutput[] = [];

  for (const group of groups) {
    const familyName = publishableFamilies.has(group.questionId)
      ? group.questionId
      : publishableVariableToFamily.get(group.questionId);

    if (familyName) {
      if (!maxdiffGroupsByFamily.has(familyName)) {
        maxdiffGroupsByFamily.set(familyName, []);
      }
      maxdiffGroupsByFamily.get(familyName)!.push(group);
    } else {
      nonMaxDiffGroups.push(group);
    }
  }

  // Consolidate each family
  const consolidatedGroups: TableAgentOutput[] = [];
  const reportDetails: ConsolidationReport['details'] = [];
  let totalTablesConsumed = 0;
  const anchorsExcluded: string[] = [];
  const alternateGroups: string[] = [];

  for (const [familyName, familyGroups] of maxdiffGroupsByFamily) {
    const family = publishableFamilies.get(familyName)!;

    // Collect all rows from all tables in this family's groups
    const allRows: { variable: string; label: string }[] = [];
    let tablesConsumed = 0;

    for (const group of familyGroups) {
      for (const table of group.tables) {
        for (const row of table.rows) {
          // Skip anchor variables
          if (family.anchorVariable && row.variable === family.anchorVariable) {
            anchorsExcluded.push(row.variable);
            continue;
          }
          allRows.push({
            variable: row.variable,
            label: row.label,
          });
        }
        tablesConsumed++;
      }
    }

    totalTablesConsumed += tablesConsumed;

    // Sort rows by numeric suffix to maintain consistent order
    allRows.sort((a, b) => {
      const suffixA = parseInt(a.variable.match(/_(\d+)$/)?.[1] ?? '0', 10);
      const suffixB = parseInt(b.variable.match(/_(\d+)$/)?.[1] ?? '0', 10);
      return suffixA - suffixB;
    });

    // Enhance labels using the parser (if enabled)
    let processedRows = allRows;
    if (enhanceLabels) {
      processedRows = allRows.map(row => {
        const parsed = parseMaxDiffLabel(row.label);
        if (parsed) {
          return { ...row, label: formatMaxDiffDisplayLabel(parsed) };
        }
        return row;
      });
    }

    // Group alternates (if enabled)
    let finalRows: { variable: string; label: string; userNote?: string }[];
    if (groupAlternates) {
      const { rows, groups: altGroups } = groupAlternateRows(processedRows, variantOfMap);
      finalRows = rows;
      alternateGroups.push(...altGroups);
    } else {
      finalRows = processedRows;
    }

    // Build the consolidated table
    const scaleNote = family.scale ? ` (${family.scale})` : '';
    const consolidatedTable: TableAgentOutput = {
      questionId: familyName,
      questionText: `${family.displayName}${scaleNote}`,
      tables: [{
        tableId: `maxdiff_${familyName.toLowerCase()}`,
        questionText: `${family.displayName}${scaleNote}`,
        tableType: 'mean_rows',
        rows: finalRows.map(r => ({
          variable: r.variable,
          label: r.label,
          filterValue: '', // Always empty for mean_rows
        })),
        hints: [], // Deprecated field — always empty for new tables
      }],
      confidence: 1.0,
      reasoning: `Consolidated from ${tablesConsumed} individual ${familyName} tables by MaxDiffConsolidator`,
    };

    consolidatedGroups.push(consolidatedTable);

    reportDetails.push({
      family: familyName,
      displayName: family.displayName,
      inputGroups: tablesConsumed,
      outputRows: finalRows.length,
      anchorExcluded: family.anchorVariable ?? null,
    });
  }

  // Combine: non-MaxDiff groups first, then consolidated MaxDiff tables
  const result = [...nonMaxDiffGroups, ...consolidatedGroups];

  return {
    groups: result,
    report: {
      consolidatedFamilies: [...maxdiffGroupsByFamily.keys()],
      tablesConsumed: totalTablesConsumed,
      tablesProduced: consolidatedGroups.length,
      anchorsExcluded,
      alternateGroups,
      details: reportDetails,
    },
  };
}

// ─── Alternate Grouping ──────────────────────────────────────────────────────

interface AlternateGroupResult {
  rows: { variable: string; label: string; userNote?: string }[];
  groups: string[];
}

/**
 * Group alternate message variants into single rows.
 *
 * When `variantOfMap` has entries, uses explicit variant→primary mappings.
 * Otherwise, falls back to label-based pattern detection ("I1 / I1A" slash pattern).
 */
function groupAlternateRows(
  rows: { variable: string; label: string }[],
  variantOfMap?: Map<string, string>,
): AlternateGroupResult {
  // Use variantOf-driven grouping when explicit mappings are provided
  if (variantOfMap && variantOfMap.size > 0) {
    return groupByVariantOf(rows, variantOfMap);
  }
  return groupByLabelPattern(rows);
}

/**
 * Group alternates using explicit variantOf mappings.
 *
 * Builds primary→variants map, then merges variant rows into their primary's
 * label as "P1 / P1A: text". Standalone variant rows are removed.
 */
function groupByVariantOf(
  rows: { variable: string; label: string }[],
  variantOfMap: Map<string, string>,
): AlternateGroupResult {
  // Build primary → variants lookup (reverse of variantOfMap)
  const primaryToVariants = new Map<string, string[]>();
  for (const [variantCode, primaryCode] of variantOfMap) {
    if (!primaryToVariants.has(primaryCode)) {
      primaryToVariants.set(primaryCode, []);
    }
    primaryToVariants.get(primaryCode)!.push(variantCode);
  }

  // Extract code from each row's label
  const rowCodes = rows.map(row => {
    const parsed = parseMaxDiffLabel(row.label);
    if (parsed && !parsed.isAnchor) return parsed.messageCode.toUpperCase();
    // Try enhanced label format "CODE: text"
    const match = row.label.match(/^(\w+)\s*(?:\/\s*\w+\s*)?:/);
    return match?.[1]?.toUpperCase();
  });

  const detectedGroups: string[] = [];
  const variantCodesConsumed = new Set<string>();

  // Identify which rows are variants that should be merged
  const resultRows: { variable: string; label: string; userNote?: string }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const code = rowCodes[i];
    if (!code) {
      resultRows.push(rows[i]);
      continue;
    }

    // Skip if this row is a variant that's been consumed by its primary
    if (variantCodesConsumed.has(code)) continue;

    // Check if this row IS a variant of another primary
    if (variantOfMap.has(code)) {
      // Will be merged into primary row — skip standalone
      variantCodesConsumed.add(code);
      continue;
    }

    // Check if this row is a primary that has variants
    const variants = primaryToVariants.get(code);
    if (variants && variants.length > 0) {
      const variantCodes = variants.sort();
      for (const vc of variantCodes) variantCodesConsumed.add(vc);
      detectedGroups.push(`${code}/${variantCodes.join('/')}`);

      // Rebuild label as "P1 / P1A: text"
      const codePart = `${code} / ${variantCodes.join(' / ')}`;
      const textMatch = rows[i].label.match(/:\s*(.+)$/);
      const text = textMatch?.[1] ?? '';
      const newLabel = text ? `${codePart}: ${text}` : codePart;

      resultRows.push({
        variable: rows[i].variable,
        label: newLabel,
        userNote: `Combined score for message variants ${code} and ${variantCodes.join(', ')}`,
      });
    } else {
      resultRows.push(rows[i]);
    }
  }

  return { rows: resultRows, groups: detectedGroups };
}

/**
 * Group alternates by label pattern (legacy fallback).
 *
 * Two scenarios:
 * 1. The "OR ALT" pattern in a label (e.g., "I1 OR ALT I1A") indicates the
 *    variable represents a combined pair. The label is already formatted as
 *    "I1 / I1A: text" by the label enhancer. We detect these and report them.
 *
 * 2. If a separate variable exists for the alternate code (e.g., one variable
 *    for I1 and another for I1A), the alternate's row is removed and the
 *    primary row represents both.
 */
function groupByLabelPattern(
  rows: { variable: string; label: string }[],
): AlternateGroupResult {
  // Parse original (raw) labels to detect alternates — use raw labels, not enhanced
  // Note: rows already have enhanced labels at this point, but we re-parse to detect alternates
  const parsedRows = rows.map(row => {
    // Enhanced labels look like "I1 / I1A: text" — won't match LABEL_PATTERN.
    // But original labels (unenhanced) would. For enhanced labels, detect alternate from the "/"
    const slashMatch = row.label.match(/^(\w+)\s*\/\s*(\w+)/);
    return {
      ...row,
      primaryCode: slashMatch?.[1],
      alternateCode: slashMatch?.[2],
      isAlternate: !!slashMatch,
    };
  });

  const detectedGroups: string[] = [];
  const altCodesConsumed = new Set<string>();

  // Find alternates: rows where label shows "X / XA: text"
  for (const row of parsedRows) {
    if (row.isAlternate && row.primaryCode && row.alternateCode) {
      detectedGroups.push(`${row.primaryCode}/${row.alternateCode}`);
      altCodesConsumed.add(row.alternateCode);
    }
  }

  // Remove rows whose primary code matches a consumed alternate code
  // (separate variable for the alternate variant — redundant with the combined row)
  const resultRows: { variable: string; label: string; userNote?: string }[] = [];
  for (const row of parsedRows) {
    // Check if this row is a standalone alternate that's already represented
    const rowCode = row.label.match(/^(\w+):/)?.[1];
    if (rowCode && altCodesConsumed.has(rowCode)) {
      // This row is a standalone alternate variable — skip it (combined row covers it)
      continue;
    }

    resultRows.push({
      variable: row.variable,
      label: row.label,
      ...(row.isAlternate && row.primaryCode && row.alternateCode && {
        userNote: `Combined score for message variants ${row.primaryCode} and ${row.alternateCode}`,
      }),
    });
  }

  return { rows: resultRows, groups: detectedGroups };
}
