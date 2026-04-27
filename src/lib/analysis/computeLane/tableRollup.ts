import { downloadFile } from "@/lib/r2/r2";
import { parseRunResult } from "@/schemas/runResultSchema";
import { mutateInternal } from "@/lib/convex";
import { internal } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  fetchTable,
  type AnalysisGroundingContext,
} from "@/lib/analysis/grounding";
import type {
  AnalysisTableCard,
  AnalysisTableCardCell,
  AnalysisTableCardColumn,
  AnalysisTableCardRow,
} from "@/lib/analysis/types";
import type {
  AnalysisTableRollupMechanism,
  AnalysisTableRollupResolvedOutputRow,
  AnalysisTableRollupSpec,
  AnalysisTableRollupSourceTableSpec,
} from "@/lib/analysis/computeLane/types";
import { assertAnalysisTableRollupSpecV2 } from "@/lib/analysis/computeLane/types";
import { buildAnalysisTableRollupFingerprint } from "@/lib/analysis/computeLane/fingerprint";

const TABLE_ENRICHED_PATH = "tables/13e-table-enriched.json";
const TABLE_CANONICAL_PATH = "tables/13d-table-canonical.json";
const MAX_SOURCE_TABLES = 1;
const MAX_OUTPUT_ROWS_PER_TABLE = 4;
const MAX_SOURCE_ROWS_PER_OUTPUT_ROW = 12;

export interface AnalysisTableRollupCandidate {
  tableId: string;
  outputRows: Array<{
    label: string;
    sourceRows: Array<{ rowKey: string }>;
  }>;
}

export type AnalysisTableRollupToolResult =
  | {
      status: "validated_proposal";
      jobId: string;
      jobType: "table_rollup_derivation";
      message: string;
      sourceTable: AnalysisTableRollupSourceTableSpec;
      outputRows: AnalysisTableRollupSpec["outputRows"];
    }
  | {
      status: "rejected_candidate";
      message: string;
      reasons: string[];
      repairHints: string[];
      invalidTableIds: string[];
      invalidRowRefs: Array<{ tableId: string; rowRef: string }>;
      ineligibleRows: Array<{ tableId: string; rowKey: string; label: string; reason: string }>;
      unsupportedCombinations: string[];
      blockedMechanisms: Array<{
        label: string;
        mechanism: AnalysisTableRollupMechanism;
        reason: string;
      }>;
    };

interface CanonicalRow {
  rowKey?: string;
  variable?: string;
  label?: string;
  filterValue?: string;
  rowKind?: string;
  isNet?: boolean;
}

interface CanonicalTable {
  tableId?: string;
  rows?: CanonicalRow[];
}

interface ParentRunForRollup {
  _id: Id<"runs">;
  status: string;
  result?: unknown;
  expiredAt?: number;
  artifactsPurgedAt?: number;
}

interface ValidationRejection {
  reasons: string[];
  repairHints: string[];
  invalidTableIds: string[];
  invalidRowRefs: Array<{ tableId: string; rowRef: string }>;
  ineligibleRows: Array<{ tableId: string; rowKey: string; label: string; reason: string }>;
  unsupportedCombinations: string[];
  blockedMechanisms: Array<{
    label: string;
    mechanism: AnalysisTableRollupMechanism;
    reason: string;
  }>;
}

