interface ResultsBannerGroup {
  groupName?: string;
  columns?: Array<{
    name?: string;
    statLetter?: string | null;
  }>;
}

interface ResultsMetadata {
  bannerGroups?: ResultsBannerGroup[];
}

interface ResultsRowValue {
  label?: string;
  groupName?: string;
  rowKind?: string;
  statType?: string | null;
  n?: number | null;
  count?: number | null;
  pct?: number | null;
  mean?: number | null;
  median?: number | null;
  sd?: number | null;
  std_err?: number | null;
  sig_higher_than?: string[] | string | null;
  sig_vs_total?: "higher" | "lower" | string | null;
  isNet?: boolean;
  indent?: number;
  isStat?: boolean;
}

interface ResultsCutData {
  stat_letter?: string | null;
  table_base_n?: number | null;
  [rowKey: string]: ResultsRowValue | string | number | null | undefined;
}

interface ResultsTableEntry {
  tableId?: string;
  questionId?: string;
  questionText?: string;
  tableType?: string;
  surveySection?: string | null;
  baseText?: string | null;
  userNote?: string | null;
  tableSubtitle?: string | null;
  isDerived?: boolean;
  sourceTableId?: string;
  excluded?: boolean;
  excludeReason?: string;
  data?: Record<string, ResultsCutData>;
}

interface ResultsTablesArtifact {
  metadata: ResultsMetadata & Record<string, unknown>;
  tables: Record<string, ResultsTableEntry>;
}

const NULLABLE_RESULT_NUMBER_KEYS = [
  "n",
  "count",
  "pct",
  "mean",
  "median",
  "sd",
  "std_err",
] as const;

interface ComputeRow {
  label?: string;
  rowKind?: string;
  statType?: string | null;
  indent?: number;
  isNet?: boolean;
}

interface ComputeCut {
  name?: string;
  statLetter?: string | null;
  groupName?: string;
}

interface ComputeTable {
  tableId?: string;
  tableType?: string;
  rows?: ComputeRow[];
}

export interface FinalTableContractComputeInput {
  tables?: ComputeTable[];
  cuts?: ComputeCut[];
}

interface FinalTableColumn {
  cutKey: string;
  cutName: string;
  groupKey: string;
  groupName: string | null;
  statLetter: string | null;
  baseN: number | null;
  isTotal: boolean;
  order: number;
}

interface FinalTableRowFormat {
  kind: "percent" | "number";
  decimals: number;
}

interface FinalTableCellMetrics {
  pct: number | null;
  count: number | null;
  n: number | null;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  stderr: number | null;
}

interface FinalTableCell {
  cutKey: string;
  value: number | null;
  metrics: FinalTableCellMetrics;
  sigHigherThan: string[];
  sigVsTotal: "higher" | "lower" | null;
}

interface FinalTableRow {
  rowKey: string;
  label: string;
  rowKind: string;
  statType: string | null;
  indent: number;
  isNet: boolean;
  valueType: "pct" | "count" | "n" | "mean" | "median" | "stddev" | "stderr";
  format: FinalTableRowFormat;
  cells: FinalTableCell[];
}

export interface FinalTableContractEntry extends ResultsTableEntry {
  columns: FinalTableColumn[];
  rows: FinalTableRow[];
}

export interface FinalTablesContractArtifact extends ResultsTablesArtifact {
  tables: Record<string, FinalTableContractEntry>;
}

const TOTAL_GROUP_KEY = "__total__";
const DEMO_BANNER_TABLE_ID = "_demo_banner_x_banner";

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isResultsRowValue(value: unknown): value is ResultsRowValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isNullLikeStatString(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toUpperCase();
  return normalized === "NA" || normalized === "N/A";
}

function normalizeResultsRowValue(resultRow: ResultsRowValue): ResultsRowValue {
  const normalizedRow: ResultsRowValue = { ...resultRow };

  for (const key of NULLABLE_RESULT_NUMBER_KEYS) {
    const rawValue = normalizedRow[key];
    if (isNullLikeStatString(rawValue)) {
      normalizedRow[key] = null;
    }
  }

  return normalizedRow;
}

