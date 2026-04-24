import {
  BannerPlanArtifactSchema,
  BannerRouteMetadataArtifactSchema,
  CrosstabRawArtifactSchema,
  ResultsTablesArtifactSchema,
  SurveyParsedCleanupArtifactSchema,
} from "@/lib/exportData/inputArtifactSchemas";
import { buildQuestionContext, type QuestionIdFinalFile } from "@/lib/questionContext/adapters";
import { downloadFile } from "@/lib/r2/r2";
import { parseRunResult } from "@/schemas/runResultSchema";

import type {
  AnalysisAvailabilityStatus,
  AnalysisBannerCutsInclude,
  AnalysisBannerCutsResult,
  AnalysisBannerGroupResult,
  AnalysisCatalogCutMatch,
  AnalysisCatalogQuestionMatch,
  AnalysisCatalogSearchScope,
  AnalysisCatalogTableMatch,
  AnalysisCellConfirmationColumnCandidate,
  AnalysisCellConfirmationRowCandidate,
  AnalysisCatalogSearchResult,
  AnalysisCellConfirmationResult,
  AnalysisCellSummary,
  AnalysisFetchTableCutGroups,
  AnalysisQuestionContextInclude,
  AnalysisQuestionContextResult,
  AnalysisSourceRef,
  AnalysisTableCard,
  AnalysisTableCardCell,
  AnalysisTableCardColumn,
  AnalysisTableCardColumnGroup,
  AnalysisTableCardRow,
  AnalysisTableCardResult,
  AnalysisValueMode,
} from "@/lib/analysis/types";
import { buildAnalysisCellId } from "@/lib/analysis/types";

const TABLES_JSON_PATH = "results/tables.json";
const QUESTION_ID_FINAL_PATH = "enrichment/12-questionid-final.json";
const BANNER_PLAN_PATH = "planning/20-banner-plan.json";
const BANNER_ROUTE_METADATA_PATH = "planning/banner-route-metadata.json";
const CROSSTAB_PLAN_PATH = "planning/21-crosstab-plan.json";
const SURVEY_MARKDOWN_PATH = "survey/survey-markdown.md";
const SURVEY_PARSED_CLEANUP_PATH = "enrichment/08b-survey-parsed-cleanup.json";
const DEFAULT_QUESTION_ITEM_LIMIT = 12;
const DEFAULT_CARD_PREVIEW_ROW_LIMIT = 8;
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

interface RawBannerPlanColumn {
  name: string;
  original: string;
}

interface RawBannerPlanGroup {
  groupName: string;
  columns: RawBannerPlanColumn[];
}

interface RawBannerRouteMetadata {
  routeUsed: "banner_agent" | "banner_generate";
  usedFallbackFromBannerAgent: boolean;
}

interface RawSurveyAnswerOption {
  code: string | number;
  text: string;
  routing: string | null;
  progNote: string | null;
}

interface RawSurveyScaleLabel {
  value: number;
  label: string;
}

interface RawSurveyQuestion {
  questionId: string;
  rawText: string;
  questionText: string;
  instructionText: string | null;
  answerOptions: RawSurveyAnswerOption[];
  scaleLabels: RawSurveyScaleLabel[];
  questionType: string;
  format: string;
  progNotes: string[];
  sectionHeader: string | null;
}

interface AnalysisTablesMetadata {
  significanceTest: string | null;
  significanceLevel: number | null;
  comparisonGroups: string[];
}

interface AnalysisProjectContext {
  projectName: string | null;
  runStatus: string | null;
  studyMethodology: string | null;
  analysisMethod: string | null;
  bannerSource: "uploaded" | "auto_generated" | null;
  bannerMode: "upload" | "auto_generate" | null;
  tableCount: number | null;
  bannerGroupCount: number | null;
  totalCuts: number | null;
  bannerGroupNames: string[];
  researchObjectives: string | null;
  bannerHints: string | null;
  intakeFiles: {
    dataFile: string | null;
    survey: string | null;
    bannerPlan: string | null;
    messageList: string | null;
  };
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
  bannerPlanGroups: RawBannerPlanGroup[];
  bannerRouteMetadata: RawBannerRouteMetadata | null;
  surveyMarkdown: string | null;
  surveyQuestions: RawSurveyQuestion[];
  projectContext: AnalysisProjectContext;
  tablesMetadata: AnalysisTablesMetadata;
  missingArtifacts: string[];
}

const TOOL_OUTPUT_TEXT_MAX_LENGTH = 4000;
const TOOL_OUTPUT_XML_MAX_LENGTH = 2000;

