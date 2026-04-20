export type AnalysisAvailabilityStatus = "available" | "partial" | "unavailable";

export interface AnalysisSourceRef {
  refType:
    | "table"
    | "question"
    | "banner_group"
    | "banner_cut"
    | "banner_plan"
    | "survey_question"
    | "survey_document"
    | "project"
    | "run";
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
  rowKind?: string;
  statType?: string | null;
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

export interface AnalysisRunContextResult {
  status: AnalysisAvailabilityStatus;
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
  sourceRefs: AnalysisSourceRef[];
  message?: string;
}

export interface AnalysisBannerPlanColumnResult {
  name: string;
  original: string;
}

export interface AnalysisBannerPlanGroupResult {
  groupName: string;
  columns: AnalysisBannerPlanColumnResult[];
}

export interface AnalysisBannerPlanContextResult {
  status: AnalysisAvailabilityStatus | "not_found";
  filter: string | null;
  routeUsed: "banner_agent" | "banner_generate" | null;
  bannerSource: "uploaded" | "auto_generated" | null;
  usedFallbackFromBannerAgent: boolean | null;
  researchObjectives: string | null;
  bannerHints: string | null;
  groups: AnalysisBannerPlanGroupResult[];
  totalGroups: number;
  totalCuts: number;
  sourceRefs: AnalysisSourceRef[];
  message?: string;
}

export interface AnalysisSurveyAnswerOption {
  code: string | number;
  text: string;
  routing: string | null;
  progNote: string | null;
}

export interface AnalysisSurveyScaleLabel {
  value: number;
  label: string;
}

export interface AnalysisSurveyQuestionResult {
  status: AnalysisAvailabilityStatus | "not_found";
  query: string;
  questionId: string | null;
  questionText: string | null;
  sequenceNumber: number | null;
  sectionHeader: string | null;
  instructionText: string | null;
  questionType: string | null;
  format: string | null;
  answerOptions: AnalysisSurveyAnswerOption[];
  scaleLabels: AnalysisSurveyScaleLabel[];
  progNotes: string[];
  documentSnippet: string | null;
  sourceRefs: AnalysisSourceRef[];
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
