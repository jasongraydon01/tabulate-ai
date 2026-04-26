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
  AnalysisTableRollupSpec,
  AnalysisTableRollupTableSpec,
} from "@/lib/analysis/computeLane/types";
import { buildAnalysisTableRollupFingerprint } from "@/lib/analysis/computeLane/fingerprint";

const TABLE_ENRICHED_PATH = "tables/13e-table-enriched.json";
const TABLE_CANONICAL_PATH = "tables/13d-table-canonical.json";
const MAX_SOURCE_TABLES = 1;
const MAX_ROLLUPS_PER_TABLE = 4;

export interface AnalysisTableRollupCandidate {
  tableId: string;
  rollups: Array<{
    label: string;
    components: Array<{
      rowKey?: string;
      label?: string;
    }>;
  }>;
}

export type AnalysisTableRollupToolResult =
  | {
      status: "validated_proposal";
      jobId: string;
      jobType: "table_rollup_derivation";
      message: string;
      sourceTables: AnalysisTableRollupTableSpec[];
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
}

function emptyRejection(): ValidationRejection {
  return {
    reasons: [],
    repairHints: [],
    invalidTableIds: [],
    invalidRowRefs: [],
    ineligibleRows: [],
    unsupportedCombinations: [],
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

function normalCdf(value: number): number {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const erf = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function proportionPValue(count1: number, n1: number, count2: number, n2: number): number | null {
  if (n1 <= 0 || n2 <= 0) return null;
  const p1 = count1 / n1;
  const p2 = count2 / n2;
  const se = Math.sqrt((p1 * (1 - p1) / n1) + (p2 * (1 - p2) / n2));
  if (!Number.isFinite(se) || se <= 0) return null;
  const z = (p1 - p2) / se;
  return 2 * (1 - normalCdf(Math.abs(z)));
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
  if (!base || bases.some((value) => Math.abs(value - base) > 0.000001)) return null;
  const count = counts.reduce((sum, value) => sum + value, 0);
  if (count > base + 0.000001) return null;
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

function recomputeSignificance(row: AnalysisTableCardRow, columns: AnalysisTableCardColumn[], threshold: number): AnalysisTableCardRow {
  const nextValues: AnalysisTableCardCell[] = row.values.map((cell) => ({
    ...cell,
    sigHigherThan: [],
    sigVsTotal: null,
  }));
  const byCutKey = Object.fromEntries(nextValues.map((cell) => [cell.cutKey ?? cell.cutName, cell]));
  const totalColumn = columns.find((column) => column.isTotal);
  const totalCell = totalColumn ? byCutKey[totalColumn.cutKey ?? totalColumn.cutName] : null;

  for (const column of columns) {
    const cell = byCutKey[column.cutKey ?? column.cutName];
    if (!cell || typeof cell.count !== "number" || typeof cell.n !== "number") continue;

    if (!column.isTotal && totalCell && typeof totalCell.count === "number" && typeof totalCell.n === "number") {
      const pValue = proportionPValue(cell.count, cell.n, totalCell.count, totalCell.n);
      if (pValue !== null && pValue <= threshold && cell.pct !== null && totalCell.pct !== null && cell.pct !== totalCell.pct) {
        cell.sigVsTotal = cell.pct > totalCell.pct ? "higher" : "lower";
      }
    }

    for (const otherColumn of columns) {
      if (otherColumn === column || otherColumn.groupName !== column.groupName || column.isTotal || otherColumn.isTotal) continue;
      const other = byCutKey[otherColumn.cutKey ?? otherColumn.cutName];
      if (!other || typeof other.count !== "number" || typeof other.n !== "number" || !otherColumn.statLetter) continue;
      if ((cell.pct ?? 0) <= (other.pct ?? 0)) continue;
      const pValue = proportionPValue(cell.count, cell.n, other.count, other.n);
      if (pValue !== null && pValue <= threshold) {
        cell.sigHigherThan.push(otherColumn.statLetter);
      }
    }
  }

  return {
    ...row,
    values: nextValues,
    cellsByCutKey: byCutKey,
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
  };
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
  const sourceTables: AnalysisTableRollupTableSpec[] = [];

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

    const tableSpec: AnalysisTableRollupTableSpec = {
      tableId: tableResult.tableId,
      title: tableResult.title,
      questionId: tableResult.questionId,
      questionText: tableResult.questionText,
      rollups: [],
    };

    if (candidate.rollups.length === 0 || candidate.rollups.length > MAX_ROLLUPS_PER_TABLE) {
      rejection.reasons.push(`Table ${candidate.tableId} needs between 1 and ${MAX_ROLLUPS_PER_TABLE} roll-ups.`);
      continue;
    }

    for (const rollup of candidate.rollups) {
      const label = rollup.label.trim();
      if (!label) {
        rejection.reasons.push(`A roll-up on ${candidate.tableId} is missing a label.`);
        continue;
      }
      if (rollup.components.length < 2) {
        rejection.reasons.push(`Roll-up "${label}" on ${candidate.tableId} needs at least two component rows.`);
        continue;
      }

      const componentRows: AnalysisTableCardRow[] = [];
      const canonicalRows: CanonicalRow[] = [];
      for (const ref of rollup.components) {
        const row = findRow(tableResult, ref);
        if (!row) {
          rejection.invalidRowRefs.push({ tableId: candidate.tableId, rowRef: ref.rowKey ?? ref.label ?? "(missing row ref)" });
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
        if (!canonicalRow.variable || !canonicalRow.filterValue) {
          rejection.ineligibleRows.push({ tableId: candidate.tableId, rowKey: row.rowKey, label: row.label, reason: "The row is missing source variable/filter metadata." });
          continue;
        }
        if (!getAtomicFilterValue(canonicalRow.filterValue)) {
          rejection.ineligibleRows.push({ tableId: candidate.tableId, rowKey: row.rowKey, label: row.label, reason: "Slice 3 roll-ups require atomic answer-option values, not ranges or existing multi-value groupings." });
          continue;
        }
        componentRows.push(row);
        canonicalRows.push(canonicalRow);
      }

      if (componentRows.length !== rollup.components.length || canonicalRows.length !== rollup.components.length) continue;

      const variables = uniqueStrings(canonicalRows.map((row) => row.variable ?? ""));
      if (variables.length !== 1) {
        rejection.unsupportedCombinations.push(`Roll-up "${label}" on ${candidate.tableId} spans multiple variables. Artifact-safe Slice 3 supports same-variable answer-option roll-ups only.`);
        rejection.repairHints.push("Choose component rows from the same single-response table, or ask a clarification before proposing this roll-up.");
        continue;
      }
      const rowKeys = componentRows.map((row) => row.rowKey);
      if (new Set(rowKeys).size !== rowKeys.length) {
        rejection.unsupportedCombinations.push(`Roll-up "${label}" on ${candidate.tableId} repeats the same source row more than once.`);
        continue;
      }
      const filterValues = canonicalRows.map((row) => getAtomicFilterValue(row.filterValue)).filter((value): value is string => Boolean(value));
      if (new Set(filterValues).size !== filterValues.length) {
        rejection.unsupportedCombinations.push(`Roll-up "${label}" on ${candidate.tableId} repeats the same source value more than once.`);
        continue;
      }

      for (const column of tableResult.columns) {
        const cell = buildRollupCell({ componentRows, column });
        if (!cell) {
          rejection.unsupportedCombinations.push(`Roll-up "${label}" on ${candidate.tableId} cannot be computed with compatible counts and bases for every column.`);
          break;
        }
      }

      tableSpec.rollups.push({
        label,
        components: componentRows.map((row) => ({ rowKey: row.rowKey, label: row.label })),
      });
    }

    if (tableSpec.rollups.length > 0) sourceTables.push(tableSpec);
  }

  if (
    rejection.reasons.length > 0
    || rejection.invalidTableIds.length > 0
    || rejection.invalidRowRefs.length > 0
    || rejection.ineligibleRows.length > 0
    || rejection.unsupportedCombinations.length > 0
  ) {
    return buildRejectedResult(rejection);
  }

  const frozenTableRollupSpec: AnalysisTableRollupSpec = {
    schemaVersion: 1,
    derivationType: "answer_option_rollup",
    sourceTables,
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
    promptSummary: sourceTables
      .map((table) => `${table.title}: ${table.rollups.map((rollup) => rollup.label).join(", ")}`)
      .join("; "),
  });

  return {
    status: "validated_proposal",
    jobId: String(jobId),
    jobType: "table_rollup_derivation",
    message: "I prepared a validated derived-table proposal. Review the card before confirming; the percentages and significance will be computed only after you confirm.",
    sourceTables,
  };
}

export function computeTableRollupArtifact(params: {
  groundingContext: AnalysisGroundingContext;
  spec: AnalysisTableRollupSpec;
  jobId: string;
}): AnalysisTableCard {
  const tableSpec = params.spec.sourceTables[0];
  if (!tableSpec) throw new Error("Table roll-up spec has no source table.");
  const source = fetchTable(params.groundingContext, { tableId: tableSpec.tableId, cutGroups: "*" });
  if (source.status !== "available") throw new Error(`Source table ${tableSpec.tableId} is not available.`);

  const rows: AnalysisTableCardRow[] = [];
  for (const rollup of tableSpec.rollups) {
    const componentRows = rollup.components.map((component) => {
      const row = findRow(source, component);
      if (!row) throw new Error(`Source row ${component.rowKey} is not available.`);
      return row;
    });
    const values = source.columns.map((column) => {
      const cell = buildRollupCell({ componentRows, column });
      if (!cell) throw new Error(`Roll-up ${rollup.label} cannot be computed for ${column.cutName}.`);
      return cell;
    });
    const row: AnalysisTableCardRow = {
      rowKey: `derived_rollup_${rows.length + 1}`,
      label: rollup.label,
      rowKind: "net",
      statType: null,
      valueType: "pct",
      format: { kind: "percent", decimals: 0 },
      indent: 0,
      isNet: true,
      values,
      cellsByCutKey: Object.fromEntries(values.map((value) => [value.cutKey ?? value.cutName, value])),
    };
    rows.push(recomputeSignificance(row, source.columns, source.significanceLevel ?? 0.1));

    for (const component of componentRows) {
      rows.push({
        ...component,
        indent: Math.max(component.indent, 1),
        values: component.values.map((value) => ({ ...value })),
        cellsByCutKey: component.cellsByCutKey
          ? Object.fromEntries(Object.entries(component.cellsByCutKey).map(([key, value]) => [key, { ...value }]))
          : undefined,
      });
    }
  }

  const derivedTableId = `${source.tableId}__rollup_${params.jobId}`;
  return {
    ...source,
    tableId: derivedTableId,
    title: `${source.title} — Derived roll-up`,
    tableSubtitle: "Computed derived table",
    userNote: "Computed by TabulateAI from confirmed answer-option roll-up components.",
    rows,
    totalRows: rows.length,
    truncatedRows: Math.max(rows.length - Math.min(rows.length, 8), 0),
    initialVisibleRowCount: Math.min(rows.length, 8),
    focusedRowKeys: rows.filter((row) => row.isNet).map((row) => row.rowKey),
    sourceRefs: [
      ...source.sourceRefs,
      { refType: "table", refId: source.tableId, label: `Source table: ${source.title}` },
    ],
  };
}