const INJECTION_SHAPED_LINE_RE = /^\s*(?:system|assistant|user|tool|developer)\s*:|^\s*(?:ignore|disregard|override|forget|follow these instructions|act as|you are now|system prompt|developer message|tool result|call the|use the)\b|^\s*call\s+(?:get|view|list|search)[a-z0-9_]*\b/i;
const INJECTION_SHAPED_TAG_RE = /<\/?(?:system|assistant|user|tool|developer|instruction|instructions|prompt|analysis|policy|message)[^>]*>/gim;
const CODE_FENCE_RE = /```+/g;
const ZERO_WIDTH_RE = /[\u200B-\u200D\uFEFF]/g;

function sanitizeGroundingText(value: string): string {
  const normalized = value
    .replace(/\r\n?/g, "\n")
    .replace(ZERO_WIDTH_RE, "")
    .replace(CODE_FENCE_RE, "")
    .replace(INJECTION_SHAPED_TAG_RE, "")
    .replace(/[<>]/g, "");

  const filteredLines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !INJECTION_SHAPED_LINE_RE.test(line));

  return filteredLines
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TOOL_OUTPUT_TEXT_MAX_LENGTH);
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildRetrievedContextXml(toolName: string, value: unknown): string {
  const serialized = (() => {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  })();

  const sanitized = sanitizeGroundingText(serialized).slice(0, TOOL_OUTPUT_XML_MAX_LENGTH);
  return `<retrieved_context tool="${escapeXmlText(toolName)}">${escapeXmlText(sanitized)}</retrieved_context>`;
}

function shouldPreserveGroundingKey(key: string): boolean {
  return /(id|key)$/i.test(key);
}

export function sanitizeGroundingToolOutput<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeGroundingText(value) as T;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeGroundingToolOutput(item)) as T;
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>).map(([key, entryValue]) => {
    if (shouldPreserveGroundingKey(key) && typeof entryValue === "string") {
      return [key, entryValue];
    }

    return [key, sanitizeGroundingToolOutput(entryValue)];
  });

  return Object.fromEntries(entries) as T;
}

export function attachRetrievedContextXml<T>(toolName: string, value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return value;
  }

  return {
    ...(value as Record<string, unknown>),
    retrievedContextXml: buildRetrievedContextXml(toolName, value),
  } as T;
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

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function extractFileName(value: unknown): string | null {
  const next = asString(value);
  if (!next) return null;

  const segments = next.split("/");
  return segments[segments.length - 1] || next;
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
  bannerGroups: RawBannerGroup[],
): {
  // Every USED cut from the source table, Total first. Cells built against
  // this set so the expand dialog + details disclosure always carry full data.
  allCuts: SelectedCut[];
  columnGroups: AnalysisTableCardColumnGroup[];
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

  const columnGroups: AnalysisTableCardColumnGroup[] = [];

  if (totalCuts.length > 0) {
    columnGroups.push({
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

  for (const group of orderedGroups) {
    columnGroups.push({
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

  return {
    allCuts: [
      ...totalCuts,
      ...orderedGroups.flatMap((group) => group.cuts),
    ],
    columnGroups,
  };
}

function normalizeRequestedCutGroups(
  cutGroups: AnalysisFetchTableCutGroups | null | undefined,
): AnalysisFetchTableCutGroups | null {
  if (cutGroups === "*") return "*";
  if (!Array.isArray(cutGroups)) return null;

  const normalized = cutGroups
    .map((group) => group.trim())
    .filter((group, index, values) => group.length > 0 && values.indexOf(group) === index);

  return normalized.length > 0 ? normalized : null;
}

function getRequestedModelGroupKeys(
  columnGroups: AnalysisTableCardColumnGroup[],
  requestedCutGroups: AnalysisFetchTableCutGroups | null | undefined,
): Set<string> {
  const nonTotalGroups = columnGroups.filter((group) => group.groupKey !== TOTAL_GROUP_KEY);
  if (requestedCutGroups === "*") {
    return new Set(nonTotalGroups.map((group) => group.groupKey));
  }

  const requestedNames = new Set(
    (requestedCutGroups ?? []).map((groupName) => normalizeText(groupName)),
  );

  return new Set(
    nonTotalGroups
      .filter((group) => requestedNames.has(normalizeText(group.groupName)))
      .map((group) => group.groupKey),
  );
}

function projectTableCardForModel(
  card: AnalysisTableCard,
  requestedCutGroups: AnalysisFetchTableCutGroups | null | undefined,
): AnalysisTableCard {
  if (!card.columnGroups || card.columnGroups.length === 0) {
    return card;
  }

  const selectedGroupKeys = getRequestedModelGroupKeys(
    card.columnGroups,
    requestedCutGroups ?? null,
  );

  const visibleGroups = card.columnGroups.filter((group) =>
    group.groupKey === TOTAL_GROUP_KEY || selectedGroupKeys.has(group.groupKey),
  );
  const visibleColumns = visibleGroups.flatMap((group) => group.columns);
  const visibleCutKeys = new Set(
    visibleColumns.map((column) => column.cutKey ?? column.cutName),
  );

  return {
    ...card,
    columns: visibleColumns,
    columnGroups: visibleGroups,
    rows: card.rows.map((row) => ({
      ...row,
      values: row.values.filter((value) =>
        visibleCutKeys.has(value.cutKey ?? value.cutName),
      ),
      cellsByCutKey: row.cellsByCutKey
        ? Object.fromEntries(
          Object.entries(row.cellsByCutKey).filter(([cutKey]) => visibleCutKeys.has(cutKey)),
        )
        : undefined,
    })),
    totalColumns: visibleColumns.length,
    truncatedColumns: Math.max(card.columns.length - visibleColumns.length, 0),
    defaultScope: selectedGroupKeys.size > 0 ? "matched_groups" : "total_only",
    initialVisibleGroupCount: selectedGroupKeys.size > 0 ? selectedGroupKeys.size : 0,
    hiddenGroupCount: Math.max(
      card.columnGroups.filter((group) => group.groupKey !== TOTAL_GROUP_KEY).length - selectedGroupKeys.size,
      0,
    ),
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

async function downloadTextArtifact(key: string): Promise<string> {
  const buffer = await downloadFile(key);
  return buffer.toString("utf-8");
}

function buildBannerPlanGroups(
  bannerPlanArtifact: ReturnType<typeof BannerPlanArtifactSchema.parse> | null,
): RawBannerPlanGroup[] {
  return (bannerPlanArtifact?.bannerCuts ?? []).map((group) => ({
    groupName: group.groupName,
    columns: group.columns.map((column) => ({
      name: column.name,
      original: column.original,
    })),
  }));
}

function buildSurveyQuestions(
  surveyParsedArtifact: ReturnType<typeof SurveyParsedCleanupArtifactSchema.parse> | null,
): RawSurveyQuestion[] {
  return (surveyParsedArtifact?.surveyParsed ?? []).map((question) => ({
    questionId: question.questionId,
    rawText: question.rawText,
    questionText: question.questionText,
    instructionText: question.instructionText ?? null,
    answerOptions: question.answerOptions.map((option) => ({
      code: option.code,
      text: option.text,
      routing: option.routing ?? null,
      progNote: option.progNote ?? null,
    })),
    scaleLabels: (question.scaleLabels ?? []).map((label) => ({
      value: label.value,
      label: label.label,
    })),
    questionType: question.questionType,
    format: question.format,
    progNotes: question.progNotes,
    sectionHeader: question.sectionHeader ?? null,
  }));
}

function resolveProjectContext(params: {
  runResult: ReturnType<typeof parseRunResult> | undefined;
  projectName?: string | null;
  runStatus?: string | null;
  projectConfig?: Record<string, unknown> | null;
  projectIntake?: Record<string, unknown> | null;
  bannerGroups: RawBannerGroup[];
  bannerPlanGroups: RawBannerPlanGroup[];
}): AnalysisProjectContext {
  const config = params.projectConfig ?? {};
  const intake = params.projectIntake ?? {};
  const pipelineDecisions = params.runResult?.pipelineDecisions;
  const summary = params.runResult?.summary;

  const bannerGroupNames = (params.bannerGroups.length > 0
    ? params.bannerGroups
    : params.bannerPlanGroups.map((group) => ({
        groupName: group.groupName,
      } as RawBannerGroup)))
    .map((group) => group.groupName)
    .filter((groupName, index, values) => values.indexOf(groupName) === index);

  const totalCuts = params.bannerGroups.length > 0
    ? params.bannerGroups.reduce((sum, group) => sum + group.columns.length, 0)
    : params.bannerPlanGroups.reduce((sum, group) => sum + group.columns.length, 0);

  return {
    projectName: params.projectName ?? null,
    runStatus: params.runStatus ?? null,
    studyMethodology: asString(config.studyMethodology),
    analysisMethod: asString(config.analysisMethod),
    bannerSource: pipelineDecisions?.banners.source ?? null,
    bannerMode: (() => {
      const value = asString(config.bannerMode);
      return value === "upload" || value === "auto_generate" ? value : null;
    })(),
    tableCount: summary?.tables ?? params.runResult?.pipelineDecisions?.tables.finalTableCount ?? null,
    bannerGroupCount: pipelineDecisions?.banners.bannerGroupCount ?? bannerGroupNames.length,
    totalCuts: pipelineDecisions?.banners.totalCuts ?? totalCuts,
    bannerGroupNames,
    researchObjectives: asString(config.researchObjectives),
    bannerHints: asString(config.bannerHints),
    intakeFiles: {
      dataFile: extractFileName(intake.dataFile),
      survey: extractFileName(intake.survey),
      bannerPlan: extractFileName(intake.bannerPlan),
      messageList: extractFileName(intake.messageList),
    },
  };
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

export async function loadAnalysisGroundingContext(params: {
  runResultValue: unknown;
  projectName?: string | null;
  runStatus?: string | null;
  projectConfig?: Record<string, unknown> | null;
  projectIntake?: Record<string, unknown> | null;
}): Promise<AnalysisGroundingContext> {
  const runResult = parseRunResult(params.runResultValue) ?? {};
  const outputs = runResult.r2Files?.outputs ?? {};

  const tablesKey = outputs[TABLES_JSON_PATH] ?? null;
  const questionKey = outputs[QUESTION_ID_FINAL_PATH] ?? runResult.reviewR2Keys?.v3QuestionIdFinal ?? null;
  const bannerPlanKey = outputs[BANNER_PLAN_PATH] ?? null;
  const bannerRouteMetadataKey = outputs[BANNER_ROUTE_METADATA_PATH] ?? null;
  const crosstabKey = outputs[CROSSTAB_PLAN_PATH] ?? runResult.reviewR2Keys?.v3CrosstabPlan ?? null;
  const surveyMarkdownKey = outputs[SURVEY_MARKDOWN_PATH] ?? null;
  const surveyParsedCleanupKey = outputs[SURVEY_PARSED_CLEANUP_PATH] ?? null;

  const [
    tablesResult,
    questionResult,
    bannerPlanResult,
    bannerRouteMetadataResult,
    crosstabResult,
    surveyMarkdownResult,
    surveyParsedCleanupResult,
  ] = await Promise.allSettled([
    tablesKey ? downloadJsonArtifact<unknown>(tablesKey) : Promise.resolve(null),
    questionKey ? downloadJsonArtifact<QuestionIdFinalFile>(questionKey) : Promise.resolve(null),
    bannerPlanKey ? downloadJsonArtifact<unknown>(bannerPlanKey) : Promise.resolve(null),
    bannerRouteMetadataKey ? downloadJsonArtifact<unknown>(bannerRouteMetadataKey) : Promise.resolve(null),
    crosstabKey ? downloadJsonArtifact<unknown>(crosstabKey) : Promise.resolve(null),
    surveyMarkdownKey ? downloadTextArtifact(surveyMarkdownKey) : Promise.resolve(null),
    surveyParsedCleanupKey ? downloadJsonArtifact<unknown>(surveyParsedCleanupKey) : Promise.resolve(null),
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

  const bannerPlanArtifact = (() => {
    if (!bannerPlanKey) {
      missingArtifacts.push(BANNER_PLAN_PATH);
      return null;
    }
    if (bannerPlanResult.status !== "fulfilled" || !bannerPlanResult.value) {
      missingArtifacts.push(BANNER_PLAN_PATH);
      return null;
    }
    return BannerPlanArtifactSchema.parse(bannerPlanResult.value);
  })();

  const bannerRouteMetadataArtifact = (() => {
    if (!bannerRouteMetadataKey) {
      missingArtifacts.push(BANNER_ROUTE_METADATA_PATH);
      return null;
    }
    if (bannerRouteMetadataResult.status !== "fulfilled" || !bannerRouteMetadataResult.value) {
      missingArtifacts.push(BANNER_ROUTE_METADATA_PATH);
      return null;
    }
    return BannerRouteMetadataArtifactSchema.parse(bannerRouteMetadataResult.value);
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

  const surveyMarkdown = (() => {
    if (!surveyMarkdownKey) {
      missingArtifacts.push(SURVEY_MARKDOWN_PATH);
      return null;
    }
    if (surveyMarkdownResult.status !== "fulfilled" || !surveyMarkdownResult.value) {
      missingArtifacts.push(SURVEY_MARKDOWN_PATH);
      return null;
    }
    return surveyMarkdownResult.value;
  })();

  const surveyParsedCleanupArtifact = (() => {
    if (!surveyParsedCleanupKey) {
      missingArtifacts.push(SURVEY_PARSED_CLEANUP_PATH);
      return null;
    }
    if (surveyParsedCleanupResult.status !== "fulfilled" || !surveyParsedCleanupResult.value) {
      missingArtifacts.push(SURVEY_PARSED_CLEANUP_PATH);
      return null;
    }
    return SurveyParsedCleanupArtifactSchema.parse(surveyParsedCleanupResult.value);
  })();

  const questions = questionArtifact ? buildQuestionContext(questionArtifact) : [];
  const bannerGroups = buildBannerGroups(tablesArtifact, crosstabArtifact);
  const bannerPlanGroups = buildBannerPlanGroups(bannerPlanArtifact);
  const surveyQuestions = buildSurveyQuestions(surveyParsedCleanupArtifact);

  return {
    availability: deriveAvailability(
      missingArtifacts,
      Boolean(
        tablesArtifact
        || questionArtifact
        || bannerPlanArtifact
        || crosstabArtifact
        || surveyMarkdown
        || surveyParsedCleanupArtifact,
      ),
    ),
    tables: tablesArtifact?.tables ?? {},
    questions,
    bannerGroups,
    bannerPlanGroups,
    bannerRouteMetadata: bannerRouteMetadataArtifact
      ? {
          routeUsed: bannerRouteMetadataArtifact.routeUsed,
          usedFallbackFromBannerAgent: bannerRouteMetadataArtifact.usedFallbackFromBannerAgent,
        }
      : null,
    surveyMarkdown,
    surveyQuestions,
    projectContext: resolveProjectContext({
      runResult,
      projectName: params.projectName,
      runStatus: params.runStatus,
      projectConfig: params.projectConfig,
      projectIntake: params.projectIntake,
      bannerGroups,
      bannerPlanGroups,
    }),
    tablesMetadata: buildTablesMetadata(tablesArtifact),
    missingArtifacts,
  };
}

export function searchRunCatalog(
  context: AnalysisGroundingContext,
  query?: string | null,
  scope?: AnalysisCatalogSearchScope,
): AnalysisCatalogSearchResult {
  const trimmedQuery = typeof query === "string" ? query.trim() : "";
  const isListing = trimmedQuery.length === 0;
  const mode: "search" | "listing" = isListing ? "listing" : "search";
  const effectiveScope: AnalysisCatalogSearchScope = scope ?? (isListing ? "questions" : "all");

  if (context.availability === "unavailable") {
    return {
      status: "unavailable",
      mode,
      ...(isListing ? {} : { query: trimmedQuery }),
      scope: effectiveScope,
      questions: [],
      tables: [],
      cuts: [],
      message: buildMissingMessage(context.missingArtifacts),
    };
  }

  if (isListing) {
    const includeQuestions = effectiveScope === "all" || effectiveScope === "questions";
    const includeTables = effectiveScope === "all" || effectiveScope === "tables";
    const includeCuts = effectiveScope === "all" || effectiveScope === "cuts";

    const questions: AnalysisCatalogQuestionMatch[] = includeQuestions
      ? [...context.questions]
          .sort((left, right) =>
            left.questionId.trim().toLowerCase().localeCompare(right.questionId.trim().toLowerCase()),
          )
          .map((question) => ({
            questionId: question.questionId,
            questionText: question.questionText,
            normalizedType: question.normalizedType,
            analyticalSubtype: question.analyticalSubtype ?? null,
          }))
      : [];

    const tables: AnalysisCatalogTableMatch[] = includeTables
      ? Object.entries(context.tables)
          .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
          .map(([tableId, table]) => ({
            tableId,
            title: deriveTitle(table, tableId),
            questionId: table.questionId ?? null,
            questionText: table.questionText ?? null,
            tableType: table.tableType ?? null,
          }))
      : [];

    const cuts: AnalysisCatalogCutMatch[] = includeCuts
      ? context.bannerGroups.flatMap((group) =>
          group.columns.map((column) => ({
            groupName: group.groupName,
            cutName: column.name,
            statLetter: column.statLetter,
          })),
        )
      : [];

    const totals = {
      questions: context.questions.length,
      tables: Object.keys(context.tables).length,
      cuts: context.bannerGroups.reduce((sum, group) => sum + group.columns.length, 0),
    };

    return {
      status: context.availability,
      mode: "listing",
      scope: effectiveScope,
      questions,
      tables,
      cuts,
      totals,
      ...(context.missingArtifacts.length > 0
        ? { message: buildMissingMessage(context.missingArtifacts) }
        : {}),
    };
  }

  const questionMatches = effectiveScope === "all" || effectiveScope === "questions"
    ? sortByScore(
      context.questions
        .map((question) => ({
          questionId: question.questionId,
          questionText: question.questionText,
          normalizedType: question.normalizedType,
          analyticalSubtype: question.analyticalSubtype ?? null,
          score: scoreMatch(
            trimmedQuery,
            question.questionId,
            question.questionText,
            question.normalizedType,
            question.analyticalSubtype,
            ...question.items.map((item) => item.label),
          ),
        }))
        .filter((match) => match.score > 0),
    ).slice(0, 5)
    : [];

  const tableMatches = effectiveScope === "all" || effectiveScope === "tables"
    ? sortByScore(
      Object.entries(context.tables)
        .map(([tableId, table]) => ({
          tableId,
          title: deriveTitle(table, tableId),
          questionId: table.questionId ?? null,
          questionText: table.questionText ?? null,
          tableType: table.tableType ?? null,
          score: scoreMatch(
            trimmedQuery,
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
    ).slice(0, 5)
    : [];

  const cutMatches = effectiveScope === "all" || effectiveScope === "cuts"
    ? sortByScore(
      context.bannerGroups
        .flatMap((group) => group.columns.map((column) => ({
          groupName: group.groupName,
          cutName: column.name,
          statLetter: column.statLetter,
          score: scoreMatch(trimmedQuery, group.groupName, column.name, column.statLetter),
        })))
        .filter((match) => match.score > 0),
    ).slice(0, 8)
    : [];

  return {
    status: context.availability,
    mode: "search",
    query: trimmedQuery,
    scope: effectiveScope,
    questions: questionMatches,
    tables: tableMatches,
    cuts: cutMatches,
    ...(context.missingArtifacts.length > 0 ? { message: buildMissingMessage(context.missingArtifacts) } : {}),
  };
}

function resolveSurveyDocumentSnippet(
  surveyMarkdown: string | null,
  question: RawSurveyQuestion,
): string | null {
  if (!surveyMarkdown) return null;

  const candidates = [
    question.questionId,
    question.rawText,
    question.questionText,
  ]
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const normalizedMarkdown = surveyMarkdown.toLowerCase();

  for (const candidate of candidates) {
    const index = normalizedMarkdown.indexOf(candidate.toLowerCase());
    if (index === -1) continue;

    const start = Math.max(index - 250, 0);
    const end = Math.min(index + Math.max(candidate.length, 1_000), surveyMarkdown.length);
    return surveyMarkdown.slice(start, end).trim();
  }

  return null;
}

function resolveSurveyQuestionMatch(
  context: AnalysisGroundingContext,
  query: string,
): { question: RawSurveyQuestion; sequenceNumber: number } | null {
  const normalizedQuery = normalizeText(query);
  if (!normalizedQuery) return null;

  const exactIndex = context.surveyQuestions.findIndex(
    (question) => normalizeText(question.questionId) === normalizedQuery,
  );
  if (exactIndex >= 0) {
    return {
      question: context.surveyQuestions[exactIndex],
      sequenceNumber: exactIndex + 1,
    };
  }

  let bestMatch: { question: RawSurveyQuestion; sequenceNumber: number; score: number } | null = null;

  for (const [index, question] of context.surveyQuestions.entries()) {
    const score = scoreMatch(
      query,
      question.questionId,
      question.questionText,
      question.rawText,
      question.instructionText,
      question.sectionHeader,
      ...question.answerOptions.map((option) => option.text),
      ...question.scaleLabels.map((label) => label.label),
    );

    if (score <= 0) continue;
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = {
        question,
        sequenceNumber: index + 1,
        score,
      };
    }
  }

  if (!bestMatch) return null;
  return {
    question: bestMatch.question,
    sequenceNumber: bestMatch.sequenceNumber,
  };
}


export function getQuestionContext(
  context: AnalysisGroundingContext,
  questionId: string,
  include: AnalysisQuestionContextInclude[] = [],
): AnalysisQuestionContextResult {
  const includedSections = include.filter((section, index, values) => values.indexOf(section) === index);
  const includeSet = new Set(includedSections);

  if (context.availability === "unavailable" && context.questions.length === 0) {
    return {
      status: "unavailable",
      questionId,
      questionText: null,
      normalizedType: null,
      analyticalSubtype: null,
      disposition: null,
      surveyMatch: null,
      includedSections,
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
      includedSections,
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

  const items = includeSet.has("items")
    ? match.items.slice(0, DEFAULT_QUESTION_ITEM_LIMIT).map((item) => ({
      column: item.column,
      label: item.label,
      normalizedType: item.normalizedType,
      valueLabels: item.valueLabels,
    }))
    : [];

  // Resolve the survey-document match for this question (when available) so
  // survey wording, answer options, scale labels, and a document snippet all
  // return from the same tool. Prior behavior split this across a separate
  // getSurveyQuestion tool that the agent rarely picked.
  const surveyMatchResolved = includeSet.has("survey")
    ? resolveSurveyQuestionMatch(context, match.questionId)
    : null;

  const baseSourceRefs: AnalysisSourceRef[] = [
    { refType: "question", refId: match.questionId, label: match.questionText },
  ];
  const surveySourceRefs: AnalysisSourceRef[] = surveyMatchResolved
    ? [
        {
          refType: "survey_question",
          refId: surveyMatchResolved.question.questionId,
          label: surveyMatchResolved.question.questionText,
        },
        ...(context.surveyMarkdown
          ? [{
              refType: "survey_document" as const,
              refId: SURVEY_MARKDOWN_PATH,
              label: "Survey document",
            }]
          : []),
      ]
    : [];

  const surveyFields: Partial<AnalysisQuestionContextResult> = surveyMatchResolved
    ? {
        sequenceNumber: surveyMatchResolved.sequenceNumber,
        sectionHeader: surveyMatchResolved.question.sectionHeader,
        instructionText: surveyMatchResolved.question.instructionText,
        surveyQuestionType: surveyMatchResolved.question.questionType,
        surveyFormat: surveyMatchResolved.question.format,
        answerOptions: surveyMatchResolved.question.answerOptions,
        scaleLabels: surveyMatchResolved.question.scaleLabels,
        progNotes: surveyMatchResolved.question.progNotes,
        documentSnippet: resolveSurveyDocumentSnippet(context.surveyMarkdown, surveyMatchResolved.question),
      }
    : {};

  return {
    status: context.availability,
    questionId: match.questionId,
    questionText: match.questionText,
    normalizedType: match.normalizedType,
    analyticalSubtype: match.analyticalSubtype ?? null,
    disposition: match.disposition ?? null,
    surveyMatch: match.surveyMatch ?? null,
    includedSections,
    loop: includeSet.has("loop") ? (match.loop ?? null) : null,
    hiddenLink: includeSet.has("linkage") ? (match.hiddenLink ?? null) : null,
    baseSummary: match.baseSummary ?? null,
    items,
    totalItems: match.items.length,
    truncatedItems: Math.max(match.items.length - items.length, 0),
    relatedTableIds: includeSet.has("relatedTables") ? relatedTableIds : [],
    ...surveyFields,
    sourceRefs: [...baseSourceRefs, ...surveySourceRefs],
    ...(context.missingArtifacts.length > 0 ? { message: buildMissingMessage(context.missingArtifacts) } : {}),
  };
}

export function listBannerCuts(
  context: AnalysisGroundingContext,
  filter: string | null | undefined,
  include: AnalysisBannerCutsInclude[] = [],
): AnalysisBannerCutsResult {
  const includedSections = include.filter((section, index, values) => values.indexOf(section) === index);
  const includeSet = new Set(includedSections);
  if (context.availability === "unavailable" && context.bannerGroups.length === 0) {
    return {
      status: "unavailable",
      filter: filter?.trim() || null,
      includedSections,
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
        ...(includeSet.has("expressions") ? { expression: column.expression } : {}),
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
    includedSections,
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
    cutGroups?: AnalysisFetchTableCutGroups | null;
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

  const requestedCutGroups = normalizeRequestedCutGroups(args.cutGroups ?? null);
  const valueMode = resolvePreferredValueMode(table.tableType, args.valueMode);
  const rowKeys = collectRowKeys(table);
  const {
    allCuts,
    columnGroups,
  } = buildSelectedCuts(table, context.bannerGroups);
  const columns: AnalysisTableCardColumn[] = columnGroups.flatMap((group) => group.columns);
  const rows = rowKeys.map((rowKey) => {
    const firstRow = allCuts
      .map((cut) => cut.cut[rowKey])
      .find(isRawTableRow);

    const values: AnalysisTableCardCell[] = allCuts.map((cut) => {
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
  const totalNonTotalCuts = allCuts.filter((cut) => !cut.isTotal).length;

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
    totalColumns: allCuts.length,
    truncatedRows: hiddenRowCount,
    truncatedColumns: totalNonTotalCuts,
    defaultScope: totalNonTotalCuts > 0 ? "total_only" : "matched_groups",
    initialVisibleRowCount,
    initialVisibleGroupCount: 0,
    hiddenRowCount,
    hiddenGroupCount: columnGroups.filter((group) => group.groupKey !== TOTAL_GROUP_KEY).length,
    focusedCutIds: null,
    requestedRowFilter: null,
    requestedCutFilter: null,
    requestedCutGroups,
    focusedRowKeys: null,
    focusedGroupKeys: null,
    significanceTest: context.tablesMetadata.significanceTest,
    significanceLevel: context.tablesMetadata.significanceLevel,
    comparisonGroups: context.tablesMetadata.comparisonGroups,
    sourceRefs: resolveSourceRefs(args.tableId, table.questionId ?? null, title),
  };
}

function markdownEscapeCell(value: string | null | undefined): string {
  return (value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br />");
}

function formatAnalysisTableQuestionHeading(result: AnalysisTableCard): string {
  if (result.questionId && result.questionText) {
    const questionId = result.questionId.replace(/[.:]\s*$/, "").trim();
    return `${questionId}. ${result.questionText}`;
  }

  return result.questionText ?? result.title;
}

function formatAnalysisTableRowLabel(row: AnalysisTableCardRow): string {
  return `${row.label}${row.rowKey ? ` {${row.rowKey}}` : ""}`;
}

function formatAnalysisTableColumnHeader(column: AnalysisTableCardColumn): string {
  const statLetter = column.statLetter?.trim();
  const label = statLetter
    ? `${column.cutName} (${statLetter})`
    : column.cutName;
  return `${label}${column.cutKey ? `{${column.cutKey}}` : ""}`;
}

function getModelMarkdownSignificanceMarkers(
  row: AnalysisTableCardRow,
  column: AnalysisTableCardColumn,
  columns: AnalysisTableCardColumn[],
): string[] {
  const resolvedCutKey = column.cutKey ?? column.cutName;
  const cell = row.cellsByCutKey?.[resolvedCutKey]
    ?? row.values.find((value) =>
      (value.cutKey && value.cutKey === resolvedCutKey)
      || value.cutName === column.cutName)
    ?? null;

  if (!cell) return [];

  const markers = [...cell.sigHigherThan];

  if (column.isTotal) {
    for (const comparisonColumn of columns) {
      const comparisonCutKey = comparisonColumn.cutKey ?? comparisonColumn.cutName;
      if (comparisonCutKey === resolvedCutKey) continue;

      const comparisonCell = row.cellsByCutKey?.[comparisonCutKey]
        ?? row.values.find((value) =>
          (value.cutKey && value.cutKey === comparisonCutKey)
          || value.cutName === comparisonColumn.cutName)
        ?? null;

      if (comparisonCell?.sigVsTotal === "lower" && comparisonColumn.statLetter) {
        markers.push(comparisonColumn.statLetter);
      }
    }
  } else if (cell.sigVsTotal === "higher") {
    markers.push("T");
  }

  return [...new Set(markers.filter((marker) => marker.trim().length > 0))];
}

function formatAnalysisTableCellForMarkdown(
  row: AnalysisTableCardRow,
  column: AnalysisTableCardColumn,
  columns: AnalysisTableCardColumn[],
): string {
  const resolvedCutKey = column.cutKey ?? column.cutName;
  const cell = row.cellsByCutKey?.[resolvedCutKey]
    ?? row.values.find((value) =>
      (value.cutKey && value.cutKey === resolvedCutKey)
      || value.cutName === column.cutName)
    ?? null;

  if (!cell) {
    return "—";
  }

  const markers = getModelMarkdownSignificanceMarkers(row, column, columns);
  return `**${cell.displayValue}${markers.join("")}**`;
}

export function buildFetchTableModelMarkdown(
  result: AnalysisTableCardResult,
  options?: {
    requestedCutGroups?: AnalysisFetchTableCutGroups | null;
  },
): string {
  if (result.status !== "available") {
    return [
      `Table ${result.tableId}`,
      "",
      result.message,
    ].join("\n");
  }

  const projected = projectTableCardForModel(
    result,
    normalizeRequestedCutGroups(options?.requestedCutGroups ?? null),
  );

  const lines: string[] = [
    `### ${formatAnalysisTableQuestionHeading(projected)}`,
    "",
    `- tableId: ${projected.tableId}`,
  ];

  if (projected.tableSubtitle) {
    lines.push(`- subtitle: ${projected.tableSubtitle}`);
  }
  if (projected.baseText) {
    lines.push(`- base: ${projected.baseText}`);
  }
  lines.push("");

  if (projected.rows.length === 0) {
    lines.push("_No rows available._");
    return lines.join("\n");
  }

  const headerCells = [
    "Response",
    ...projected.columns.map((column) => formatAnalysisTableColumnHeader(column)),
  ];
  lines.push(`| ${headerCells.map(markdownEscapeCell).join(" | ")} |`);
  lines.push(`| ${headerCells.map(() => "---").join(" | ")} |`);
  lines.push(`| ${[
    "Base n",
    ...projected.columns.map((column) => column.baseN !== null ? String(column.baseN) : "—"),
  ].map(markdownEscapeCell).join(" | ")} |`);

  for (const row of projected.rows) {
    const valueCells = projected.columns.map((column) =>
      markdownEscapeCell(formatAnalysisTableCellForMarkdown(row, column, projected.columns))
    );
    lines.push(`| ${[
      markdownEscapeCell(formatAnalysisTableRowLabel(row)),
      ...valueCells,
    ].join(" | ")} |`);
  }

  return lines.join("\n");
}

