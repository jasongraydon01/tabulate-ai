/**
 * Apply NET Enrichment Results — Deterministic companion table construction
 *
 * Pure function that takes agent-proposed netting instructions and builds
 * companion tables. The original source tables are never modified.
 *
 * For each result where noNetsNeeded=false:
 * 1. Validates component variables exist in the source table
 * 2. Detects NET type (same-variable vs multi-variable)
 * 3. Builds companion rows (NET headers + indented components + flat un-netted)
 * 4. Creates companion table with proper identity and sort order
 * 5. Inserts immediately after the source table in the output
 */

import type {
  CanonicalTableOutput,
  CanonicalTable,
  CanonicalRow,
} from './types';
import type { NetEnrichmentResult, NetGroup } from '../../../../schemas/netEnrichmentSchema';

// ─── Main Function ───────────────────────────────────────────────────────────

export function applyNetEnrichmentResults(
  canonicalOutput: CanonicalTableOutput,
  agentResults: NetEnrichmentResult[],
): CanonicalTableOutput {
  // Build source table lookup
  const sourceTableLookup = new Map<string, CanonicalTable>();
  for (const table of canonicalOutput.tables) {
    sourceTableLookup.set(table.tableId, table);
  }

  // Build companion tables
  const companionsBySourceId = new Map<string, CanonicalTable>();

  for (const result of agentResults) {
    if (result.noNetsNeeded || result.nets.length === 0) {
      continue;
    }

    const sourceTable = sourceTableLookup.get(result.tableId);
    if (!sourceTable) {
      console.warn(`[applyNetEnrichment] Source table "${result.tableId}" not found — skipping`);
      continue;
    }

    const companion = buildCompanionTable(sourceTable, result);
    if (companion) {
      companionsBySourceId.set(sourceTable.tableId, companion);
    }
  }

  if (companionsBySourceId.size === 0) {
    return canonicalOutput;
  }

  // Insert companion tables immediately after their source tables
  const newTables: CanonicalTable[] = [];
  for (const table of canonicalOutput.tables) {
    newTables.push(table);
    const companion = companionsBySourceId.get(table.tableId);
    if (companion) {
      newTables.push(companion);
    }
  }

  // Count additional rows
  let additionalRows = 0;
  for (const companion of companionsBySourceId.values()) {
    additionalRows += companion.rows.length;
  }

  return {
    ...canonicalOutput,
    tables: newTables,
    metadata: {
      ...canonicalOutput.metadata,
      totalTables: newTables.length,
    },
    summary: {
      ...canonicalOutput.summary,
      totalRows: canonicalOutput.summary.totalRows + additionalRows,
    },
  };
}

// ─── Companion Table Builder ─────────────────────────────────────────────────

function buildCompanionTable(
  sourceTable: CanonicalTable,
  result: NetEnrichmentResult,
): CanonicalTable | null {
  const sourceValueRows = sourceTable.rows.filter(r => r.rowKind === 'value');
  if (sourceValueRows.length === 0) {
    console.warn(`[applyNetEnrichment] Source table "${result.tableId}" has no value rows — skipping`);
    return null;
  }

  // Detect NET type: same-variable (categorical_select) vs multi-variable (binary_flag)
  const uniqueVariables = new Set(sourceValueRows.map(r => r.variable));
  const isSameVariable = uniqueVariables.size === 1;
  const sharedVariable = isSameVariable ? sourceValueRows[0].variable : null;

  const resolvedNets = resolveValidNets(result, sourceValueRows, isSameVariable, sharedVariable);
  if (resolvedNets.length === 0) {
    return null;
  }

  // Build companion rows
  const rows = buildCompanionRows(sourceTable, sourceValueRows, resolvedNets, isSameVariable);

  // Build companion table
  return {
    ...sourceTable,
    tableId: `${sourceTable.tableId}__net_summary`,
    sourceTableId: sourceTable.tableId,
    isDerived: true,
    lastModifiedBy: 'NETEnrichmentAgent',
    sortOrder: sourceTable.sortOrder + 0.5,
    tableSubtitle: result.suggestedSubtitle || 'NET Summary',
    splitFromTableId: '',
    splitReason: null,
    rows,
    notes: [...sourceTable.notes, `NET enrichment: ${resolvedNets.length} NET group(s) added`],
  };
}

// ─── Row Construction ────────────────────────────────────────────────────────

interface SourceRowRef {
  row: CanonicalRow;
  index: number;
}

interface ResolvedNetGroup {
  net: NetGroup;
  components: SourceRowRef[];
}

