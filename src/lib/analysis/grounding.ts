import { ResultsTablesArtifactSchema, CrosstabRawArtifactSchema } from "@/lib/exportData/inputArtifactSchemas";
import { buildQuestionContext, type QuestionIdFinalFile } from "@/lib/questionContext/adapters";
import { downloadFile } from "@/lib/r2/r2";
import { parseRunResult } from "@/schemas/runResultSchema";

import type {
  AnalysisAvailabilityStatus,
  AnalysisBannerCutsResult,
  AnalysisBannerGroupResult,
  AnalysisCatalogSearchResult,
  AnalysisQuestionContextResult,
  AnalysisSourceRef,
  AnalysisTableCardCell,
  AnalysisTableCardColumn,
  AnalysisTableCardColumnGroup,
  AnalysisTableCardResult,
  AnalysisValueMode,
} from "@/lib/analysis/types";

const TABLES_JSON_PATH = "results/tables.json";
const QUESTION_ID_FINAL_PATH = "enrichment/12-questionid-final.json";
const CROSSTAB_PLAN_PATH = "planning/21-crosstab-plan.json";
const DEFAULT_QUESTION_ITEM_LIMIT = 12;
const DEFAULT_CARD_PREVIEW_ROW_LIMIT = 8;
const DEFAULT_CARD_PREVIEW_GROUP_LIMIT = 1;
const TOTAL_GROUP_KEY = "__total__";

type BuiltQuestionContext = ReturnType<typeof buildQuestionContext>[number];

interface RawTableRow {
  label?: string;
  groupName?: string;
  rowKind?: string;
  statType?: string;
  n?: number;
  count?: number;
  pct?: number;
  mean?: number;
  sig_higher_than?: string[] | string | null;
  sig_vs_total?: string | null;
  isNet?: boolean;
  indent?: number;
}

interface RawTableCut {
  stat_letter?: string;
  table_base_n?: number;
  [rowKey: string]: RawTableRow | number | string | undefined;
}

interface RawTableEntry {
  tableId?: string;
  questionId?: string;
  questionText?: string;
  tableType?: string;
  surveySection?: string;
  baseText?: string;
  userNote?: string;
  tableSubtitle?: string;
  excluded?: boolean;
  data?: Record<string, RawTableCut>;
}

interface RawBannerColumn {
  name: string;
  statLetter: string | null;
  expression: string | null;
}

interface RawBannerGroup {
  groupName: string;
  columns: RawBannerColumn[];
}

interface AnalysisTablesMetadata {
  significanceTest: string | null;
  significanceLevel: number | null;
  comparisonGroups: string[];
}

interface SelectedCut {
  cutKey: string;
  cutName: string;
  groupKey: string;
  groupName: string | null;
  statLetter: string | null;
  baseN: number | null;
  isTotal: boolean;
  cut: RawTableCut;
}

export interface AnalysisGroundingContext {
  availability: AnalysisAvailabilityStatus;
  tables: Record<string, RawTableEntry>;
  questions: BuiltQuestionContext[];
  bannerGroups: RawBannerGroup[];
  tablesMetadata: AnalysisTablesMetadata;
  missingArtifacts: string[];
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeText(value)
    .split(" ")
    .filter((token) => token.length > 0);
}

function compactText(parts: Array<string | null | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .trim();
}

function scoreMatch(query: string, ...targets: Array<string | null | undefined>): number {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return 0;

  const queryTokens = tokenize(query);
  const haystack = normalizeText(targets.join(" "));
  if (!haystack) return 0;

  let score = 0;
  if (haystack === normalizedQuery) score += 120;
  if (haystack.includes(normalizedQuery)) score += 80;

  for (const token of queryTokens) {
    if (!token) continue;
    if (haystack.includes(token)) {
      score += token.length >= 5 ? 24 : token.length >= 3 ? 16 : 8;
    }
  }

  return score;
}

function sortByScore<T extends { score: number }>(values: T[]): T[] {
  return [...values].sort((a, b) => b.score - a.score);
}

function formatNumber(value: number, digits: number): string {
  return value.toFixed(digits).replace(/\.0+$|(\.\d*?)0+$/, "$1");
}