const ALLOWED_HINT_LIMIT = 20;

type LegacyConfirmCitationArgs = {
  tableId: string;
  rowKey: string;
  cutKey: string;
  valueMode?: AnalysisValueMode;
};

type SemanticConfirmCitationArgs = {
  tableId: string;
  rowLabel: string;
  columnLabel: string;
  rowRef?: string;
  columnRef?: string;
  valueMode?: AnalysisValueMode;
};

function isLegacyConfirmCitationArgs(
  args: LegacyConfirmCitationArgs | SemanticConfirmCitationArgs,
): args is LegacyConfirmCitationArgs {
  return "rowKey" in args && "cutKey" in args;
}

function buildResolvedCellSummary(params: {
  table: RawTableEntry;
  tableId: string;
  title: string;
  rowKey: string;
  rowLabel: string;
  selectedCut: SelectedCut;
  valueMode: AnalysisValueMode;
}): AnalysisCellSummary {
  const rawRowValue = params.selectedCut.cut[params.rowKey];
  const rawRow = isRawTableRow(rawRowValue) ? rawRowValue : {};
  const rawValue = resolveValueForMode(rawRow, params.valueMode);
  const displayValue = formatCellValue(rawValue, params.valueMode);

  const cellId = buildAnalysisCellId({
    tableId: params.tableId,
    rowKey: params.rowKey,
    cutKey: params.selectedCut.cutKey,
    valueMode: params.valueMode,
  });

  return {
    cellId,
    tableId: params.tableId,
    tableTitle: params.title,
    questionId: params.table.questionId ?? null,
    rowKey: params.rowKey,
    rowLabel: params.rowLabel,
    cutKey: params.selectedCut.cutKey,
    cutName: params.selectedCut.cutName,
    groupName: params.selectedCut.groupName,
    valueMode: params.valueMode,
    displayValue,
    pct: typeof rawRow.pct === "number" ? rawRow.pct : null,
    count: typeof rawRow.count === "number" ? rawRow.count : null,
    n: typeof rawRow.n === "number" ? rawRow.n : null,
    mean: typeof rawRow.mean === "number" ? rawRow.mean : null,
    baseN: params.selectedCut.baseN,
    sigHigherThan: normalizeSigHigherThan(rawRow.sig_higher_than),
    sigVsTotal: typeof rawRow.sig_vs_total === "string" ? rawRow.sig_vs_total : null,
    sourceRefs: resolveCellSourceRefs({
      tableId: params.tableId,
      title: params.title,
      questionId: params.table.questionId ?? null,
      groupName: params.selectedCut.groupName,
      cutName: params.selectedCut.cutName,
    }),
  };
}