function buildCompanionRows(
  sourceTable: CanonicalTable,
  sourceValueRows: CanonicalRow[],
  resolvedNets: ResolvedNetGroup[],
  isSameVariable: boolean,
): CanonicalRow[] {
  const rows: CanonicalRow[] = [];

  // Track which source row indexes are claimed by a NET (first NET wins on overlap)
  const claimedIndexes = new Set<number>();

  // Add NET groups in agent's proposed order
  let emittedNetIndex = 0;
  for (const resolvedNet of resolvedNets) {
    const availableComponents = resolvedNet.components.filter(ref => !claimedIndexes.has(ref.index));
    if (availableComponents.length < 2) {
      console.warn(
        `[applyNetEnrichment] NET "${resolvedNet.net.netLabel}" for table "${sourceTable.tableId}" has fewer than 2 non-overlapping components — discarding NET`,
      );
      continue;
    }
    for (const ref of availableComponents) {
      claimedIndexes.add(ref.index);
    }

    // Build NET header row
    const netRow = buildNetHeaderRow(sourceTable, resolvedNet.net, emittedNetIndex, isSameVariable, availableComponents);
    rows.push(netRow);
    emittedNetIndex++;

    // Add component rows (in source table order)
    for (const componentRef of availableComponents) {
      rows.push({
        ...componentRef.row,
        indent: 1,
      });
    }
  }

  // Add un-netted rows in their original source order
  for (let index = 0; index < sourceValueRows.length; index++) {
    if (!claimedIndexes.has(index)) {
      const sourceRow = sourceValueRows[index];
      rows.push({
        ...sourceRow,
        indent: 0,
      });
    }
  }

  // Also include non-value rows from source (stat rows, etc.)
  for (const row of sourceTable.rows) {
    if (row.rowKind !== 'value') {
      rows.push({ ...row });
    }
  }

  return rows;
}

function buildNetHeaderRow(
  sourceTable: CanonicalTable,
  net: NetGroup,
  netIndex: number,
  isSameVariable: boolean,
  componentRefs: SourceRowRef[],
): CanonicalRow {
  if (isSameVariable) {
    // Same-variable NET (categorical_select): comma-join filterValues
    const sharedVariable = componentRefs[0].row.variable;
    const filterValues = componentRefs
      .map(ref => ref.row.filterValue)
      .filter(Boolean);

    return {
      variable: sharedVariable,
      label: net.netLabel,
      filterValue: filterValues.join(','),
      rowKind: 'net',
      isNet: true,
      indent: 0,
      netLabel: net.netLabel,
      netComponents: [],
      statType: '',
      binRange: null,
      binLabel: '',
      rankLevel: null,
      topKLevel: null,
      excludeFromStats: false,
      rollupConfig: null,
    };
  } else {
    // Multi-variable NET (binary_flag): use synthetic variable name
    return {
      variable: `_NET_${sourceTable.questionId}_${netIndex}`,
      label: net.netLabel,
      filterValue: '',
      rowKind: 'net',
      isNet: true,
      indent: 0,
      netLabel: net.netLabel,
      netComponents: componentRefs.map(ref => ref.row.variable),
      statType: '',
      binRange: null,
      binLabel: '',
      rankLevel: null,
      topKLevel: null,
      excludeFromStats: false,
      rollupConfig: null,
    };
  }
}

// ─── NET Validation / Resolution ─────────────────────────────────────────────

function resolveValidNets(
  result: NetEnrichmentResult,
  sourceValueRows: CanonicalRow[],
  isSameVariable: boolean,
  sharedVariable: string | null,
): ResolvedNetGroup[] {
  const resolved: ResolvedNetGroup[] = [];

  for (const net of result.nets) {
    const components = resolveNetComponents(net.components, sourceValueRows, isSameVariable, sharedVariable);
    if (!components.ok) {
      console.warn(
        `[applyNetEnrichment] NET "${net.netLabel}" for table "${result.tableId}" is invalid: ${components.reason} — discarding NET`,
      );
      continue;
    }
    if (components.rows.length < 2) {
      console.warn(
        `[applyNetEnrichment] NET "${net.netLabel}" for table "${result.tableId}" has fewer than 2 components — discarding NET`,
      );
      continue;
    }

    resolved.push({ net, components: components.rows });
  }

  return resolved;
}

type ComponentResolutionResult =
  | { ok: true; rows: SourceRowRef[] }
  | { ok: false; rows: SourceRowRef[]; reason: string };

