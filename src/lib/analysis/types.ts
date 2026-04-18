export type AnalysisAvailabilityStatus = "available" | "partial" | "unavailable";

export interface AnalysisSourceRef {
  refType: "table" | "question" | "banner_group" | "banner_cut";
  refId: string;
  label?: string;
}

export interface AnalysisCatalogQuestionMatch {
  questionId: string;
  questionText: string;
  normalizedType: string;
  analyticalSubtype: string | null;
  score: number;
}

export interface AnalysisCatalogTableMatch {
  tableId: string;
  title: string;
  questionId: string | null;
  questionText: string | null;
  tableType: string | null;
  score: number;
}

export interface AnalysisCatalogCutMatch {
  groupName: string;
  cutName: string;
  statLetter: string | null;
  score: number;
}

export interface AnalysisCatalogSearchResult {
  status: AnalysisAvailabilityStatus;
  query: string;
  questions: AnalysisCatalogQuestionMatch[];
  tables: AnalysisCatalogTableMatch[];
  cuts: AnalysisCatalogCutMatch[];
  message?: string;
}

export type AnalysisValueMode = "pct" | "count" | "n" | "mean";

export interface AnalysisTableCardColumn {
  cutKey?: string;
  cutName: string;
  groupName: string | null;
  statLetter: string | null;
  baseN: number | null;
  isTotal?: boolean;
}

export interface AnalysisTableCardColumnGroup {
  groupKey: string;
  groupName: string | null;
  columns: AnalysisTableCardColumn[];
}

export interface AnalysisTableCardCell {
  cutKey?: string;
  cutName: string;
  rawValue: number | null;
  displayValue: string;
  count: number | null;
  pct: number | null;
  n: number | null;
  mean: number | null;
  sigHigherThan: string[];
  sigVsTotal: string | null;
}

export interface AnalysisTableCardRow {
  rowKey: string;
  label: string;
  indent: number;
  isNet: boolean;
  values: AnalysisTableCardCell[];
  cellsByCutKey?: Record<string, AnalysisTableCardCell>;
}

export interface AnalysisTableCard {
  status: "available";
  tableId: string;
  title: string;
  questionId: string | null;
  questionText: string | null;
  tableType: string | null;
  surveySection: string | null;
  baseText: string | null;
  tableSubtitle: string | null;
  userNote: string | null;
  valueMode: AnalysisValueMode;
  columns: AnalysisTableCardColumn[];
  columnGroups?: AnalysisTableCardColumnGroup[];
  rows: AnalysisTableCardRow[];
  totalRows: number;
  totalColumns: number;
  truncatedRows: number;
  truncatedColumns: number;
  defaultScope?: "total_only" | "matched_groups";
  initialVisibleRowCount?: number;
  initialVisibleGroupCount?: number;
  hiddenRowCount?: number;
  hiddenGroupCount?: number;
  hiddenCutCount?: number;
  isExpandable?: boolean;
  requestedRowFilter: string | null;
  requestedCutFilter: string | null;
  significanceTest: string | null;
  significanceLevel: number | null;
  comparisonGroups: string[];
  sourceRefs: AnalysisSourceRef[];
}

export interface AnalysisTableCardFailure {
  status: "not_found" | "unavailable";
  message: string;
  tableId: string;
}

export type AnalysisTableCardResult = AnalysisTableCard | AnalysisTableCardFailure;

export interface AnalysisQuestionContextItem {
  column: string;
  label: string;
  normalizedType: string;
  valueLabels: Array<{
    value: string | number;
    label: string;
  }>;
}

export interface AnalysisQuestionContextResult {
  status: AnalysisAvailabilityStatus | "not_found";
  questionId: string;
  questionText: string | null;
  normalizedType: string | null;
  analyticalSubtype: string | null;
  disposition: string | null;
  surveyMatch: string | null;
  loop: {
    familyBase: string;
    iterationIndex: number;
    iterationCount: number;
  } | null;
  hiddenLink: {
    linkedTo: string;
    method: string;
  } | null;
  baseSummary: {
    situation: string | null;
    signals: string[];
    questionBase: number | null;
    totalN: number | null;
    itemBaseRange: [number, number] | null;
  } | null;
  items: AnalysisQuestionContextItem[];
  totalItems: number;
  truncatedItems: number;
  relatedTableIds: string[];
  sourceRefs: AnalysisSourceRef[];
  message?: string;
}

export interface AnalysisBannerCut {
  name: string;
  statLetter: string | null;
  expression: string | null;
}

export interface AnalysisBannerGroupResult {
  groupName: string;
  cuts: AnalysisBannerCut[];
}

export interface AnalysisBannerCutsResult {
  status: AnalysisAvailabilityStatus;
  filter: string | null;
  groups: AnalysisBannerGroupResult[];
  totalGroups: number;
  totalCuts: number;
  message?: string;
}

export function isAnalysisTableCard(value: unknown): value is AnalysisTableCard {
  if (!value || typeof value !== "object") return false;

  const record = value as Record<string, unknown>;
  return record.status === "available"
    && typeof record.tableId === "string"
    && Array.isArray(record.columns)
    && Array.isArray(record.rows);
}
