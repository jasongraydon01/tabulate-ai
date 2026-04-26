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

export type AnalysisGroundingClaimType = "numeric" | "context" | "cell";

export type AnalysisEvidenceKind = "table_card" | "context" | "cell";

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
  rowKey?: string | null;
  cutKey?: string | null;
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
  rowKey?: string | null;
  cutKey?: string | null;
  renderedInCurrentMessage?: boolean;
}

export interface AnalysisMessageMetadata {
  hasGroundedClaims?: boolean;
  evidence?: AnalysisEvidenceItem[];
  contextEvidence?: AnalysisEvidenceItem[];
  followUpSuggestions?: string[];
}

export interface AnalysisRenderDirectiveFocus {
  rowLabels?: string[];
  rowRefs?: string[];
  groupNames?: string[];
  groupRefs?: string[];
}

export interface AnalysisStructuredTextPart {
  type: "text";
  text: string;
}

export interface AnalysisStructuredRenderPart {
  type: "render";
  tableId: string;
  focus?: AnalysisRenderDirectiveFocus;
}

export interface AnalysisStructuredCitePart {
  type: "cite";
  cellIds: string[];
}

export type AnalysisStructuredAssistantPart =
  | AnalysisStructuredTextPart
  | AnalysisStructuredRenderPart
  | AnalysisStructuredCitePart;

export function isAnalysisStructuredTextPart(value: unknown): value is AnalysisStructuredTextPart {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === "text" && typeof record.text === "string";
}

export function isAnalysisStructuredRenderPart(value: unknown): value is AnalysisStructuredRenderPart {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === "render" && typeof record.tableId === "string";
}

export function isAnalysisStructuredCitePart(value: unknown): value is AnalysisStructuredCitePart {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return record.type === "cite" && Array.isArray(record.cellIds);
}

export function isAnalysisStructuredAssistantPart(value: unknown): value is AnalysisStructuredAssistantPart {
  return isAnalysisStructuredTextPart(value)
    || isAnalysisStructuredRenderPart(value)
    || isAnalysisStructuredCitePart(value);
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
  score?: number;
}

export interface AnalysisCatalogTableMatch {
  tableId: string;
  title: string;
  questionId: string | null;
  questionText: string | null;
  tableType: string | null;
  score?: number;
}

export interface AnalysisCatalogCutMatch {
  groupName: string;
  cutName: string;
  statLetter: string | null;
  score?: number;
}

export type AnalysisCatalogSearchMode = "search" | "listing";

export interface AnalysisCatalogSearchResult {
  status: AnalysisAvailabilityStatus;
  mode: AnalysisCatalogSearchMode;
  query?: string;
  scope?: AnalysisCatalogSearchScope;
  questions: AnalysisCatalogQuestionMatch[];
  tables: AnalysisCatalogTableMatch[];
  cuts: AnalysisCatalogCutMatch[];
  totals?: {
    questions: number;
    tables: number;
    cuts: number;
  };
  message?: string;
}

export type AnalysisCatalogSearchScope = "all" | "questions" | "tables" | "cuts";
export type AnalysisValueMode = "pct" | "count" | "n" | "mean";
export type AnalysisFetchTableCutGroups = "*" | string[];
export type AnalysisQuestionContextInclude =
  | "items"
  | "survey"
  | "relatedTables"
  | "loop"
  | "linkage";
export type AnalysisBannerCutsInclude = "expressions";

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

export interface AnalysisTableCardRowFormat {
  kind: "percent" | "number";
  decimals: number;
}

