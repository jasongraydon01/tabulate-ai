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

export type AnalysisGroundingClaimType = "numeric" | "context";

export type AnalysisEvidenceKind = "table_card" | "context";

export interface AnalysisGroundingRef {
  claimId: string;
  claimType: AnalysisGroundingClaimType;
  evidenceKind: AnalysisEvidenceKind;
  refType: AnalysisSourceRef["refType"];
  refId: string;
  label: string;
  anchorId?: string | null;
  artifactId?: string | null;
  sourceTableId?: string | null;
  sourceQuestionId?: string | null;
  renderedInCurrentMessage?: boolean;
}

export interface AnalysisEvidenceItem {
  key: string;
  claimType: AnalysisGroundingClaimType;
  evidenceKind: AnalysisEvidenceKind;
  refType: AnalysisSourceRef["refType"];
  refId: string;
  label: string;
  anchorId?: string | null;
  artifactId?: string | null;
  sourceTableId?: string | null;
  sourceQuestionId?: string | null;
  renderedInCurrentMessage?: boolean;
}

export interface AnalysisMessageMetadata {
  hasGroundedClaims?: boolean;
  evidence?: AnalysisEvidenceItem[];
  followUpSuggestions?: string[];
}

export type AnalysisMessageFeedbackVote = "up" | "down";

export interface AnalysisMessageFeedbackRecord {
  messageId: string;
  vote: AnalysisMessageFeedbackVote;
  correctionText: string | null;
  updatedAt: number;
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
  // `columns` / `columnGroups` always carry every USED cut on the source table.
  // The agent's cutFilter is a render hint (see focusedCutIds), not a data filter.
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
  // Cut ids matched by the agent's cutFilter — used by the UI to pick which
  // non-Total groups lead the compact inline view. Null or empty = no focus;
  // details disclosure and expand dialog always show every cut regardless.
  focusedCutIds: string[] | null;
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
  // Survey-document fields — attached when the question has a matching entry
  // in the parsed survey document. Absent otherwise. Consolidates what the
  // (now removed) getSurveyQuestion tool used to return.
  sequenceNumber?: number | null;
  sectionHeader?: string | null;
  instructionText?: string | null;
  surveyQuestionType?: string | null;
  surveyFormat?: string | null;
  answerOptions?: AnalysisSurveyAnswerOption[];
  scaleLabels?: AnalysisSurveyScaleLabel[];
  progNotes?: string[];
  documentSnippet?: string | null;
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