function normalizeResultsCutData(cut: ResultsCutData): ResultsCutData {
  const normalizedCut: ResultsCutData = { ...cut };

  if (isNullLikeStatString(normalizedCut.table_base_n)) {
    normalizedCut.table_base_n = null;
  }

  for (const [key, value] of Object.entries(normalizedCut)) {
    if (key === "stat_letter" || key === "table_base_n") continue;
    if (!isResultsRowValue(value)) continue;
    normalizedCut[key] = normalizeResultsRowValue(value);
  }

  return normalizedCut;
}

function normalizeResultsTableEntry(table: ResultsTableEntry): ResultsTableEntry {
  if (!table.data) return { ...table };

  return {
    ...table,
    data: Object.fromEntries(
      Object.entries(table.data).map(([cutName, cut]) => [cutName, normalizeResultsCutData(cut)]),
    ),
  };
}

function isTotalCut(cutName: string, cut: ResultsCutData): boolean {
  if (normalizeText(cutName) === "total") return true;
  const groupNames = Object.values(cut)
    .filter(isResultsRowValue)
    .map((row) => normalizeText(row.groupName))
    .filter((groupName) => groupName.length > 0);

  if (groupNames.some((groupName) => groupName !== "total")) {
    return false;
  }

  return groupNames.length > 0 && groupNames.every((groupName) => groupName === "total");
}

function deriveCutGroupKey(groupName: string | null, cutName: string, isTotal: boolean): string {
  if (isTotal) return TOTAL_GROUP_KEY;
  const normalizedGroup = normalizeText(groupName);
  if (normalizedGroup) return `group:${normalizedGroup}`;
  return `cut:${normalizeText(cutName) || cutName.toLowerCase()}`;
}

function deriveCutKey(groupKey: string, cutName: string): string {
  return `${groupKey}::${normalizeText(cutName) || cutName.toLowerCase()}`;
}

function resolveCutBaseN(cut: ResultsCutData): number | null {
  if (typeof cut.table_base_n === "number" && Number.isFinite(cut.table_base_n)) {
    return cut.table_base_n;
  }

  for (const [key, value] of Object.entries(cut)) {
    if (key === "stat_letter" || key === "table_base_n") continue;
    if (isResultsRowValue(value) && typeof value.n === "number" && Number.isFinite(value.n)) {
      return value.n;
    }
  }

  return null;
}

function collectOrderedRowKeys(cut: ResultsCutData | undefined): string[] {
  if (!cut) return [];
  return Object.keys(cut).filter((key) => {
    if (key === "stat_letter" || key === "table_base_n") return false;
    return isResultsRowValue(cut[key]);
  });
}

function inferStatType(label: string | undefined): string | null {
  const normalized = normalizeText(label);
  if (normalized === "mean") return "mean";
  if (normalized === "median") return "median";
  if (normalized === "std dev") return "stddev";
  if (normalized === "std err") return "stderr";
  return null;
}

function inferRowKind(row: ComputeRow | undefined, resultRow: ResultsRowValue | undefined): string {
  if (typeof row?.rowKind === "string" && row.rowKind.trim().length > 0) {
    return row.rowKind;
  }
  if (typeof resultRow?.rowKind === "string" && resultRow.rowKind.trim().length > 0) {
    return resultRow.rowKind;
  }
  if (resultRow?.isStat) {
    return "stat";
  }
  if (resultRow?.isNet) {
    return "net";
  }
  return "value";
}

function inferValueTypeFromResultRow(resultRow: ResultsRowValue | undefined): FinalTableRow["valueType"] | null {
  if (!resultRow) return null;
  if (typeof resultRow.pct === "number" && Number.isFinite(resultRow.pct)) return "pct";
  if (typeof resultRow.count === "number" && Number.isFinite(resultRow.count)) return "count";
  if (typeof resultRow.n === "number" && Number.isFinite(resultRow.n)) return "n";
  if (typeof resultRow.mean === "number" && Number.isFinite(resultRow.mean)) return "mean";
  if (typeof resultRow.median === "number" && Number.isFinite(resultRow.median)) return "median";
  if (typeof resultRow.sd === "number" && Number.isFinite(resultRow.sd)) return "stddev";
  if (typeof resultRow.std_err === "number" && Number.isFinite(resultRow.std_err)) return "stderr";
  return null;
}

