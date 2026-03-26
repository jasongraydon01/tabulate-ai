import { promises as fs } from "fs";

export type DiffCategory = "banner" | "crosstab" | "structure" | "data";
export type DiffSeverity = "minor" | "major" | "critical";
export type DivergenceLevel = "none" | "minor" | "major";
export type QualityGrade = "A" | "B" | "C" | "D";

export interface EvaluationDiff {
  category: DiffCategory;
  severity: DiffSeverity;
  kind: string;
  message: string;
  meaningful: boolean;
  weight: number;
  tableId?: string;
  groupName?: string;
  columnName?: string;
  cut?: string;
  rowKey?: string;
  field?: string;
  expected?: string;
  actual?: string;
}

export interface EvaluationBreakdown {
  banner: number;
  crosstab: number;
  structure: number;
  data: number;
  diagnostics: number;
}

export interface EvaluationDiffCounts {
  total: number;
  meaningful: number;
  acceptable: number;
}

export interface RunEvaluationResult {
  score: number;
  grade: QualityGrade;
  divergenceLevel: DivergenceLevel;
  summary: string;
  breakdown: EvaluationBreakdown;
  diffCounts: EvaluationDiffCounts;
  topDiffs: EvaluationDiff[];
  diffs: EvaluationDiff[];
}

export interface EvaluationArtifacts {
  banner: unknown;
  crosstab: unknown;
  verification: unknown;
  data: unknown;
}

export interface RunDiagnosticsInput {
  warnings?: string[];
  baseTextHallucinationCount?: number;
  unresolvedPlaceholderCount?: number;
  formatNormalizationAdjustments?: number;
  splitCapViolations?: number;
}

export interface EvaluateRunInput {
  expected: EvaluationArtifacts;
  actual: EvaluationArtifacts;
  runDiagnostics?: RunDiagnosticsInput;
}

interface CategoryComputation {
  score: number;
  diffs: EvaluationDiff[];
}

interface WeightedAccumulator {
  totalWeight: number;
  penaltyWeight: number;
}

interface ScoreableDiff {
  weight: number;
  meaningful: boolean;
}

const CATEGORY_WEIGHTS = {
  crosstab: 0.3,
  structure: 0.3,
  data: 0.3,
  diagnostics: 0.1,
} as const;

const CATEGORY_ORDER: Record<DiffCategory, number> = {
  structure: 0,
  crosstab: 1,
  banner: 2,
  data: 3,
};

function safeRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function safeArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeExpression(expr: unknown): string {
  return normalizeText(expr)
    .replace(/\s*\(\s*/g, "(")
    .replace(/\s*\)\s*/g, ")")
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*([=!<>+\-*/&|])\s*/g, "$1")
    .toLowerCase();
}