function resolveNetComponents(
  componentTokens: string[],
  sourceValueRows: CanonicalRow[],
  isSameVariable: boolean,
  sharedVariable: string | null,
): ComponentResolutionResult {
  if (componentTokens.length === 0) {
    return { ok: false, rows: [], reason: 'no components provided' };
  }

  return isSameVariable
    ? resolveSameVariableComponents(componentTokens, sourceValueRows, sharedVariable)
    : resolveMultiVariableComponents(componentTokens, sourceValueRows);
}

function resolveMultiVariableComponents(
  componentTokens: string[],
  sourceValueRows: CanonicalRow[],
): ComponentResolutionResult {
  const rowRefsByVariable = new Map<string, SourceRowRef>();
  for (let index = 0; index < sourceValueRows.length; index++) {
    const row = sourceValueRows[index];
    if (!rowRefsByVariable.has(row.variable)) {
      rowRefsByVariable.set(row.variable, { row, index });
    }
  }

  const chosen = new Map<number, SourceRowRef>();
  const unknown: string[] = [];

  for (const token of componentTokens) {
    const ref = rowRefsByVariable.get(token);
    if (!ref) {
      unknown.push(token);
      continue;
    }
    chosen.set(ref.index, ref);
  }

  if (unknown.length > 0) {
    return {
      ok: false,
      rows: [],
      reason: `unknown components: ${unknown.join(', ')}`,
    };
  }

  return {
    ok: true,
    rows: Array.from(chosen.values()).sort((a, b) => a.index - b.index),
  };
}

function resolveSameVariableComponents(
  componentTokens: string[],
  sourceValueRows: CanonicalRow[],
  sharedVariable: string | null,
): ComponentResolutionResult {
  if (!sharedVariable) {
    return { ok: false, rows: [], reason: 'table does not expose a shared variable' };
  }

  const refsByFilter = new Map<string, SourceRowRef[]>();
  const orderedRefs: SourceRowRef[] = [];
  for (let index = 0; index < sourceValueRows.length; index++) {
    const row = sourceValueRows[index];
    orderedRefs.push({ row, index });
    if (!refsByFilter.has(row.filterValue)) {
      refsByFilter.set(row.filterValue, []);
    }
    refsByFilter.get(row.filterValue)!.push({ row, index });
  }

  const chosen = new Map<number, SourceRowRef>();
  const unknown: string[] = [];
  let nextSequentialIndex = 0;

  for (const rawToken of componentTokens) {
    const token = rawToken.trim();
    if (!token) continue;

    const parsed = parseSameVariableToken(token, sharedVariable);
    if (!parsed.ok) {
      unknown.push(rawToken);
      continue;
    }
    if (parsed.filterValue == null) {
      // Backward-compatible fallback for same-variable components that only
      // name the shared variable: map each mention to the next unselected row
      // in source order.
      while (
        nextSequentialIndex < orderedRefs.length &&
        chosen.has(orderedRefs[nextSequentialIndex].index)
      ) {
        nextSequentialIndex++;
      }
      const sequentialRef = orderedRefs[nextSequentialIndex];
      if (!sequentialRef) {
        unknown.push(rawToken);
        continue;
      }
      chosen.set(sequentialRef.index, sequentialRef);
      nextSequentialIndex++;
      continue;
    }

    const refs = refsByFilter.get(parsed.filterValue);
    if (!refs || refs.length === 0) {
      unknown.push(rawToken);
      continue;
    }

    // Choose first not-yet-selected row for this filter.
    const chosenRef = refs.find(ref => !chosen.has(ref.index)) ?? refs[0];
    chosen.set(chosenRef.index, chosenRef);
  }

  if (unknown.length > 0) {
    return {
      ok: false,
      rows: [],
      reason: `unknown components: ${unknown.join(', ')}`,
    };
  }

  return {
    ok: true,
    rows: Array.from(chosen.values()).sort((a, b) => a.index - b.index),
  };
}

function parseSameVariableToken(
  token: string,
  sharedVariable: string,
): { ok: true; filterValue: string | null } | { ok: false } {
  const separatorIndex = token.search(/[:|=]/);
  if (separatorIndex > 0) {
    const variablePart = token.slice(0, separatorIndex).trim();
    const filterValuePart = token.slice(separatorIndex + 1).trim();
    if (variablePart !== sharedVariable || !filterValuePart) {
      return { ok: false };
    }
    return { ok: true, filterValue: filterValuePart };
  }

  // For same-variable tables, plain filter values are unambiguous and preferred.
  if (token !== sharedVariable) {
    return { ok: true, filterValue: token };
  }

  // A bare shared variable token is ambiguous when multiple rows share that variable.
  return { ok: true, filterValue: null };
}
