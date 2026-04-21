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
  AnalysisBannerPlanContextResult,
  AnalysisBannerPlanGroupResult,
  AnalysisBannerCutsResult,
  AnalysisBannerGroupResult,
  AnalysisCatalogSearchResult,
  AnalysisQuestionContextResult,
  AnalysisRunContextResult,
  AnalysisSourceRef,
  AnalysisSurveyQuestionResult,
  AnalysisTableCardCell,
  AnalysisTableCardColumn,
  AnalysisTableCardColumnGroup,
  AnalysisTableCardResult,
  AnalysisValueMode,
} from "@/lib/analysis/types";

const TABLES_JSON_PATH = "results/tables.json";
const QUESTION_ID_FINAL_PATH = "enrichment/12-questionid-final.json";
const BANNER_PLAN_PATH = "planning/20-banner-plan.json";
const BANNER_ROUTE_METADATA_PATH = "planning/banner-route-metadata.json";
const CROSSTAB_PLAN_PATH = "planning/21-crosstab-plan.json";
const SURVEY_MARKDOWN_PATH = "survey/survey-markdown.md";
const SURVEY_PARSED_CLEANUP_PATH = "enrichment/08b-survey-parsed-cleanup.json";
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

function sanitizeGroundingText(value: string): string {
  return value
    .replace(/[<>]/g, "")
    .replace(/(^|\n)\s*(system|assistant|user|tool|developer)\s*:/gim, "$1")
    .replace(/(^|\n)\s*(ignore|disregard|override|forget)\b[^\n]*/gim, "$1")
    .replace(/<\/?(system|assistant|user|tool|developer|instruction|prompt|analysis)[^>]*>/gim, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TOOL_OUTPUT_TEXT_MAX_LENGTH);
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

export function getRunContext(
  context: AnalysisGroundingContext,
): AnalysisRunContextResult {
  return {
    status: context.availability,
    projectName: context.projectContext.projectName,
    runStatus: context.projectContext.runStatus,
    studyMethodology: context.projectContext.studyMethodology,
    analysisMethod: context.projectContext.analysisMethod,
    bannerSource: context.projectContext.bannerSource,
    bannerMode: context.projectContext.bannerMode,
    tableCount: context.projectContext.tableCount,
    bannerGroupCount: context.projectContext.bannerGroupCount,
    totalCuts: context.projectContext.totalCuts,
    bannerGroupNames: context.projectContext.bannerGroupNames,
    researchObjectives: context.projectContext.researchObjectives,
    bannerHints: context.projectContext.bannerHints,
    intakeFiles: context.projectContext.intakeFiles,
    sourceRefs: [
      ...(context.projectContext.projectName
        ? [{ refType: "project" as const, refId: context.projectContext.projectName, label: context.projectContext.projectName }]
        : []),
      ...(context.projectContext.runStatus
        ? [{ refType: "run" as const, refId: context.projectContext.runStatus, label: context.projectContext.runStatus }]
        : []),
    ],
    ...(context.missingArtifacts.length > 0 ? { message: buildMissingMessage(context.missingArtifacts) } : {}),
  };
}

export function getBannerPlanContext(
  context: AnalysisGroundingContext,
  filter: string | null | undefined,
): AnalysisBannerPlanContextResult {
  const normalizedFilter = filter?.trim() || null;

  if (context.availability === "unavailable" && context.bannerPlanGroups.length === 0) {
    return {
      status: "unavailable",
      filter: normalizedFilter,
      routeUsed: context.bannerRouteMetadata?.routeUsed ?? null,
      bannerSource: context.projectContext.bannerSource,
      usedFallbackFromBannerAgent: context.bannerRouteMetadata?.usedFallbackFromBannerAgent ?? null,
      researchObjectives: context.projectContext.researchObjectives,
      bannerHints: context.projectContext.bannerHints,
      groups: [],
      totalGroups: 0,
      totalCuts: 0,
      sourceRefs: [],
      message: buildMissingMessage(context.missingArtifacts),
    };
  }

  const groups = context.bannerPlanGroups
    .map<AnalysisBannerPlanGroupResult>((group) => ({
      groupName: group.groupName,
      columns: group.columns.map((column) => ({
        name: column.name,
        original: column.original,
      })),
    }))
    .filter((group) => {
      if (!normalizedFilter) return true;
      if (scoreMatch(normalizedFilter, group.groupName) > 0) return true;
      return group.columns.some((column) => scoreMatch(normalizedFilter, group.groupName, column.name, column.original) > 0);
    })
    .map((group) => ({
      ...group,
      columns: normalizedFilter
        ? group.columns.filter((column) => scoreMatch(normalizedFilter, group.groupName, column.name, column.original) > 0)
        : group.columns,
    }))
    .filter((group) => group.columns.length > 0);

  if (normalizedFilter && groups.length === 0) {
    return {
      status: "not_found",
      filter: normalizedFilter,
      routeUsed: context.bannerRouteMetadata?.routeUsed ?? null,
      bannerSource: context.projectContext.bannerSource,
      usedFallbackFromBannerAgent: context.bannerRouteMetadata?.usedFallbackFromBannerAgent ?? null,
      researchObjectives: context.projectContext.researchObjectives,
      bannerHints: context.projectContext.bannerHints,
      groups: [],
      totalGroups: 0,
      totalCuts: 0,
      sourceRefs: [],
      message: `No banner plan groups matched "${normalizedFilter}".`,
    };
  }

  return {
    status: context.availability,
    filter: normalizedFilter,
    routeUsed: context.bannerRouteMetadata?.routeUsed ?? null,
    bannerSource: context.projectContext.bannerSource,
    usedFallbackFromBannerAgent: context.bannerRouteMetadata?.usedFallbackFromBannerAgent ?? null,
    researchObjectives: context.projectContext.researchObjectives,
    bannerHints: context.projectContext.bannerHints,
    groups,
    totalGroups: groups.length,
    totalCuts: groups.reduce((sum, group) => sum + group.columns.length, 0),
    sourceRefs: [{ refType: "banner_plan", refId: BANNER_PLAN_PATH, label: "Banner plan" }],
    ...(context.missingArtifacts.length > 0 ? { message: buildMissingMessage(context.missingArtifacts) } : {}),
  };
}

export function getSurveyQuestion(
  context: AnalysisGroundingContext,
  query: string,
): AnalysisSurveyQuestionResult {
  if (context.availability === "unavailable" && context.surveyQuestions.length === 0) {
    return {
      status: "unavailable",
      query,
      questionId: null,
      questionText: null,
      sequenceNumber: null,
      sectionHeader: null,
      instructionText: null,
      questionType: null,
      format: null,
      answerOptions: [],
      scaleLabels: [],
      progNotes: [],
      documentSnippet: null,
      sourceRefs: [],
      message: buildMissingMessage(context.missingArtifacts),
    };
  }

  const match = resolveSurveyQuestionMatch(context, query);
  if (!match) {
    return {
      status: "not_found",
      query,
      questionId: null,
      questionText: null,
      sequenceNumber: null,
      sectionHeader: null,
      instructionText: null,
      questionType: null,
      format: null,
      answerOptions: [],
      scaleLabels: [],
      progNotes: [],
      documentSnippet: null,
      sourceRefs: [],
      message: `Survey question "${query}" was not found in this run's survey context.`,
    };
  }

  return {
    status: context.availability,
    query,
    questionId: match.question.questionId,
    questionText: match.question.questionText,
    sequenceNumber: match.sequenceNumber,
    sectionHeader: match.question.sectionHeader,
    instructionText: match.question.instructionText,
    questionType: match.question.questionType,
    format: match.question.format,
    answerOptions: match.question.answerOptions,
    scaleLabels: match.question.scaleLabels,
    progNotes: match.question.progNotes,
    documentSnippet: resolveSurveyDocumentSnippet(context.surveyMarkdown, match.question),
    sourceRefs: [
      { refType: "survey_question", refId: match.question.questionId, label: match.question.questionText },
      ...(context.surveyMarkdown ? [{ refType: "survey_document" as const, refId: SURVEY_MARKDOWN_PATH, label: "Survey document" }] : []),
    ],
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