function buildRowCandidates(
  allCuts: SelectedCut[],
  rowKeys: string[],
  normalizedRowLabel: string,
): AnalysisCellConfirmationRowCandidate[] {
  return rowKeys
    .map((rowKey) => {
      const firstRowForLabel = allCuts
        .map((cut) => cut.cut[rowKey])
        .find(isRawTableRow);
      const rowLabel = firstRowForLabel?.label ?? rowKey;
      return { rowLabel, rowRef: rowKey };
    })
    .filter((candidate) => normalizeText(candidate.rowLabel) === normalizedRowLabel)
    .slice(0, ALLOWED_HINT_LIMIT);
}

function buildColumnCandidates(
  matchingCuts: SelectedCut[],
): AnalysisCellConfirmationColumnCandidate[] {
  return matchingCuts
    .slice(0, ALLOWED_HINT_LIMIT)
    .map((cut) => ({
      columnLabel: cut.cutName,
      columnRef: cut.cutKey,
      statLetter: cut.statLetter,
    }));
}

function resolveCellSourceRefs(params: {
  tableId: string;
  title: string;
  questionId: string | null;
  groupName: string | null;
  cutName: string;
}): AnalysisSourceRef[] {
  const refs: AnalysisSourceRef[] = [
    { refType: "table", refId: params.tableId, label: params.title },
  ];

  if (params.questionId) {
    refs.push({ refType: "question", refId: params.questionId, label: params.questionId });
  }

  refs.push({
    refType: "banner_cut",
    refId: params.cutName,
    label: params.groupName ? `${params.groupName} / ${params.cutName}` : params.cutName,
  });

  return refs;
}