function emptyRejection(): ValidationRejection {
  return {
    reasons: [],
    repairHints: [],
    invalidTableIds: [],
    invalidRowRefs: [],
    ineligibleRows: [],
    unsupportedCombinations: [],
    blockedMechanisms: [],
  };
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

async function downloadJson<T>(key: string): Promise<T> {
  const buffer = await downloadFile(key);
  return JSON.parse(buffer.toString("utf-8")) as T;
}

async function loadCanonicalTables(runResultValue: unknown): Promise<Map<string, CanonicalTable>> {
  const runResult = parseRunResult(runResultValue);
  const outputs = runResult?.r2Files?.outputs ?? {};
  const key = outputs[TABLE_ENRICHED_PATH] ?? outputs[TABLE_CANONICAL_PATH] ?? null;
  if (!key) return new Map();

  const raw = await downloadJson<unknown>(key);
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const tables = Array.isArray(record.tables) ? record.tables : [];
  const byId = new Map<string, CanonicalTable>();
  for (const entry of tables) {
    if (!entry || typeof entry !== "object") continue;
    const table = entry as CanonicalTable;
    if (typeof table.tableId === "string") byId.set(table.tableId, table);
  }
  return byId;
}

function findRow(card: AnalysisTableCard, ref: { rowKey?: string; label?: string }): AnalysisTableCardRow | null {
  if (ref.rowKey) {
    const byKey = card.rows.find((row) => row.rowKey === ref.rowKey);
    if (byKey) return byKey;
  }

  const normalizedLabel = normalizeText(ref.label);
  if (!normalizedLabel) return null;
  return card.rows.find((row) => normalizeText(row.label) === normalizedLabel) ?? null;
}

function findRowByExactKey(card: AnalysisTableCard, rowKey: string): AnalysisTableCardRow | null {
  return card.rows.find((row) => row.rowKey === rowKey) ?? null;
}

function findCanonicalRow(params: {
  canonical: CanonicalTable;
  card: AnalysisTableCard;
  row: AnalysisTableCardRow;
}): CanonicalRow | null {
  const rows = params.canonical.rows ?? [];
  const rowIndex = params.card.rows.findIndex((entry) => entry.rowKey === params.row.rowKey);
  const indexed = rowIndex >= 0 ? rows[rowIndex] : null;
  if (
    indexed
    && normalizeText(indexed.label) === normalizeText(params.row.label)
    && (indexed.rowKind ?? params.row.rowKind) === params.row.rowKind
  ) {
    return indexed;
  }

  const byRowKey = rows.find((candidate) => candidate.rowKey === params.row.rowKey);
  if (byRowKey) return byRowKey;

  const labelMatches = rows.filter((candidate) =>
    normalizeText(candidate.label) === normalizeText(params.row.label)
    && (candidate.rowKind ?? params.row.rowKind) === params.row.rowKind
    && Boolean(candidate.filterValue)
  );
  return labelMatches.length === 1 ? labelMatches[0]! : null;
}

function getAtomicFilterValue(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (trimmed.includes(",") || trimmed.includes(":") || trimmed.includes("-")) return null;
  return trimmed;
}

function getCell(row: AnalysisTableCardRow, column: AnalysisTableCardColumn): AnalysisTableCardCell | null {
  const cutKey = column.cutKey ?? column.cutName;
  return row.cellsByCutKey?.[cutKey]
    ?? row.values.find((value) => value.cutKey === cutKey || value.cutName === column.cutName)
    ?? null;
}

function buildRollupCell(params: {
  componentRows: AnalysisTableCardRow[];
  column: AnalysisTableCardColumn;
}): AnalysisTableCardCell | null {
  const componentCells = params.componentRows.map((row) => getCell(row, params.column));
  if (componentCells.some((cell) => !cell)) return null;

  const counts = componentCells.map((cell) => cell?.count).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const bases = componentCells.map((cell) => cell?.n ?? params.column.baseN).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (counts.length !== componentCells.length || bases.length !== componentCells.length) return null;

  const base = bases[0];
  if (base === undefined || base === null || bases.some((value) => Math.abs(value - base) > 0.000001)) return null;
  const count = counts.reduce((sum, value) => sum + value, 0);
  if (count > base + 0.000001) return null;
  if (base === 0) {
    if (Math.abs(count) > 0.000001) return null;
    return {
      cutKey: params.column.cutKey,
      cutName: params.column.cutName,
      rawValue: 0,
      displayValue: "0%",
      count: 0,
      pct: 0,
      n: 0,
      mean: null,
      sigHigherThan: [],
      sigVsTotal: null,
    };
  }
  const pct = (count / base) * 100;

  return {
    cutKey: params.column.cutKey,
    cutName: params.column.cutName,
    rawValue: pct,
    displayValue: `${pct.toFixed(0)}%`,
    count,
    pct,
    n: base,
    mean: null,
      sigHigherThan: [],
      sigVsTotal: null,
  };
}

function cloneTableRow(row: AnalysisTableCardRow): AnalysisTableCardRow {
  const values = row.values.map((value) => ({
    ...value,
    sigHigherThan: [...value.sigHigherThan],
  }));
  return {
    ...row,
    values,
    cellsByCutKey: row.cellsByCutKey
      ? Object.fromEntries(Object.entries(row.cellsByCutKey).map(([key, value]) => [
          key,
          { ...value, sigHigherThan: [...value.sigHigherThan] },
        ]))
      : undefined,
  };
}

function buildRejectedResult(rejection: ValidationRejection): AnalysisTableRollupToolResult {
  return {
    status: "rejected_candidate",
    message: "TabulateAI could not validate that roll-up candidate. Use the repair hints, fetch the source table again if needed, and retry only if the fix is clear from the artifacts.",
    reasons: uniqueStrings(rejection.reasons),
    repairHints: uniqueStrings(rejection.repairHints),
    invalidTableIds: uniqueStrings(rejection.invalidTableIds),
    invalidRowRefs: rejection.invalidRowRefs,
    ineligibleRows: rejection.ineligibleRows,
    unsupportedCombinations: uniqueStrings(rejection.unsupportedCombinations),
    blockedMechanisms: rejection.blockedMechanisms,
  };
}

function isSameVariableExclusiveCandidate(canonicalRows: CanonicalRow[]): boolean {
  const variables = uniqueStrings(canonicalRows.map((row) => row.variable ?? ""));
  if (variables.length !== 1) return false;
  const filterValues = canonicalRows
    .map((row) => getAtomicFilterValue(row.filterValue))
    .filter((value): value is string => Boolean(value));
  return filterValues.length === canonicalRows.length
    && new Set(filterValues).size === filterValues.length;
}

function isResolvedArtifactExclusiveSumCandidate(
  sourceRows: AnalysisTableRollupResolvedOutputRow["sourceRows"],
): boolean {
  const variables = uniqueStrings(sourceRows.map((row) => row.variable));
  if (variables.length !== 1) return false;
  const filterValues = sourceRows
    .map((row) => getAtomicFilterValue(row.filterValue))
    .filter((value): value is string => Boolean(value));
  return filterValues.length === sourceRows.length
    && new Set(filterValues).size === filterValues.length;
}

function isRespondentAnyOfCandidate(canonicalRows: CanonicalRow[]): boolean {
  const variables = uniqueStrings(canonicalRows.map((row) => row.variable ?? ""));
  if (variables.length < 2) return false;
  const filterValues = canonicalRows
    .map((row) => getAtomicFilterValue(row.filterValue))
    .filter((value): value is string => Boolean(value));
  return filterValues.length === canonicalRows.length
    && filterValues.every((value) => value === "1")
    && new Set(variables).size === canonicalRows.length;
}

function isMetricAggregationCandidate(table: AnalysisTableCard, canonicalRows: CanonicalRow[]): boolean {
  if (table.tableType !== "mean_rows") return false;
  const variables = uniqueStrings(canonicalRows.map((row) => row.variable ?? ""));
  return variables.length === canonicalRows.length;
}

function buildResolvedSourceRows(
  componentRows: AnalysisTableCardRow[],
  canonicalRows: CanonicalRow[],
): AnalysisTableRollupResolvedOutputRow["sourceRows"] {
  return componentRows.map((row, index) => ({
    rowKey: row.rowKey,
    label: row.label,
    variable: canonicalRows[index]?.variable ?? "",
    filterValue: canonicalRows[index]?.filterValue ?? "",
  }));
}

export async function createAnalysisTableRollupProposal(params: {
  orgId: Id<"organizations">;
  projectId: Id<"projects">;
  parentRunId: Id<"runs">;
  sessionId: Id<"analysisSessions">;
  requestedBy: Id<"users">;
  requestText: string;
  candidates: AnalysisTableRollupCandidate[];
  parentRun: ParentRunForRollup;
  groundingContext: AnalysisGroundingContext;
}): Promise<AnalysisTableRollupToolResult> {
  const rejection = emptyRejection();
  const requestText = params.requestText.trim();
  if (!requestText) {
    rejection.reasons.push("Request text is required.");
  }
  if (params.parentRun.status !== "success" && params.parentRun.status !== "partial") {
    rejection.reasons.push("Analysis compute requires a completed parent run.");
  }
  if (params.parentRun.expiredAt || params.parentRun.artifactsPurgedAt) {
    rejection.reasons.push("Parent run artifacts have expired.");
  }
  if (params.candidates.length === 0 || params.candidates.length > MAX_SOURCE_TABLES) {
    rejection.reasons.push("Choose exactly 1 source table for a Slice 3 table roll-up.");
  }

  const canonicalTables = await loadCanonicalTables(params.parentRun.result);
  let sourceTable: AnalysisTableRollupSourceTableSpec | null = null;
  const outputRows: AnalysisTableRollupSpec["outputRows"] = [];
  const resolvedOutputRows: AnalysisTableRollupResolvedOutputRow[] = [];
  const globallyUsedSourceRowKeys = new Set<string>();

  for (const candidate of params.candidates.slice(0, MAX_SOURCE_TABLES)) {
    const tableResult = fetchTable(params.groundingContext, { tableId: candidate.tableId, cutGroups: "*" });
    if (tableResult.status !== "available") {
      rejection.invalidTableIds.push(candidate.tableId);
      rejection.repairHints.push(`Search or fetch the table again; ${candidate.tableId} was not available.`);
      continue;
    }

    const canonical = canonicalTables.get(candidate.tableId);
    if (!canonical?.rows?.length) {
      rejection.unsupportedCombinations.push(`Table ${candidate.tableId} is missing canonical row metadata needed to validate artifact-safe roll-ups.`);
      continue;
    }

    sourceTable = {
      tableId: tableResult.tableId,
      title: tableResult.title,
      questionId: tableResult.questionId,
      questionText: tableResult.questionText,
    };

    if (candidate.outputRows.length === 0 || candidate.outputRows.length > MAX_OUTPUT_ROWS_PER_TABLE) {
      rejection.reasons.push(`Table ${candidate.tableId} needs between 1 and ${MAX_OUTPUT_ROWS_PER_TABLE} output rows.`);
      continue;
    }

    for (const outputRow of candidate.outputRows) {
      const label = outputRow.label.trim();
      if (!label) {
        rejection.reasons.push(`A roll-up on ${candidate.tableId} is missing a label.`);
        continue;
      }
      if (outputRow.sourceRows.length < 2) {
        rejection.reasons.push(`Roll-up "${label}" on ${candidate.tableId} needs at least two component rows.`);
        continue;
      }
      if (outputRow.sourceRows.length > MAX_SOURCE_ROWS_PER_OUTPUT_ROW) {
        rejection.reasons.push(`Roll-up "${label}" on ${candidate.tableId} uses more than ${MAX_SOURCE_ROWS_PER_OUTPUT_ROW} source rows.`);
        continue;
      }

      const componentRows: AnalysisTableCardRow[] = [];
      const canonicalRows: CanonicalRow[] = [];
      for (const ref of outputRow.sourceRows) {
        const row = findRow(tableResult, ref);
        if (!row) {
          rejection.invalidRowRefs.push({ tableId: candidate.tableId, rowRef: ref.rowKey });
          rejection.repairHints.push(`Fetch table ${candidate.tableId} again and use exact rowKey values from the table output.`);
          continue;
        }
        const canonicalRow = findCanonicalRow({ canonical, card: tableResult, row });
        if (!canonicalRow) {
          rejection.ineligibleRows.push({ tableId: candidate.tableId, rowKey: row.rowKey, label: row.label, reason: "Missing canonical row metadata." });
          continue;
        }
        if (row.rowKind !== "value" || row.isNet || canonicalRow.rowKind !== "value" || canonicalRow.isNet) {
          rejection.ineligibleRows.push({ tableId: candidate.tableId, rowKey: row.rowKey, label: row.label, reason: "Only non-NET answer option rows can be used in Slice 3 roll-ups." });
          continue;
        }
        if (!canonicalRow.variable) {
          rejection.ineligibleRows.push({ tableId: candidate.tableId, rowKey: row.rowKey, label: row.label, reason: "The row is missing source variable metadata." });
          continue;
        }
        componentRows.push(row);
        canonicalRows.push(canonicalRow);
      }

      if (componentRows.length !== outputRow.sourceRows.length || canonicalRows.length !== outputRow.sourceRows.length) continue;

      const rowKeys = componentRows.map((row) => row.rowKey);
      if (new Set(rowKeys).size !== rowKeys.length) {
        rejection.unsupportedCombinations.push(`Roll-up "${label}" on ${candidate.tableId} repeats the same source row more than once.`);
        continue;
      }
      const reusedRows = rowKeys.filter((rowKey) => globallyUsedSourceRowKeys.has(rowKey));
      if (reusedRows.length > 0) {
        rejection.unsupportedCombinations.push(`Roll-up "${label}" on ${candidate.tableId} reuses source rows already assigned to another output row (${uniqueStrings(reusedRows).join(", ")}).`);
        continue;
      }

      let mechanism: AnalysisTableRollupMechanism | null = null;
      if (isSameVariableExclusiveCandidate(canonicalRows)) {
        mechanism = "artifact_exclusive_sum";
      } else if (isRespondentAnyOfCandidate(canonicalRows)) {
        mechanism = "respondent_any_of";
      } else if (isMetricAggregationCandidate(tableResult, canonicalRows)) {
        mechanism = "metric_row_aggregation";
      }

      if (!mechanism) {
        rejection.unsupportedCombinations.push(`Roll-up "${label}" on ${candidate.tableId} does not preserve a supported table roll-up shape.`);
        rejection.repairHints.push("Choose existing rows that collapse into one row without changing the table's analytical meaning.");
        continue;
      }

      if (mechanism === "respondent_any_of") {
        const reason = "This is a valid multi-select row-collapse shape, but respondent-level any-of roll-up compute is not available from the current analysis artifacts yet.";
        rejection.blockedMechanisms.push({ label, mechanism, reason });
        rejection.repairHints.push("TabulateAI recognized this as a respondent-level any-of roll-up. It needs respondent-level compute support before a proposal can be created.");
        continue;
      }

      if (mechanism === "metric_row_aggregation") {
        const reason = "This is a valid table-preserving metric roll-up shape, but metric-specific aggregation compute is not available from the current analysis artifacts yet.";
        rejection.blockedMechanisms.push({ label, mechanism, reason });
        rejection.repairHints.push("TabulateAI recognized this as a metric/average-style roll-up. It needs metric-specific compute support before a proposal can be created.");
        continue;
      }

      for (const column of tableResult.columns) {
        const cell = buildRollupCell({ componentRows, column });
        if (!cell) {
          rejection.blockedMechanisms.push({
            label,
            mechanism,
            reason: `Roll-up "${label}" on ${candidate.tableId} cannot be computed with compatible counts and bases for every column.`,
          });
          break;
        }
      }
      if (rejection.blockedMechanisms.some((entry) => entry.label === label && entry.mechanism === mechanism)) continue;

      const sourceRows = componentRows.map((row) => ({ rowKey: row.rowKey, label: row.label }));
      outputRows.push({
        label,
        sourceRows,
        mechanism,
      });
      resolvedOutputRows.push({
        label,
        mechanism,
        sourceRows: buildResolvedSourceRows(componentRows, canonicalRows),
      });
      for (const rowKey of rowKeys) globallyUsedSourceRowKeys.add(rowKey);
    }
  }

  if (
    rejection.reasons.length > 0
    || rejection.invalidTableIds.length > 0
    || rejection.invalidRowRefs.length > 0
    || rejection.ineligibleRows.length > 0
    || rejection.unsupportedCombinations.length > 0
    || rejection.blockedMechanisms.length > 0
    || !sourceTable
    || outputRows.length === 0
  ) {
    if (sourceTable && outputRows.length === 0 && rejection.blockedMechanisms.length === 0) {
      rejection.reasons.push("No valid output rows were available for this roll-up proposal.");
    }
    return buildRejectedResult(rejection);
  }

  const frozenTableRollupSpec: AnalysisTableRollupSpec = {
    schemaVersion: 2,
    derivationType: "row_rollup",
    sourceTable,
    outputRows,
    resolvedComputePlan: {
      outputRows: resolvedOutputRows,
    },
  };
  const runResult = parseRunResult(params.parentRun.result);
  const parentArtifactKeys = runResult?.r2Files?.outputs ?? {};
  const fingerprint = buildAnalysisTableRollupFingerprint({
    parentRunId: String(params.parentRunId),
    parentArtifactKeys,
    requestText,
    frozenTableRollupSpec,
  });

  const jobId = await mutateInternal(internal.analysisComputeJobs.createTableRollupProposal, {
    orgId: params.orgId,
    projectId: params.projectId,
    parentRunId: params.parentRunId,
    sessionId: params.sessionId,
    requestedBy: params.requestedBy,
    requestText,
    frozenTableRollupSpec,
    reviewFlags: {
      requiresClarification: false,
      requiresReview: false,
      reasons: [],
      averageConfidence: 1,
      policyFallbackDetected: false,
    },
    fingerprint,
    promptSummary: `${sourceTable.title}: ${outputRows.map((row) => row.label).join(", ")}`,
  });

  return {
    status: "validated_proposal",
    jobId: String(jobId),
    jobType: "table_rollup_derivation",
    message: "I prepared a validated derived-table proposal. Review the card before confirming; the percentages and significance will be computed only after you confirm.",
    sourceTable,
    outputRows,
  };
}

export async function computeTableRollupArtifact(params: {
  groundingContext: AnalysisGroundingContext;
  spec: AnalysisTableRollupSpec;
  jobId: string;
  runResultValue: unknown;
}): Promise<AnalysisTableCard> {
  assertAnalysisTableRollupSpecV2(params.spec);
  const tableSpec = params.spec.sourceTable;
  if (!tableSpec) throw new Error("Table roll-up spec has no source table.");
  const source = fetchTable(params.groundingContext, { tableId: tableSpec.tableId, cutGroups: "*" });
  if (source.status !== "available") throw new Error(`Source table ${tableSpec.tableId} is not available.`);
  const canonicalTables = await loadCanonicalTables(params.runResultValue);
  const canonical = canonicalTables.get(tableSpec.tableId);
  if (!canonical?.rows?.length) {
    throw new Error(`Source table ${tableSpec.tableId} is missing canonical row metadata.`);
  }

  const derivedRowsByFirstSourceKey = new Map<string, AnalysisTableCardRow>();
  const consumedSourceRowKeys = new Set<string>();
  const focusedRowKeys: string[] = [];
  for (const [index, outputRow] of params.spec.resolvedComputePlan.outputRows.entries()) {
    const publicOutputRow = params.spec.outputRows[index];
    if (!publicOutputRow || publicOutputRow.label !== outputRow.label || publicOutputRow.mechanism !== outputRow.mechanism) {
      throw new Error(`Roll-up ${outputRow.label} does not match the resolved compute plan.`);
    }
    if (outputRow.mechanism !== "artifact_exclusive_sum") {
      throw new Error(`Roll-up ${outputRow.label} requires unsupported compute mechanism ${outputRow.mechanism}.`);
    }
    if (!isResolvedArtifactExclusiveSumCandidate(outputRow.sourceRows)) {
      throw new Error(`Roll-up ${outputRow.label} no longer matches an artifact-safe exclusive-sum shape.`);
    }
    const componentRows = outputRow.sourceRows.map((component) => {
      const row = findRowByExactKey(source, component.rowKey);
      if (!row) throw new Error(`Source row ${component.rowKey} is not available.`);
      if (normalizeText(row.label) !== normalizeText(component.label)) {
        throw new Error(`Source row ${component.rowKey} no longer matches the validated label.`);
      }
      const canonicalRow = findCanonicalRow({ canonical, card: source, row });
      if (!canonicalRow) {
        throw new Error(`Source row ${component.rowKey} is missing canonical metadata.`);
      }
      if (
        canonicalRow.variable !== component.variable
        || (canonicalRow.filterValue ?? "") !== component.filterValue
      ) {
        throw new Error(`Source row ${component.rowKey} no longer matches the validated row semantics.`);
      }
      if (row.rowKind !== "value" || row.isNet || canonicalRow.rowKind !== "value" || canonicalRow.isNet) {
        throw new Error(`Source row ${component.rowKey} is no longer eligible for row roll-up compute.`);
      }
      return row;
    });
    const values = source.columns.map((column) => {
      const cell = buildRollupCell({ componentRows, column });
      if (!cell) throw new Error(`Roll-up ${outputRow.label} cannot be computed for ${column.cutName}.`);
      return cell;
    });
    const row: AnalysisTableCardRow = {
      rowKey: `derived_rollup_${derivedRowsByFirstSourceKey.size + 1}`,
      label: outputRow.label,
      rowKind: "net",
      statType: null,
      valueType: "pct",
      format: { kind: "percent", decimals: 0 },
      indent: 0,
      isNet: true,
      values,
      cellsByCutKey: Object.fromEntries(values.map((value) => [value.cutKey ?? value.cutName, value])),
    };
    const derivedRow = row;
    const firstSourceRowKey = componentRows[0]?.rowKey;
    if (!firstSourceRowKey) throw new Error(`Roll-up ${outputRow.label} has no source rows.`);
    derivedRowsByFirstSourceKey.set(firstSourceRowKey, derivedRow);
    focusedRowKeys.push(derivedRow.rowKey);

    for (const component of componentRows) {
      consumedSourceRowKeys.add(component.rowKey);
    }
  }

  const rows: AnalysisTableCardRow[] = [];
  for (const sourceRow of source.rows) {
    const derivedRow = derivedRowsByFirstSourceKey.get(sourceRow.rowKey);
    if (derivedRow) rows.push(derivedRow);
    if (consumedSourceRowKeys.has(sourceRow.rowKey)) continue;
    rows.push(cloneTableRow(sourceRow));
  }

  const derivedTableId = `${source.tableId}__rollup_${params.jobId}`;
  return {
    ...source,
    tableId: derivedTableId,
    title: `${source.title} — Derived roll-up`,
    tableSubtitle: "Computed derived table",
    userNote: "Computed by TabulateAI from confirmed row roll-up components. Significance markers are not shown for derived roll-up rows.",
    rows,
    totalRows: rows.length,
    truncatedRows: Math.max(rows.length - Math.min(rows.length, 8), 0),
    initialVisibleRowCount: Math.min(rows.length, 8),
    focusedRowKeys,
    sourceRefs: [
      ...source.sourceRefs,
      { refType: "table", refId: source.tableId, label: `Source table: ${source.title}` },
    ],
  };
}