function confidenceBucket(value: unknown): "high" | "medium" | "low" | "missing" {
  if (typeof value !== "number" || Number.isNaN(value)) return "missing";
  if (value >= 0.9) return "high";
  if (value >= 0.75) return "medium";
  return "low";
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toComparableSet(value: unknown): string[] {
  const arr = safeArray(value)
    .map((v) => normalizeText(v))
    .filter(Boolean);
  return Array.from(new Set(arr)).sort();
}

function listUnionKeys(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  const set = new Set<string>([...Object.keys(a), ...Object.keys(b)]);
  return Array.from(set);
}

function summarizeValue(value: unknown): string {
  if (value === null || value === undefined) return String(value);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function evaluateScoreFromDiffs(diffs: ScoreableDiff[]): number {
  const acc: WeightedAccumulator = diffs.reduce(
    (sum, diff) => {
      const penalty = diff.meaningful ? diff.weight : diff.weight * 0.25;
      return {
        totalWeight: sum.totalWeight + diff.weight,
        penaltyWeight: sum.penaltyWeight + penalty,
      };
    },
    { totalWeight: 0, penaltyWeight: 0 }
  );
  if (acc.totalWeight === 0) return 100;
  const ratio = acc.penaltyWeight / acc.totalWeight;
  return Math.max(0, 100 - ratio * 100);
}

function roundScore(value: number): number {
  return Math.round(value * 100) / 100;
}

function gradeFromScore(score: number): QualityGrade {
  if (score >= 95) return "A";
  if (score >= 88) return "B";
  if (score >= 80) return "C";
  return "D";
}

function computeDiagnosticsScore(runDiagnostics?: RunDiagnosticsInput): number {
  if (!runDiagnostics) return 100;
  let score = 100;
  const warnings = runDiagnostics.warnings ?? [];

  score -= Math.min(30, warnings.length * 7);
  score -= Math.min(20, (runDiagnostics.baseTextHallucinationCount ?? 0) * 3);
  score -= Math.min(25, (runDiagnostics.unresolvedPlaceholderCount ?? 0) * 4);
  score -= Math.min(8, (runDiagnostics.formatNormalizationAdjustments ?? 0));
  score -= Math.min(12, (runDiagnostics.splitCapViolations ?? 0) * 2);

  return Math.max(0, score);
}

function compareBanner(expected: unknown, actual: unknown): CategoryComputation {
  const diffs: EvaluationDiff[] = [];
  const expectedCuts = safeArray(safeRecord(expected).bannerCuts);
  const actualCuts = safeArray(safeRecord(actual).bannerCuts);
  const expectedMap = new Map<string, Record<string, unknown>>();
  const actualMap = new Map<string, Record<string, unknown>>();

  for (const rawGroup of expectedCuts) {
    const group = safeRecord(rawGroup);
    const groupName = normalizeText(group.groupName);
    if (groupName) expectedMap.set(groupName, group);
  }
  for (const rawGroup of actualCuts) {
    const group = safeRecord(rawGroup);
    const groupName = normalizeText(group.groupName);
    if (groupName) actualMap.set(groupName, group);
  }

  for (const [groupName, expectedGroup] of expectedMap.entries()) {
    const actualGroup = actualMap.get(groupName);
    if (!actualGroup) {
      diffs.push({
        category: "banner",
        severity: "critical",
        kind: "missing_group",
        message: `Missing banner group: ${groupName}`,
        meaningful: true,
        weight: 2,
        groupName,
      });
      continue;
    }

    const expectedColumns = safeArray(expectedGroup.columns);
    const actualColumns = safeArray(actualGroup.columns);
    const expectedColMap = new Map<string, Record<string, unknown>>();
    const actualColMap = new Map<string, Record<string, unknown>>();

    for (const rawCol of expectedColumns) {
      const col = safeRecord(rawCol);
      const colName = normalizeText(col.name);
      if (colName) expectedColMap.set(colName, col);
    }
    for (const rawCol of actualColumns) {
      const col = safeRecord(rawCol);
      const colName = normalizeText(col.name);
      if (colName) actualColMap.set(colName, col);
    }

    for (const [columnName, expectedColumn] of expectedColMap.entries()) {
      const actualColumn = actualColMap.get(columnName);
      if (!actualColumn) {
        diffs.push({
          category: "banner",
          severity: "critical",
          kind: "missing_column",
          message: `Missing banner column: ${groupName} :: ${columnName}`,
          meaningful: true,
          weight: 2,
          groupName,
          columnName,
        });
        continue;
      }

      const fields = [
        "name",
        "original",
        "adjusted",
        "statLetter",
        "requiresInference",
        "humanInLoopRequired",
      ] as const;
      for (const field of fields) {
        const expVal = expectedColumn[field];
        const actVal = actualColumn[field];
        if (summarizeValue(expVal) !== summarizeValue(actVal)) {
          diffs.push({
            category: "banner",
            severity: field === "adjusted" ? "major" : "minor",
            kind: "field_mismatch",
            message: `Banner field mismatch (${field}) in ${groupName} :: ${columnName}`,
            meaningful: true,
            weight: field === "adjusted" ? 1.2 : 0.6,
            groupName,
            columnName,
            field,
            expected: summarizeValue(expVal),
            actual: summarizeValue(actVal),
          });
        }
      }

      const expectedBucket = confidenceBucket(expectedColumn.confidence);
      const actualBucket = confidenceBucket(actualColumn.confidence);
      if (expectedBucket !== actualBucket) {
        diffs.push({
          category: "banner",
          severity: "minor",
          kind: "confidence_bucket",
          message: `Confidence bucket changed in ${groupName} :: ${columnName}`,
          meaningful: expectedBucket !== "missing" && actualBucket !== "missing",
          weight: 0.35,
          groupName,
          columnName,
          field: "confidence",
          expected: expectedBucket,
          actual: actualBucket,
        });
      }
    }

    for (const columnName of actualColMap.keys()) {
      if (!expectedColMap.has(columnName)) {
        diffs.push({
          category: "banner",
          severity: "major",
          kind: "extra_column",
          message: `Unexpected banner column: ${groupName} :: ${columnName}`,
          meaningful: true,
          weight: 1.2,
          groupName,
          columnName,
        });
      }
    }
  }

  for (const groupName of actualMap.keys()) {
    if (!expectedMap.has(groupName)) {
      diffs.push({
        category: "banner",
        severity: "major",
        kind: "extra_group",
        message: `Unexpected banner group: ${groupName}`,
        meaningful: true,
        weight: 1.8,
        groupName,
      });
    }
  }

  return {
    score: roundScore(evaluateScoreFromDiffs(diffs)),
    diffs,
  };
}

function compareCrosstab(expected: unknown, actual: unknown): CategoryComputation {
  const diffs: EvaluationDiff[] = [];
  const expectedCuts = safeArray(safeRecord(expected).bannerCuts);
  const actualCuts = safeArray(safeRecord(actual).bannerCuts);
  const expectedMap = new Map<string, Record<string, unknown>>();
  const actualMap = new Map<string, Record<string, unknown>>();

  for (const rawGroup of expectedCuts) {
    const group = safeRecord(rawGroup);
    const groupName = normalizeText(group.groupName);
    if (groupName) expectedMap.set(groupName, group);
  }
  for (const rawGroup of actualCuts) {
    const group = safeRecord(rawGroup);
    const groupName = normalizeText(group.groupName);
    if (groupName) actualMap.set(groupName, group);
  }

  for (const [groupName, expectedGroup] of expectedMap.entries()) {
    const actualGroup = actualMap.get(groupName);
    if (!actualGroup) {
      diffs.push({
        category: "crosstab",
        severity: "critical",
        kind: "missing_group",
        message: `Missing crosstab group: ${groupName}`,
        meaningful: true,
        weight: 2.4,
        groupName,
      });
      continue;
    }

    const expectedColumns = safeArray(expectedGroup.columns);
    const actualColumns = safeArray(actualGroup.columns);
    const expectedColMap = new Map<string, Record<string, unknown>>();
    const actualColMap = new Map<string, Record<string, unknown>>();

    for (const rawCol of expectedColumns) {
      const col = safeRecord(rawCol);
      const colName = normalizeText(col.name);
      if (colName) expectedColMap.set(colName, col);
    }
    for (const rawCol of actualColumns) {
      const col = safeRecord(rawCol);
      const colName = normalizeText(col.name);
      if (colName) actualColMap.set(colName, col);
    }

    for (const [columnName, expectedColumn] of expectedColMap.entries()) {
      const actualColumn = actualColMap.get(columnName);
      if (!actualColumn) {
        diffs.push({
          category: "crosstab",
          severity: "critical",
          kind: "missing_column",
          message: `Missing crosstab column: ${groupName} :: ${columnName}`,
          meaningful: true,
          weight: 2.4,
          groupName,
          columnName,
        });
        continue;
      }

      const expectedPrimary = normalizeExpression(expectedColumn.adjusted);
      const actualPrimary = normalizeExpression(actualColumn.adjusted);
      if (expectedPrimary !== actualPrimary) {
        diffs.push({
          category: "crosstab",
          severity: "critical",
          kind: "primary_expression_mismatch",
          message: `Primary crosstab expression changed in ${groupName} :: ${columnName}`,
          meaningful: true,
          weight: 2.2,
          groupName,
          columnName,
          field: "adjusted",
          expected: expectedPrimary,
          actual: actualPrimary,
        });
      }

      const expectedAltSet = new Set(
        safeArray(expectedColumn.alternatives)
          .map((alt) => {
            const altRec = safeRecord(alt);
            return normalizeExpression(altRec.expression ?? altRec.adjusted ?? "");
          })
          .filter(Boolean)
      );
      const actualAltSet = new Set(
        safeArray(actualColumn.alternatives)
          .map((alt) => {
            const altRec = safeRecord(alt);
            return normalizeExpression(altRec.expression ?? altRec.adjusted ?? "");
          })
          .filter(Boolean)
      );
      const expectedAlts = Array.from(expectedAltSet).sort();
      const actualAlts = Array.from(actualAltSet).sort();
      if (expectedAlts.join("|") !== actualAlts.join("|")) {
        diffs.push({
          category: "crosstab",
          severity: "minor",
          kind: "alternatives_mismatch",
          message: `Alternative expressions changed in ${groupName} :: ${columnName}`,
          meaningful: true,
          weight: 0.8,
          groupName,
          columnName,
          field: "alternatives",
          expected: expectedAlts.join(", "),
          actual: actualAlts.join(", "),
        });
      }
    }

    for (const columnName of actualColMap.keys()) {
      if (!expectedColMap.has(columnName)) {
        diffs.push({
          category: "crosstab",
          severity: "major",
          kind: "extra_column",
          message: `Unexpected crosstab column: ${groupName} :: ${columnName}`,
          meaningful: true,
          weight: 1.4,
          groupName,
          columnName,
        });
      }
    }
  }

  for (const groupName of actualMap.keys()) {
    if (!expectedMap.has(groupName)) {
      diffs.push({
        category: "crosstab",
        severity: "major",
        kind: "extra_group",
        message: `Unexpected crosstab group: ${groupName}`,
        meaningful: true,
        weight: 1.8,
        groupName,
      });
    }
  }

  return {
    score: roundScore(evaluateScoreFromDiffs(diffs)),
    diffs,
  };
}

function compareStructure(expected: unknown, actual: unknown): CategoryComputation {
  const diffs: EvaluationDiff[] = [];
  const expectedTables = safeArray(safeRecord(expected).tables);
  const actualTables = safeArray(safeRecord(actual).tables);
  const expectedMap = new Map<string, Record<string, unknown>>();
  const actualMap = new Map<string, Record<string, unknown>>();

  for (const rawTable of expectedTables) {
    const table = safeRecord(rawTable);
    const tableId = normalizeText(table.tableId);
    if (tableId) expectedMap.set(tableId, table);
  }
  for (const rawTable of actualTables) {
    const table = safeRecord(rawTable);
    const tableId = normalizeText(table.tableId);
    if (tableId) actualMap.set(tableId, table);
  }

  for (const [tableId, expectedTable] of expectedMap.entries()) {
    const actualTable = actualMap.get(tableId);
    if (!actualTable) {
      diffs.push({
        category: "structure",
        severity: "critical",
        kind: "missing_table",
        message: `Missing table in verification output: ${tableId}`,
        meaningful: true,
        weight: 3,
        tableId,
      });
      continue;
    }

    const tableFields = ["tableType", "title", "exclude"] as const;
    for (const field of tableFields) {
      const expectedValue = field === "title"
        ? normalizeText(expectedTable[field])
        : summarizeValue(expectedTable[field]);
      const actualValue = field === "title"
        ? normalizeText(actualTable[field])
        : summarizeValue(actualTable[field]);
      if (expectedValue !== actualValue) {
        diffs.push({
          category: "structure",
          severity: field === "tableType" ? "critical" : "major",
          kind: "table_field_mismatch",
          message: `Table ${field} mismatch for ${tableId}`,
          meaningful: true,
          weight: field === "tableType" ? 2 : 1.2,
          tableId,
          field,
          expected: expectedValue,
          actual: actualValue,
        });
      }
    }

    const expectedRows = safeArray(expectedTable.rows).map((row) => safeRecord(row));
    const actualRows = safeArray(actualTable.rows).map((row) => safeRecord(row));
    if (expectedRows.length !== actualRows.length) {
      diffs.push({
        category: "structure",
        severity: "critical",
        kind: "row_count_mismatch",
        message: `Row count mismatch for ${tableId}`,
        meaningful: true,
        weight: 2.2,
        tableId,
        field: "rows.length",
        expected: String(expectedRows.length),
        actual: String(actualRows.length),
      });
    }

    const compareLength = Math.min(expectedRows.length, actualRows.length);
    for (let i = 0; i < compareLength; i++) {
      const expRow = expectedRows[i];
      const actRow = actualRows[i];
      const rowKey = normalizeText(expRow.variable || expRow.label || String(i));
      const rowFields = ["variable", "label", "filterValue", "isNet"] as const;
      for (const field of rowFields) {
        const expVal = field === "label" ? normalizeText(expRow[field]) : summarizeValue(expRow[field]);
        const actVal = field === "label" ? normalizeText(actRow[field]) : summarizeValue(actRow[field]);
        if (expVal !== actVal) {
          diffs.push({
            category: "structure",
            severity: field === "variable" ? "critical" : "major",
            kind: "row_mismatch",
            message: `Row schema/order mismatch in ${tableId} at index ${i}`,
            meaningful: true,
            weight: field === "variable" ? 1.8 : 1,
            tableId,
            rowKey,
            field,
            expected: expVal,
            actual: actVal,
          });
        }
      }
    }
  }

  for (const [tableId] of actualMap.entries()) {
    if (!expectedMap.has(tableId)) {
      diffs.push({
        category: "structure",
        severity: "major",
        kind: "extra_table",
        message: `Unexpected extra table in verification output: ${tableId}`,
        meaningful: true,
        weight: 1.8,
        tableId,
      });
    }
  }

  return {
    score: roundScore(evaluateScoreFromDiffs(diffs)),
    diffs,
  };
}

function compareNumericField(expected: unknown, actual: unknown, tolerance: number): "equal" | "acceptable" | "meaningful" {
  const expNum = toNumber(expected);
  const actNum = toNumber(actual);
  if (expNum === null && actNum === null) return "equal";
  if (expNum === null || actNum === null) return "meaningful";
  const delta = Math.abs(expNum - actNum);
  if (delta === 0) return "equal";
  if (delta <= tolerance) return "acceptable";
  return "meaningful";
}

function compareData(expected: unknown, actual: unknown): CategoryComputation {
  const diffs: EvaluationDiff[] = [];
  const expectedRoot = safeRecord(expected);
  const actualRoot = safeRecord(actual);

  for (const tableId of listUnionKeys(expectedRoot, actualRoot)) {
    const expectedTable = safeRecord(expectedRoot[tableId]);
    const actualTable = safeRecord(actualRoot[tableId]);

    if (!(tableId in expectedRoot)) {
      diffs.push({
        category: "data",
        severity: "major",
        kind: "extra_table",
        message: `Unexpected table in streamlined data: ${tableId}`,
        meaningful: true,
        weight: 1.4,
        tableId,
      });
      continue;
    }
    if (!(tableId in actualRoot)) {
      diffs.push({
        category: "data",
        severity: "critical",
        kind: "missing_table",
        message: `Missing table in streamlined data: ${tableId}`,
        meaningful: true,
        weight: 2.6,
        tableId,
      });
      continue;
    }

    for (const cut of listUnionKeys(expectedTable, actualTable)) {
      const expectedCut = safeRecord(expectedTable[cut]);
      const actualCut = safeRecord(actualTable[cut]);

      if (!(cut in expectedTable)) {
        diffs.push({
          category: "data",
          severity: "major",
          kind: "extra_cut",
          message: `Unexpected cut ${cut} in ${tableId}`,
          meaningful: true,
          weight: 1.2,
          tableId,
          cut,
        });
        continue;
      }
      if (!(cut in actualTable)) {
        diffs.push({
          category: "data",
          severity: "critical",
          kind: "missing_cut",
          message: `Missing cut ${cut} in ${tableId}`,
          meaningful: true,
          weight: 2.1,
          tableId,
          cut,
        });
        continue;
      }

      for (const rowKey of listUnionKeys(expectedCut, actualCut)) {
        const expectedRow = safeRecord(expectedCut[rowKey]);
        const actualRow = safeRecord(actualCut[rowKey]);

        if (!(rowKey in expectedCut)) {
          diffs.push({
            category: "data",
            severity: "major",
            kind: "extra_row",
            message: `Unexpected row ${rowKey} in ${tableId} :: ${cut}`,
            meaningful: true,
            weight: 0.8,
            tableId,
            cut,
            rowKey,
          });
          continue;
        }
        if (!(rowKey in actualCut)) {
          diffs.push({
            category: "data",
            severity: "critical",
            kind: "missing_row",
            message: `Missing row ${rowKey} in ${tableId} :: ${cut}`,
            meaningful: true,
            weight: 1.6,
            tableId,
            cut,
            rowKey,
          });
          continue;
        }

        const numericTolerances: Record<string, number> = {
          pct: 0.1,
          count: 1,
          n: 1,
          mean: 0.05,
          median: 0.05,
          sd: 0.05,
        };
        const numericFields = Object.keys(numericTolerances);
        for (const field of numericFields) {
          if (!(field in expectedRow) && !(field in actualRow)) continue;
          const outcome = compareNumericField(expectedRow[field], actualRow[field], numericTolerances[field]);
          if (outcome === "equal") continue;
          const meaningful = outcome === "meaningful";
          diffs.push({
            category: "data",
            severity: meaningful ? "major" : "minor",
            kind: "numeric_mismatch",
            message: `Numeric mismatch (${field}) at ${tableId} :: ${cut} :: ${rowKey}`,
            meaningful,
            weight: meaningful ? 1 : 0.45,
            tableId,
            cut,
            rowKey,
            field,
            expected: summarizeValue(expectedRow[field]),
            actual: summarizeValue(actualRow[field]),
          });
        }

        const expectedSigHigher = toComparableSet(expectedRow.sig_higher_than);
        const actualSigHigher = toComparableSet(actualRow.sig_higher_than);
        if (expectedSigHigher.join("|") !== actualSigHigher.join("|")) {
          diffs.push({
            category: "data",
            severity: "major",
            kind: "significance_membership_mismatch",
            message: `Significance membership changed at ${tableId} :: ${cut} :: ${rowKey}`,
            meaningful: true,
            weight: 0.8,
            tableId,
            cut,
            rowKey,
            field: "sig_higher_than",
            expected: expectedSigHigher.join(", "),
            actual: actualSigHigher.join(", "),
          });
        }

        const expectedSigVsTotal = summarizeValue(expectedRow.sig_vs_total);
        const actualSigVsTotal = summarizeValue(actualRow.sig_vs_total);
        if (expectedSigVsTotal !== actualSigVsTotal) {
          diffs.push({
            category: "data",
            severity: "minor",
            kind: "sig_vs_total_mismatch",
            message: `sig_vs_total changed at ${tableId} :: ${cut} :: ${rowKey}`,
            meaningful: true,
            weight: 0.4,
            tableId,
            cut,
            rowKey,
            field: "sig_vs_total",
            expected: expectedSigVsTotal,
            actual: actualSigVsTotal,
          });
        }
      }
    }
  }

  return {
    score: roundScore(evaluateScoreFromDiffs(diffs)),
    diffs,
  };
}

function compareDiagnostics(runDiagnostics?: RunDiagnosticsInput): CategoryComputation {
  return {
    score: roundScore(computeDiagnosticsScore(runDiagnostics)),
    diffs: [],
  };
}

function diffSeverityRank(severity: DiffSeverity): number {
  switch (severity) {
    case "critical":
      return 0;
    case "major":
      return 1;
    default:
      return 2;
  }
}

function classifyDivergence(score: number, diffs: EvaluationDiff[]): DivergenceLevel {
  const meaningfulDiffs = diffs.filter((d) => d.meaningful);
  if (meaningfulDiffs.length === 0) return "none";
  const hasCritical = meaningfulDiffs.some((d) => d.severity === "critical");
  if (hasCritical || score < 88) return "major";
  return "minor";
}

export function evaluateRunArtifacts(input: EvaluateRunInput): RunEvaluationResult {
  const banner = compareBanner(input.expected.banner, input.actual.banner);
  const crosstab = compareCrosstab(input.expected.crosstab, input.actual.crosstab);
  const structure = compareStructure(input.expected.verification, input.actual.verification);
  const data = compareData(input.expected.data, input.actual.data);
  const diagnostics = compareDiagnostics(input.runDiagnostics);

  const weightedScore =
    crosstab.score * CATEGORY_WEIGHTS.crosstab +
    structure.score * CATEGORY_WEIGHTS.structure +
    data.score * CATEGORY_WEIGHTS.data +
    diagnostics.score * CATEGORY_WEIGHTS.diagnostics;
  const score = roundScore(weightedScore);
  const grade = gradeFromScore(score);

  const diffs = [...banner.diffs, ...crosstab.diffs, ...structure.diffs, ...data.diffs];
  const meaningfulCount = diffs.filter((d) => d.meaningful).length;
  const acceptableCount = diffs.length - meaningfulCount;
  const divergenceLevel = classifyDivergence(score, diffs);
  const summary = `Score ${score} (${grade}) with ${divergenceLevel} divergence. Meaningful diffs: ${meaningfulCount}, acceptable diffs: ${acceptableCount}.`;

  const topDiffs = [...diffs]
    .sort((a, b) => {
      const severityDelta = diffSeverityRank(a.severity) - diffSeverityRank(b.severity);
      if (severityDelta !== 0) return severityDelta;
      const categoryDelta = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
      if (categoryDelta !== 0) return categoryDelta;
      return b.weight - a.weight;
    })
    .slice(0, 25);

  return {
    score,
    grade,
    divergenceLevel,
    summary,
    breakdown: {
      banner: banner.score,
      crosstab: crosstab.score,
      structure: structure.score,
      data: data.score,
      diagnostics: diagnostics.score,
    },
    diffCounts: {
      total: diffs.length,
      meaningful: meaningfulCount,
      acceptable: acceptableCount,
    },
    topDiffs,
    diffs,
  };
}

export async function readJsonFileOrNull(filePath: string): Promise<unknown | null> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