function deriveValueType(
  tableType: string | undefined,
  rowKind: string,
  statType: string | null,
  resultRow: ResultsRowValue | undefined,
): FinalTableRow["valueType"] {
  if (rowKind === "stat") {
    switch (statType) {
      case "median":
        return "median";
      case "stddev":
        return "stddev";
      case "stderr":
        return "stderr";
      case "mean":
      default:
        return "mean";
    }
  }

  if (tableType === "mean_rows") {
    return "mean";
  }

  return inferValueTypeFromResultRow(resultRow) ?? "pct";
}

function deriveRowFormat(valueType: FinalTableRow["valueType"]): FinalTableRowFormat {
  switch (valueType) {
    case "pct":
      return { kind: "percent", decimals: 0 };
    case "mean":
    case "median":
      return { kind: "number", decimals: 1 };
    case "stddev":
    case "stderr":
      return { kind: "number", decimals: 2 };
    default:
      return { kind: "number", decimals: 0 };
  }
}

function buildFinalRowMetadata(
  rowKey: string,
  row: ComputeRow | undefined,
  resultRow: ResultsRowValue | undefined,
  tableType: string | undefined,
): FinalTableRow {
  const label = row?.label ?? resultRow?.label ?? rowKey;
  const rowKind = inferRowKind(row, resultRow);
  const rawStatType = typeof row?.statType === "string" && row.statType.trim().length > 0
    ? row.statType
    : typeof resultRow?.statType === "string" && resultRow.statType.trim().length > 0
      ? resultRow.statType
      : inferStatType(label);
  const statType = rawStatType ?? null;
  const valueType = deriveValueType(tableType, rowKind, statType, resultRow);

  return {
    rowKey,
    label,
    rowKind,
    statType,
    indent: typeof row?.indent === "number" ? row.indent : typeof resultRow?.indent === "number" ? resultRow.indent : 0,
    isNet: Boolean(row?.isNet ?? resultRow?.isNet),
    valueType,
    format: deriveRowFormat(valueType),
    cells: [],
  };
}

function normalizeSigHigherThan(value: ResultsRowValue["sig_higher_than"]): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value.split("").filter((entry) => entry.trim().length > 0);
  }

  return [];
}

function buildFinalCellMetrics(resultRow: ResultsRowValue | undefined): FinalTableCellMetrics {
  return {
    pct: typeof resultRow?.pct === "number" && Number.isFinite(resultRow.pct) ? resultRow.pct : null,
    count: typeof resultRow?.count === "number" && Number.isFinite(resultRow.count) ? resultRow.count : null,
    n: typeof resultRow?.n === "number" && Number.isFinite(resultRow.n) ? resultRow.n : null,
    mean: typeof resultRow?.mean === "number" && Number.isFinite(resultRow.mean) ? resultRow.mean : null,
    median: typeof resultRow?.median === "number" && Number.isFinite(resultRow.median) ? resultRow.median : null,
    stddev: typeof resultRow?.sd === "number" && Number.isFinite(resultRow.sd) ? resultRow.sd : null,
    stderr: typeof resultRow?.std_err === "number" && Number.isFinite(resultRow.std_err) ? resultRow.std_err : null,
  };
}

function resolveFinalCellValue(
  metrics: FinalTableCellMetrics,
  valueType: FinalTableRow["valueType"],
): number | null {
  switch (valueType) {
    case "count":
      return metrics.count ?? metrics.n ?? metrics.pct ?? metrics.mean ?? metrics.median ?? metrics.stddev ?? metrics.stderr;
    case "n":
      return metrics.n ?? metrics.count ?? metrics.pct ?? metrics.mean ?? metrics.median ?? metrics.stddev ?? metrics.stderr;
    case "mean":
      return metrics.mean ?? metrics.pct ?? metrics.count ?? metrics.n ?? metrics.median ?? metrics.stddev ?? metrics.stderr;
    case "median":
      return metrics.median ?? metrics.mean ?? metrics.pct ?? metrics.count ?? metrics.n ?? metrics.stddev ?? metrics.stderr;
    case "stddev":
      return metrics.stddev ?? metrics.pct ?? metrics.mean ?? metrics.count ?? metrics.n ?? metrics.stderr ?? metrics.median;
    case "stderr":
      return metrics.stderr ?? metrics.pct ?? metrics.mean ?? metrics.count ?? metrics.n ?? metrics.stddev ?? metrics.median;
    case "pct":
    default:
      return metrics.pct ?? metrics.count ?? metrics.n ?? metrics.mean ?? metrics.median ?? metrics.stddev ?? metrics.stderr;
  }
}