function formatCellValue(value: number | null, valueMode: AnalysisValueMode): string {
  if (value === null || !Number.isFinite(value)) return "—";

  switch (valueMode) {
    case "pct":
      return `${formatNumber(value, 0)}%`;
    case "mean":
      return formatNumber(value, 1);
    case "count":
    case "n":
      return formatNumber(value, 0);
    default:
      return String(value);
  }
}

function normalizeSigHigherThan(value: string[] | string | null | undefined): string[] {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string");
  if (typeof value === "string" && value.trim().length > 0) return value.split("");
  return [];
}

function isRawTableRow(value: unknown): value is RawTableRow {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt((value ?? "").trim(), 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return fallback;
}

function getAnalysisCardPreviewRowLimit(): number {
  return parsePositiveInteger(
    process.env.ANALYSIS_TABLE_CARD_VISIBLE_ROWS,
    DEFAULT_CARD_PREVIEW_ROW_LIMIT,
  );
}

function getAnalysisCardPreviewGroupLimit(): number {
  return parsePositiveInteger(
    process.env.ANALYSIS_TABLE_CARD_VISIBLE_GROUPS,
    DEFAULT_CARD_PREVIEW_GROUP_LIMIT,
  );
}

function deriveAvailability(missingArtifacts: string[], hasAnyArtifact: boolean): AnalysisAvailabilityStatus {
  if (!hasAnyArtifact) return "unavailable";
  return missingArtifacts.length > 0 ? "partial" : "available";
}

function deriveTitle(table: RawTableEntry, tableId: string): string {
  const primary = compactText([table.questionText, table.tableSubtitle]);
  return primary || table.tableId || tableId;
}

function collectRowKeys(table: RawTableEntry): string[] {
  const cuts = Object.values(table.data ?? {});
  const rowKeySet = new Set<string>();

  for (const cut of cuts) {
    for (const key of Object.keys(cut)) {
      if (key === "stat_letter" || key === "table_base_n") continue;
      const value = cut[key];
      if (isRawTableRow(value)) {
        rowKeySet.add(key);
      }
    }
  }

  return [...rowKeySet].sort((a, b) => {
    const aMatch = a.match(/^row_(\d+)_/);
    const bMatch = b.match(/^row_(\d+)_/);
    if (aMatch && bMatch) return Number(aMatch[1]) - Number(bMatch[1]);
    return a.localeCompare(b);
  });
}

function resolveCutBaseN(cut: RawTableCut): number | null {
  if (typeof cut.table_base_n === "number" && Number.isFinite(cut.table_base_n)) {
    return cut.table_base_n;
  }

  for (const [key, value] of Object.entries(cut)) {
    if (key === "stat_letter" || key === "table_base_n") continue;
    if (isRawTableRow(value) && typeof value.n === "number" && Number.isFinite(value.n)) {
      return value.n;
    }
  }

  return null;
}

function isTotalCut(cutName: string, cut: RawTableCut): boolean {
  if (normalizeText(cutName) === "total") return true;

  const firstRow = Object.values(cut).find(isRawTableRow);
  if (!firstRow) return false;

  return normalizeText(firstRow.groupName) === "total";
}

function deriveCutGroupName(
  cutName: string,
  cut: RawTableCut,
  bannerGroupLookup?: Map<string, string>,
): string | null {
  if (isTotalCut(cutName, cut)) return "Total";

  const rowGroupName = Object.values(cut).find(isRawTableRow)?.groupName ?? null;
  if (rowGroupName) return rowGroupName;

  return bannerGroupLookup?.get(normalizeText(cutName)) ?? null;
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

function buildBannerGroupLookup(bannerGroups: RawBannerGroup[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const group of bannerGroups) {
    for (const column of group.columns) {
      lookup.set(normalizeText(column.name), group.groupName);
    }
  }
  return lookup;
}

function buildSelectedCuts(
  table: RawTableEntry,
  cutFilter: string | null,
  bannerGroups: RawBannerGroup[],
): {
  cuts: SelectedCut[];
  columnGroups: AnalysisTableCardColumnGroup[];
  defaultScope: "total_only" | "matched_groups";
  initialVisibleGroupCount: number;
  hiddenGroupCount: number;
  hiddenCutCount: number;
} {
  const bannerGroupLookup = buildBannerGroupLookup(bannerGroups);
  const allCuts = Object.entries(table.data ?? {})
    .map(([cutName, cut]): SelectedCut => {
      const isTotal = isTotalCut(cutName, cut);
      const groupName = deriveCutGroupName(cutName, cut, bannerGroupLookup);
      const groupKey = deriveCutGroupKey(groupName, cutName, isTotal);

      return {
        cutKey: deriveCutKey(groupKey, cutName),
        cutName,
        groupKey,
        groupName,
        statLetter: typeof cut.stat_letter === "string" ? cut.stat_letter : null,
        baseN: resolveCutBaseN(cut),
        isTotal,
        cut,
      };
    });

  const totalCuts = allCuts.filter((cut) => cut.isTotal);
  const groupsByKey = new Map<string, SelectedCut[]>();
  const orderedGroups: Array<{ groupKey: string; groupName: string | null; cuts: SelectedCut[] }> = [];

  for (const cut of allCuts.filter((entry) => !entry.isTotal)) {
    const existing = groupsByKey.get(cut.groupKey);
    if (existing) {
      existing.push(cut);
      continue;
    }

    const nextCuts = [cut];
    groupsByKey.set(cut.groupKey, nextCuts);
    orderedGroups.push({
      groupKey: cut.groupKey,
      groupName: cut.groupName,
      cuts: nextCuts,
    });
  }

  const matchedGroups = cutFilter
    ? orderedGroups.filter((group) =>
        group.cuts.some((cut) =>
          scoreMatch(cutFilter, group.groupName, cut.cutName, cut.statLetter) > 0,
        ) || scoreMatch(cutFilter, group.groupName) > 0)
    : orderedGroups;

  const selectedNonTotalGroups = matchedGroups.length > 0 ? matchedGroups : orderedGroups;
  const selectedGroups: AnalysisTableCardColumnGroup[] = [];

  if (totalCuts.length > 0) {
    selectedGroups.push({
      groupKey: TOTAL_GROUP_KEY,
      groupName: "Total",
      columns: totalCuts.map((cut) => ({
        cutKey: cut.cutKey,
        cutName: cut.cutName,
        groupName: cut.groupName,
        statLetter: cut.statLetter,
        baseN: cut.baseN,
        isTotal: true,
      })),
    });
  }

  for (const group of selectedNonTotalGroups) {
    selectedGroups.push({
      groupKey: group.groupKey,
      groupName: group.groupName,
      columns: group.cuts.map((cut) => ({
        cutKey: cut.cutKey,
        cutName: cut.cutName,
        groupName: cut.groupName,
        statLetter: cut.statLetter,
        baseN: cut.baseN,
        isTotal: false,
      })),
    });
  }

  const defaultScope = totalCuts.length > 0 && !cutFilter ? "total_only" : "matched_groups";
  const initialVisibleGroupCount = defaultScope === "matched_groups"
    ? Math.min(getAnalysisCardPreviewGroupLimit(), selectedNonTotalGroups.length)
    : 0;

  return {
    cuts: [
      ...totalCuts,
      ...selectedNonTotalGroups.flatMap((group) => group.cuts),
    ],
    columnGroups: selectedGroups,
    defaultScope,
    initialVisibleGroupCount,
    hiddenGroupCount: Math.max(selectedNonTotalGroups.length - initialVisibleGroupCount, 0),
    hiddenCutCount: selectedNonTotalGroups
      .slice(initialVisibleGroupCount)
      .reduce((sum, group) => sum + group.cuts.length, 0),
  };
}

function resolvePreferredValueMode(tableType: string | null | undefined, requested: AnalysisValueMode | undefined): AnalysisValueMode {
  if (requested) return requested;
  if ((tableType ?? "").toLowerCase().includes("mean")) return "mean";
  return "pct";
}

function resolveValueForMode(row: RawTableRow, valueMode: AnalysisValueMode): number | null {
  const primary = row[valueMode];
  if (typeof primary === "number" && Number.isFinite(primary)) return primary;

  const fallbacks: AnalysisValueMode[] = valueMode === "mean"
    ? ["mean", "pct", "count", "n"]
    : valueMode === "pct"
      ? ["pct", "count", "n", "mean"]
      : valueMode === "count"
        ? ["count", "n", "pct", "mean"]
        : ["n", "count", "pct", "mean"];

  for (const key of fallbacks) {
    const next = row[key];
    if (typeof next === "number" && Number.isFinite(next)) return next;
  }

  return null;
}

function buildBannerGroups(
  tablesArtifact: ReturnType<typeof ResultsTablesArtifactSchema.parse> | null,
  crosstabArtifact: ReturnType<typeof CrosstabRawArtifactSchema.parse> | null,
): RawBannerGroup[] {
  const expressionLookup = new Map<string, string>();
  for (const group of crosstabArtifact?.bannerCuts ?? []) {
    for (const column of group.columns) {
      expressionLookup.set(`${group.groupName}::${column.name}`, column.adjusted ?? "");
    }
  }

  const metadataGroups = Array.isArray(tablesArtifact?.metadata?.bannerGroups)
    ? tablesArtifact?.metadata?.bannerGroups as Array<{
        groupName?: string;
        columns?: Array<{ name?: string; statLetter?: string }>;
      }>
    : [];

  if (metadataGroups.length > 0) {
    return metadataGroups
      .filter((group) => typeof group.groupName === "string" && Array.isArray(group.columns))
      .map((group) => ({
        groupName: group.groupName!,
        columns: (group.columns ?? [])
          .filter((column) => typeof column.name === "string")
          .map((column) => ({
            name: column.name!,
            statLetter: typeof column.statLetter === "string" ? column.statLetter : null,
            expression: expressionLookup.get(`${group.groupName}::${column.name}`) || null,
          })),
      }));
  }

  return (crosstabArtifact?.bannerCuts ?? []).map((group) => ({
    groupName: group.groupName,
    columns: group.columns.map((column) => ({
      name: column.name,
      statLetter: null,
      expression: column.adjusted ?? null,
    })),
  }));
}

function buildTablesMetadata(
  tablesArtifact: ReturnType<typeof ResultsTablesArtifactSchema.parse> | null,
): AnalysisTablesMetadata {
  const metadata = tablesArtifact?.metadata;
  return {
    significanceTest: typeof metadata?.significanceTest === "string" ? metadata.significanceTest : null,
    significanceLevel: typeof metadata?.significanceLevel === "number"
      ? metadata.significanceLevel
      : typeof metadata?.significanceThresholds === "number"
        ? metadata.significanceThresholds
        : null,
    comparisonGroups: Array.isArray(metadata?.comparisonGroups)
      ? metadata.comparisonGroups.filter((entry): entry is string => typeof entry === "string")
      : [],
  };
}

async function downloadJsonArtifact<T>(key: string): Promise<T> {
  const buffer = await downloadFile(key);
  return JSON.parse(buffer.toString("utf-8")) as T;
}

function buildMissingMessage(missingArtifacts: string[]): string {
  if (missingArtifacts.length === 0) return "Run artifacts are available.";
  return `Some run artifacts are unavailable: ${missingArtifacts.join(", ")}.`;
}

function resolveSourceRefs(tableId: string, questionId: string | null, title: string): AnalysisSourceRef[] {
  const refs: AnalysisSourceRef[] = [
    { refType: "table", refId: tableId, label: title },
  ];

  if (questionId) {
    refs.push({ refType: "question", refId: questionId, label: questionId });
  }

  return refs;
}

export async function loadAnalysisGroundingContext(runResultValue: unknown): Promise<AnalysisGroundingContext> {
  const runResult = parseRunResult(runResultValue) ?? {};
  const outputs = runResult.r2Files?.outputs ?? {};

  const tablesKey = outputs[TABLES_JSON_PATH] ?? null;
  const questionKey = outputs[QUESTION_ID_FINAL_PATH] ?? runResult.reviewR2Keys?.v3QuestionIdFinal ?? null;
  const crosstabKey = outputs[CROSSTAB_PLAN_PATH] ?? runResult.reviewR2Keys?.v3CrosstabPlan ?? null;

  const [tablesResult, questionResult, crosstabResult] = await Promise.allSettled([
    tablesKey ? downloadJsonArtifact<unknown>(tablesKey) : Promise.resolve(null),
    questionKey ? downloadJsonArtifact<QuestionIdFinalFile>(questionKey) : Promise.resolve(null),
    crosstabKey ? downloadJsonArtifact<unknown>(crosstabKey) : Promise.resolve(null),
  ]);

  const missingArtifacts: string[] = [];

  const tablesArtifact = (() => {
    if (!tablesKey) {
      missingArtifacts.push(TABLES_JSON_PATH);
      return null;
    }
    if (tablesResult.status !== "fulfilled" || !tablesResult.value) {
      missingArtifacts.push(TABLES_JSON_PATH);
      return null;
    }
    return ResultsTablesArtifactSchema.parse(tablesResult.value);
  })();

  const questionArtifact = (() => {
    if (!questionKey) {
      missingArtifacts.push(QUESTION_ID_FINAL_PATH);
      return null;
    }
    if (questionResult.status !== "fulfilled" || !questionResult.value) {
      missingArtifacts.push(QUESTION_ID_FINAL_PATH);
      return null;
    }
    return questionResult.value;
  })();

  const crosstabArtifact = (() => {
    if (!crosstabKey) {
      missingArtifacts.push(CROSSTAB_PLAN_PATH);
      return null;
    }
    if (crosstabResult.status !== "fulfilled" || !crosstabResult.value) {
      missingArtifacts.push(CROSSTAB_PLAN_PATH);
      return null;
    }
    return CrosstabRawArtifactSchema.parse(crosstabResult.value);
  })();

  const questions = questionArtifact ? buildQuestionContext(questionArtifact) : [];

  return {
    availability: deriveAvailability(
      missingArtifacts,
      Boolean(tablesArtifact || questionArtifact || crosstabArtifact),
    ),
    tables: tablesArtifact?.tables ?? {},
    questions,
    bannerGroups: buildBannerGroups(tablesArtifact, crosstabArtifact),
    tablesMetadata: buildTablesMetadata(tablesArtifact),
    missingArtifacts,
  };
}

export function searchRunCatalog(
  context: AnalysisGroundingContext,
  query: string,
): AnalysisCatalogSearchResult {
  if (context.availability === "unavailable") {
    return {
      status: "unavailable",
      query,
      questions: [],
      tables: [],
      cuts: [],
      message: buildMissingMessage(context.missingArtifacts),
    };
  }

  const questionMatches = sortByScore(
    context.questions
      .map((question) => ({
        questionId: question.questionId,
        questionText: question.questionText,
        normalizedType: question.normalizedType,
        analyticalSubtype: question.analyticalSubtype ?? null,
        score: scoreMatch(
          query,
          question.questionId,
          question.questionText,
          question.normalizedType,
          question.analyticalSubtype,
          ...question.items.map((item) => item.label),
        ),
      }))
      .filter((match) => match.score > 0),
  ).slice(0, 5);

  const tableMatches = sortByScore(
    Object.entries(context.tables)
      .map(([tableId, table]) => ({
        tableId,
        title: deriveTitle(table, tableId),
        questionId: table.questionId ?? null,
        questionText: table.questionText ?? null,
        tableType: table.tableType ?? null,
        score: scoreMatch(
          query,
          tableId,
          table.questionId,
          table.questionText,
          table.tableSubtitle,
          table.baseText,
          table.userNote,
          ...collectRowKeys(table)
            .slice(0, 16)
            .map((rowKey) => {
              const totalCut = Object.values(table.data ?? {})[0];
              const row = totalCut && isRawTableRow(totalCut[rowKey]) ? totalCut[rowKey] : null;
              return row?.label ?? rowKey;
            }),
        ),
      }))
      .filter((match) => match.score > 0),
  ).slice(0, 5);

  const cutMatches = sortByScore(
    context.bannerGroups
      .flatMap((group) => group.columns.map((column) => ({
        groupName: group.groupName,
        cutName: column.name,
        statLetter: column.statLetter,
        score: scoreMatch(query, group.groupName, column.name, column.statLetter),
      })))
      .filter((match) => match.score > 0),
  ).slice(0, 8);

  return {
    status: context.availability,
    query,
    questions: questionMatches,
    tables: tableMatches,
    cuts: cutMatches,
    ...(context.missingArtifacts.length > 0 ? { message: buildMissingMessage(context.missingArtifacts) } : {}),
  };
}

export function getQuestionContext(
  context: AnalysisGroundingContext,
  questionId: string,
): AnalysisQuestionContextResult {
  if (context.availability === "unavailable" && context.questions.length === 0) {
    return {
      status: "unavailable",
      questionId,
      questionText: null,
      normalizedType: null,
      analyticalSubtype: null,
      disposition: null,
      surveyMatch: null,
      loop: null,
      hiddenLink: null,
      baseSummary: null,
      items: [],
      totalItems: 0,
      truncatedItems: 0,
      relatedTableIds: [],
      sourceRefs: [],
      message: buildMissingMessage(context.missingArtifacts),
    };
  }

  const normalizedQuestionId = normalizeText(questionId);
  const match = context.questions.find((question) => normalizeText(question.questionId) === normalizedQuestionId);

  if (!match) {
    return {
      status: "not_found",
      questionId,
      questionText: null,
      normalizedType: null,
      analyticalSubtype: null,
      disposition: null,
      surveyMatch: null,
      loop: null,
      hiddenLink: null,
      baseSummary: null,
      items: [],
      totalItems: 0,
      truncatedItems: 0,
      relatedTableIds: [],
      sourceRefs: [],
      message: `Question ${questionId} was not found in this run's grounded artifacts.`,
    };
  }

  const relatedTableIds = Object.entries(context.tables)
    .filter(([, table]) => normalizeText(table.questionId) === normalizeText(match.questionId))
    .map(([tableId]) => tableId)
    .sort((a, b) => a.localeCompare(b));

  const items = match.items.slice(0, DEFAULT_QUESTION_ITEM_LIMIT).map((item) => ({
    column: item.column,
    label: item.label,
    normalizedType: item.normalizedType,
    valueLabels: item.valueLabels,
  }));

  return {
    status: context.availability,
    questionId: match.questionId,
    questionText: match.questionText,
    normalizedType: match.normalizedType,
    analyticalSubtype: match.analyticalSubtype ?? null,
    disposition: match.disposition ?? null,
    surveyMatch: match.surveyMatch ?? null,
    loop: match.loop ?? null,
    hiddenLink: match.hiddenLink ?? null,
    baseSummary: match.baseSummary ?? null,
    items,
    totalItems: match.items.length,
    truncatedItems: Math.max(match.items.length - items.length, 0),
    relatedTableIds,
    sourceRefs: [{ refType: "question", refId: match.questionId, label: match.questionText }],
    ...(context.missingArtifacts.length > 0 ? { message: buildMissingMessage(context.missingArtifacts) } : {}),
  };
}

export function listBannerCuts(
  context: AnalysisGroundingContext,
  filter: string | null | undefined,
): AnalysisBannerCutsResult {
  if (context.availability === "unavailable" && context.bannerGroups.length === 0) {
    return {
      status: "unavailable",
      filter: filter?.trim() || null,
      groups: [],
      totalGroups: 0,
      totalCuts: 0,
      message: buildMissingMessage(context.missingArtifacts),
    };
  }

  const normalizedFilter = normalizeText(filter);
  const groups = context.bannerGroups
    .map<AnalysisBannerGroupResult>((group) => ({
      groupName: group.groupName,
      cuts: group.columns.map((column) => ({
        name: column.name,
        statLetter: column.statLetter,
        expression: column.expression,
      })),
    }))
    .filter((group) => {
      if (!normalizedFilter) return true;
      if (scoreMatch(normalizedFilter, group.groupName) > 0) return true;
      return group.cuts.some((cut) => scoreMatch(normalizedFilter, cut.name, cut.statLetter) > 0);
    })
    .map((group) => ({
      ...group,
      cuts: normalizedFilter
        ? group.cuts.filter((cut) => scoreMatch(normalizedFilter, group.groupName, cut.name, cut.statLetter) > 0)
        : group.cuts,
    }))
    .filter((group) => group.cuts.length > 0);

  return {
    status: context.availability,
    filter: filter?.trim() || null,
    groups,
    totalGroups: groups.length,
    totalCuts: groups.reduce((sum, group) => sum + group.cuts.length, 0),
    ...(context.missingArtifacts.length > 0 ? { message: buildMissingMessage(context.missingArtifacts) } : {}),
  };
}

export function getTableCard(
  context: AnalysisGroundingContext,
  args: {
    tableId: string;
    rowFilter?: string | null;
    cutFilter?: string | null;
    valueMode?: AnalysisValueMode;
  },
): AnalysisTableCardResult {
  const table = context.tables[args.tableId];
  if (!table) {
    return {
      status: context.availability === "unavailable" ? "unavailable" : "not_found",
      tableId: args.tableId,
      message: context.availability === "unavailable"
        ? buildMissingMessage(context.missingArtifacts)
        : `Table ${args.tableId} was not found in this run's results.`,
    };
  }

  const rowFilter = args.rowFilter?.trim() || null;
  const cutFilter = args.cutFilter?.trim() || null;
  const valueMode = resolvePreferredValueMode(table.tableType, args.valueMode);
  const rowKeys = collectRowKeys(table);
  const {
    cuts: selectedCuts,
    columnGroups,
    defaultScope,
    initialVisibleGroupCount,
    hiddenGroupCount,
    hiddenCutCount,
  } = buildSelectedCuts(table, cutFilter, context.bannerGroups);
  const columns: AnalysisTableCardColumn[] = columnGroups.flatMap((group) => group.columns);

  const prioritizedRowKeys = rowFilter
    ? (() => {
        const matching = rowKeys.filter((rowKey) => {
          for (const cut of selectedCuts) {
            const row = cut.cut[rowKey];
            if (isRawTableRow(row) && scoreMatch(rowFilter, row.label, rowKey, row.groupName) > 0) {
              return true;
            }
          }
          return false;
        });

        const matchingSet = new Set(matching);
        const remaining = rowKeys.filter((rowKey) => !matchingSet.has(rowKey));
        return [...matching, ...remaining];
      })()
    : rowKeys;

  const rows = prioritizedRowKeys.map((rowKey) => {
    const firstRow = selectedCuts
      .map((cut) => cut.cut[rowKey])
      .find(isRawTableRow);

    const values: AnalysisTableCardCell[] = selectedCuts.map((cut) => {
      const row = cut.cut[rowKey];
      const rawRow = isRawTableRow(row) ? row : {};
      const rawValue = resolveValueForMode(rawRow, valueMode);

      return {
        cutKey: cut.cutKey,
        cutName: cut.cutName,
        rawValue,
        displayValue: formatCellValue(rawValue, valueMode),
        count: typeof rawRow.count === "number" ? rawRow.count : null,
        pct: typeof rawRow.pct === "number" ? rawRow.pct : null,
        n: typeof rawRow.n === "number" ? rawRow.n : null,
        mean: typeof rawRow.mean === "number" ? rawRow.mean : null,
        sigHigherThan: normalizeSigHigherThan(rawRow.sig_higher_than),
        sigVsTotal: typeof rawRow.sig_vs_total === "string" ? rawRow.sig_vs_total : null,
      };
    });

    return {
      rowKey,
      label: firstRow?.label ?? rowKey,
      rowKind: typeof firstRow?.rowKind === "string" ? firstRow.rowKind : undefined,
      statType: typeof firstRow?.statType === "string" ? firstRow.statType : null,
      indent: typeof firstRow?.indent === "number" ? firstRow.indent : 0,
      isNet: Boolean(firstRow?.isNet),
      values,
      cellsByCutKey: Object.fromEntries(values.map((value) => [value.cutKey ?? value.cutName, value])),
    };
  });

  const title = deriveTitle(table, args.tableId);
  const initialVisibleRowCount = Math.min(getAnalysisCardPreviewRowLimit(), rows.length);
  const hiddenRowCount = Math.max(rows.length - initialVisibleRowCount, 0);

  return {
    status: "available",
    tableId: args.tableId,
    title,
    questionId: table.questionId ?? null,
    questionText: table.questionText ?? null,
    tableType: table.tableType ?? null,
    surveySection: table.surveySection ?? null,
    baseText: table.baseText ?? null,
    tableSubtitle: table.tableSubtitle ?? null,
    userNote: table.userNote ?? null,
    valueMode,
    columns,
    columnGroups,
    rows,
    totalRows: rows.length,
    totalColumns: selectedCuts.length,
    truncatedRows: hiddenRowCount,
    truncatedColumns: hiddenCutCount,
    defaultScope,
    initialVisibleRowCount,
    initialVisibleGroupCount,
    hiddenRowCount,
    hiddenGroupCount,
    hiddenCutCount,
    isExpandable: hiddenRowCount > 0 || hiddenGroupCount > 0,
    requestedRowFilter: rowFilter,
    requestedCutFilter: cutFilter,
    significanceTest: context.tablesMetadata.significanceTest,
    significanceLevel: context.tablesMetadata.significanceLevel,
    comparisonGroups: context.tablesMetadata.comparisonGroups,
    sourceRefs: resolveSourceRefs(args.tableId, table.questionId ?? null, title),
  };
}