export function confirmCitation(
  context: AnalysisGroundingContext,
  args: LegacyConfirmCitationArgs | SemanticConfirmCitationArgs,
): AnalysisCellConfirmationResult {
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

  const valueMode = resolvePreferredValueMode(table.tableType, args.valueMode);
  const rowKeys = collectRowKeys(table);
  const title = deriveTitle(table, args.tableId);
  const { allCuts } = buildSelectedCuts(table, context.bannerGroups);

  if (isLegacyConfirmCitationArgs(args)) {
    if (!rowKeys.includes(args.rowKey)) {
      return {
        status: "invalid_row",
        tableId: args.tableId,
        rowKey: args.rowKey,
        message: `Row "${args.rowKey}" is not a row on table ${args.tableId}. Pick one of the allowed rowKeys and retry.`,
        allowedRowKeys: rowKeys.slice(0, ALLOWED_HINT_LIMIT),
      };
    }

    const selectedCut = allCuts.find((cut) => cut.cutKey === args.cutKey);

    if (!selectedCut) {
      return {
        status: "invalid_cut",
        tableId: args.tableId,
        rowKey: args.rowKey,
        cutKey: args.cutKey,
        message: `Cut "${args.cutKey}" is not a cut on table ${args.tableId}. Pick one of the allowed cutKeys and retry.`,
        allowedCutKeys: allCuts.slice(0, ALLOWED_HINT_LIMIT).map((cut) => cut.cutKey),
      };
    }

    const firstRowForLabel = allCuts
      .map((cut) => cut.cut[args.rowKey])
      .find(isRawTableRow);
    const rowLabel = firstRowForLabel?.label ?? args.rowKey;

    return {
      status: "confirmed",
      ...buildResolvedCellSummary({
        table,
        tableId: args.tableId,
        title,
        rowKey: args.rowKey,
        rowLabel,
        selectedCut,
        valueMode,
      }),
    };
  }

  const normalizedRowLabel = normalizeText(args.rowLabel);
  const normalizedColumnLabel = normalizeText(args.columnLabel);

  let matchingRowKeys = rowKeys.filter((rowKey) => {
    const firstRowForLabel = allCuts
      .map((cut) => cut.cut[rowKey])
      .find(isRawTableRow);
    const rowLabel = firstRowForLabel?.label ?? rowKey;
    return normalizeText(rowLabel) === normalizedRowLabel;
  });

  if (matchingRowKeys.length === 0) {
    return {
      status: "invalid_row",
      tableId: args.tableId,
      message: `No row labeled "${args.rowLabel}" was found on table ${args.tableId}. Retry with a rowLabel from the fetched table.`,
      candidateRows: [],
    };
  }

  if (typeof args.rowRef === "string") {
    matchingRowKeys = matchingRowKeys.filter((rowKey) => rowKey === args.rowRef);
    if (matchingRowKeys.length !== 1) {
      return {
        status: "invalid_row",
        tableId: args.tableId,
        message: `rowRef "${args.rowRef}" did not resolve a unique row for label "${args.rowLabel}" on table ${args.tableId}.`,
        candidateRows: buildRowCandidates(allCuts, rowKeys, normalizedRowLabel),
      };
    }
  } else if (matchingRowKeys.length > 1) {
    return {
      status: "ambiguous_row",
      tableId: args.tableId,
      message: `More than one row matches "${args.rowLabel}" on table ${args.tableId}. Retry with rowRef from the fetched table.`,
      candidateRows: buildRowCandidates(allCuts, matchingRowKeys, normalizedRowLabel),
    };
  }

  const resolvedRowKey = matchingRowKeys[0]!;
  const firstRowForLabel = allCuts
    .map((cut) => cut.cut[resolvedRowKey])
    .find(isRawTableRow);
  const resolvedRowLabel = firstRowForLabel?.label ?? resolvedRowKey;

  let matchingCuts = allCuts.filter((cut) => normalizeText(cut.cutName) === normalizedColumnLabel);
  if (matchingCuts.length === 0) {
    return {
      status: "invalid_column",
      tableId: args.tableId,
      rowKey: resolvedRowKey,
      message: `No column labeled "${args.columnLabel}" was found on table ${args.tableId}. Retry with a columnLabel from the fetched table.`,
      candidateColumns: [],
    };
  }

  if (typeof args.columnRef === "string") {
    matchingCuts = matchingCuts.filter((cut) => cut.cutKey === args.columnRef);
    if (matchingCuts.length !== 1) {
      return {
        status: "invalid_column",
        tableId: args.tableId,
        rowKey: resolvedRowKey,
        message: `columnRef "${args.columnRef}" did not resolve a unique column for label "${args.columnLabel}" on table ${args.tableId}.`,
        candidateColumns: buildColumnCandidates(
          allCuts.filter((cut) => normalizeText(cut.cutName) === normalizedColumnLabel),
        ),
      };
    }
  } else if (matchingCuts.length > 1) {
    return {
      status: "ambiguous_column",
      tableId: args.tableId,
      rowKey: resolvedRowKey,
      message: `More than one column matches "${args.columnLabel}" on table ${args.tableId}. Retry with columnRef from the fetched table.`,
      candidateColumns: buildColumnCandidates(matchingCuts),
    };
  }

  const selectedCut = matchingCuts[0]!;

  return {
    status: "confirmed",
    ...buildResolvedCellSummary({
      table,
      tableId: args.tableId,
      title,
      rowKey: resolvedRowKey,
      rowLabel: resolvedRowLabel,
      selectedCut,
      valueMode,
    }),
  };
}