function buildFinalRowCells(
  columns: FinalTableColumn[],
  table: ResultsTableEntry,
  row: FinalTableRow,
): FinalTableCell[] {
  return columns.map((column) => {
    const cut = table.data?.[column.cutName];
    const rawRow = cut?.[row.rowKey];
    const resultRow = isResultsRowValue(rawRow) ? rawRow : undefined;
    const metrics = buildFinalCellMetrics(resultRow);

    return {
      cutKey: column.cutKey,
      value: resolveFinalCellValue(metrics, row.valueType),
      metrics,
      sigHigherThan: normalizeSigHigherThan(resultRow?.sig_higher_than),
      sigVsTotal: resultRow?.sig_vs_total === "higher" || resultRow?.sig_vs_total === "lower"
        ? resultRow.sig_vs_total
        : null,
    };
  });
}

function buildBannerColumnLookup(metadata: ResultsMetadata | undefined): Map<string, { groupName: string; statLetter: string | null; order: number }> {
  const lookup = new Map<string, { groupName: string; statLetter: string | null; order: number }>();
  let order = 0;

  for (const group of metadata?.bannerGroups ?? []) {
    const groupName = typeof group.groupName === "string" ? group.groupName : "";
    for (const column of group.columns ?? []) {
      if (typeof column.name !== "string" || column.name.trim().length === 0) continue;
      lookup.set(normalizeText(column.name), {
        groupName,
        statLetter: typeof column.statLetter === "string" ? column.statLetter : null,
        order,
      });
      order += 1;
    }
  }

  return lookup;
}

function buildComputeCutLookup(
  computeInput: FinalTableContractComputeInput,
): Map<string, { groupName: string; statLetter: string | null; order: number }> {
  const lookup = new Map<string, { groupName: string; statLetter: string | null; order: number }>();
  let order = 0;

  for (const cut of computeInput.cuts ?? []) {
    if (typeof cut.name !== "string" || cut.name.trim().length === 0) continue;
    lookup.set(normalizeText(cut.name), {
      groupName: typeof cut.groupName === "string" ? cut.groupName : "",
      statLetter: typeof cut.statLetter === "string" ? cut.statLetter : null,
      order,
    });
    order += 1;
  }

  return lookup;
}

function buildFinalTableColumns(
  table: ResultsTableEntry,
  metadata: ResultsMetadata | undefined,
  computeInput: FinalTableContractComputeInput,
): FinalTableColumn[] {
  const columnsByNormalizedCut = new Map<string, FinalTableColumn>();
  const bannerLookup = buildBannerColumnLookup(metadata);
  const computeLookup = buildComputeCutLookup(computeInput);
  const dataEntries = Object.entries(table.data ?? {});

  for (const [cutName, cut] of dataEntries) {
    const normalizedCut = normalizeText(cutName);
    const computeCut = computeLookup.get(normalizedCut);
    const bannerColumn = bannerLookup.get(normalizedCut);
    const isTotal = isTotalCut(cutName, cut);
    const firstRow = Object.values(cut).find(isResultsRowValue);
    const groupName = isTotal
      ? "Total"
      : (computeCut?.groupName || bannerColumn?.groupName || firstRow?.groupName || null);
    const groupKey = deriveCutGroupKey(groupName, cutName, isTotal);

    columnsByNormalizedCut.set(normalizedCut, {
      cutKey: deriveCutKey(groupKey, cutName),
      cutName,
      groupKey,
      groupName,
      statLetter: computeCut?.statLetter ?? bannerColumn?.statLetter ?? (typeof cut.stat_letter === "string" ? cut.stat_letter : null),
      baseN: resolveCutBaseN(cut),
      isTotal,
      order: computeCut?.order ?? bannerColumn?.order ?? Number.MAX_SAFE_INTEGER,
    });
  }

  return [...columnsByNormalizedCut.values()].sort((a, b) => {
    if (a.isTotal && !b.isTotal) return -1;
    if (!a.isTotal && b.isTotal) return 1;
    if (a.order !== b.order) return a.order - b.order;
    return a.cutName.localeCompare(b.cutName);
  }).map((column, index) => ({
    ...column,
    order: index,
  }));
}