export interface AnalysisTableCardRow {
  rowKey: string;
  label: string;
  rowKind?: string;
  statType?: string | null;
  valueType?: "pct" | "count" | "n" | "mean" | "median" | "stddev" | "stderr";
  format?: AnalysisTableCardRowFormat | null;
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
  // Render focus changes presentation, not the underlying evidence payload.
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
  // Back-compat for older persisted cards. New render focus travels through
  // render markers, not the artifact payload.
  focusedCutIds?: string[] | null;
  /** @deprecated legacy persisted field retained for replay compatibility */
  requestedRowFilter?: string | null;
  /** @deprecated legacy persisted field retained for replay compatibility */
  requestedCutFilter?: string | null;
  requestedCutGroups?: AnalysisFetchTableCutGroups | null;
  focusedRowKeys?: string[] | null;
  focusedGroupKeys?: string[] | null;
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

// cellId is a composite of (tableId, rowKey, cutKey). cutKey can contain
// colons and spaces (e.g. `group:age::under 30`), so each component is
// URI-encoded before being joined with `|` — that keeps the id safe to drop
// unquoted into a `[[cite cellIds=...]]` marker without ambiguity.
export function buildAnalysisCellId(params: {
  tableId: string;
  rowKey: string;
  cutKey: string;
}): string {
  const enc = encodeURIComponent;
  return `${enc(params.tableId)}|${enc(params.rowKey)}|${enc(params.cutKey)}`;
}

export function parseAnalysisCellId(cellId: string): {
  tableId: string;
  rowKey: string;
  cutKey: string;
} | null {
  const parts = cellId.split("|");
  if (parts.length !== 3) return null;
  const [rawTableId, rawRowKey, rawCutKey] = parts;
  if (!rawTableId || !rawRowKey || !rawCutKey) return null;
  try {
    return {
      tableId: decodeURIComponent(rawTableId),
      rowKey: decodeURIComponent(rawRowKey),
      cutKey: decodeURIComponent(rawCutKey),
    };
  } catch {
    return null;
  }
}

export interface AnalysisCellSummary {
  cellId: string;
  tableId: string;
  tableTitle: string;
  questionId: string | null;
  rowKey: string;
  rowLabel: string;
  cutKey: string;
  cutName: string;
  groupName: string | null;
  valueMode: AnalysisValueMode;
  displayValue: string;
  pct: number | null;
  count: number | null;
  n: number | null;
  mean: number | null;
  baseN: number | null;
  sigHigherThan: string[];
  sigVsTotal: string | null;
  sourceRefs: AnalysisSourceRef[];
}

export type AnalysisCellConfirmedResult = AnalysisCellSummary & { status: "confirmed" };

export interface AnalysisCellConfirmationRowCandidate {
  rowLabel: string;
  rowRef: string;
}

export interface AnalysisCellConfirmationColumnCandidate {
  columnLabel: string;
  columnRef: string;
  statLetter?: string | null;
}

export interface AnalysisCellConfirmationFailure {
  status:
    | "not_found"
    | "invalid_row"
    | "invalid_cut"
    | "invalid_column"
    | "ambiguous_row"
    | "ambiguous_column"
    | "unavailable";
  tableId: string;
  rowKey?: string;
  cutKey?: string;
  message: string;
  allowedRowKeys?: string[];
  allowedCutKeys?: string[];
  candidateRows?: AnalysisCellConfirmationRowCandidate[];
  candidateColumns?: AnalysisCellConfirmationColumnCandidate[];
}

export type AnalysisCellConfirmationResult = AnalysisCellConfirmedResult | AnalysisCellConfirmationFailure;

export function isAnalysisCellSummary(value: unknown): value is AnalysisCellSummary {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.cellId === "string"
    && typeof record.tableId === "string"
    && typeof record.rowKey === "string"
    && typeof record.cutKey === "string"
    && typeof record.valueMode === "string";
}

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
  includedSections?: AnalysisQuestionContextInclude[];
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
  expression?: string | null;
}

export interface AnalysisBannerGroupResult {
  groupName: string;
  cuts: AnalysisBannerCut[];
}

export interface AnalysisBannerCutsResult {
  status: AnalysisAvailabilityStatus;
  filter: string | null;
  includedSections?: AnalysisBannerCutsInclude[];
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