function buildDemoBannerRows(
  tableId: string,
  rowKeys: string[],
  totalCut: ResultsCutData | undefined,
  computeInput: FinalTableContractComputeInput,
  tableType: string | undefined,
): FinalTableRow[] {
  const cuts = (computeInput.cuts ?? []).filter(
    (cut): cut is ComputeCut & { name: string } =>
      typeof cut.name === "string" && cut.name.trim().length > 0,
  );
  const expectedRowCount = cuts.length + 1;

  if (rowKeys.length !== expectedRowCount) {
    throw new Error(
      `Final table contract mismatch for ${tableId}: demo rows (${rowKeys.length}) did not match expected banner rows (${expectedRowCount}).`,
    );
  }

  return rowKeys.map((rowKey, index) => {
    const resultRow = totalCut && isResultsRowValue(totalCut[rowKey]) ? totalCut[rowKey] : undefined;
    const row = index === 0
      ? { label: "Total", rowKind: "value", statType: null, indent: 0, isNet: false }
      : { label: cuts[index - 1]?.name, rowKind: "value", statType: null, indent: 0, isNet: false };
    return buildFinalRowMetadata(rowKey, row, resultRow, tableType);
  });
}

function buildFinalTableRows(
  tableId: string,
  table: ResultsTableEntry,
  computeTable: ComputeTable | undefined,
  computeInput: FinalTableContractComputeInput,
): FinalTableRow[] {
  const columns = Object.entries(table.data ?? {});
  const totalEntry = columns.find(([cutName, cut]) => isTotalCut(cutName, cut)) ?? columns[0];
  const totalCut = totalEntry?.[1];
  const rowKeys = collectOrderedRowKeys(totalCut);
  const computeRows = computeTable?.rows ?? [];
  const tableType = typeof computeTable?.tableType === "string" && computeTable.tableType.trim().length > 0
    ? computeTable.tableType
    : table.tableType;

  if (rowKeys.length === 0) {
    return [];
  }

  if (computeRows.length === rowKeys.length) {
    return computeRows.map((row, index) => {
      const rowKey = rowKeys[index]!;
      const resultRow = totalCut && isResultsRowValue(totalCut[rowKey]) ? totalCut[rowKey] : undefined;
      return buildFinalRowMetadata(rowKey, row, resultRow, tableType);
    });
  }

  if (tableId === DEMO_BANNER_TABLE_ID && computeRows.length === 0) {
    return buildDemoBannerRows(tableId, rowKeys, totalCut, computeInput, tableType);
  }

  if (computeRows.length !== rowKeys.length) {
    throw new Error(
      `Final table contract mismatch for ${tableId}: compute rows (${computeRows.length}) did not match results row keys (${rowKeys.length}).`,
    );
  }
  return [];
}

export function buildFinalTableContractEntry(
  tableId: string,
  table: ResultsTableEntry,
  metadata: ResultsMetadata | undefined,
  computeInput: FinalTableContractComputeInput,
): FinalTableContractEntry {
  const normalizedTable = normalizeResultsTableEntry(table);
  const computeTables = new Map(
    (computeInput.tables ?? [])
      .filter((entry): entry is ComputeTable & { tableId: string } => typeof entry.tableId === "string")
      .map((entry) => [entry.tableId, entry]),
  );
  const computeTable = computeTables.get(tableId);
  const columns = buildFinalTableColumns(normalizedTable, metadata, computeInput);
  const rows = buildFinalTableRows(tableId, normalizedTable, computeTable, computeInput)
    .map((row) => ({
      ...row,
      cells: buildFinalRowCells(columns, normalizedTable, row),
    }));

  return {
    ...normalizedTable,
    columns,
    rows,
  };
}

export function buildFinalTablesContract(
  resultsTables: ResultsTablesArtifact,
  computeInput: FinalTableContractComputeInput,
): FinalTablesContractArtifact {
  return {
    ...resultsTables,
    tables: Object.fromEntries(
      Object.entries(resultsTables.tables).map(([tableId, table]) => {
        return [
          tableId,
          buildFinalTableContractEntry(tableId, table, resultsTables.metadata, computeInput),
        ];
      }),
    ),
  };
}
