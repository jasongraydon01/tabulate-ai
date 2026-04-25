import { isToolUIPart, type UIMessage } from "ai";

import { extractAnalysisCiteMarkers } from "@/lib/analysis/citeAnchors";
import { serializeAnalysisStructuredAssistantPartsToText } from "@/lib/analysis/structuredParts";
import { FETCH_TABLE_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import {
  isAnalysisStructuredCitePart,
  isAnalysisStructuredTextPart,
  type AnalysisStructuredAssistantPart,
  parseAnalysisCellId,
  type AnalysisCellSummary,
  type AnalysisGroundingRef,
  type AnalysisSourceRef,
  type AnalysisTableCard,
} from "@/lib/analysis/types";

export interface AnalysisTurnGroundingEvent {
  toolName: string;
  toolCallId: string;
  sourceRefs: AnalysisSourceRef[];
  tableCard?: AnalysisTableCard;
  cellSummary?: AnalysisCellSummary;
}

export interface AnalysisSessionTableArtifact {
  artifactId: string;
  title: string;
  sourceTableIds: string[];
  sourceQuestionIds: string[];
  payload?: AnalysisTableCard | null;
}

export interface InjectedAnalysisTableCard {
  toolCallId: string;
  card: AnalysisTableCard;
}

export interface ClaimCheckResult {
  assistantText: string;
  assistantParts: AnalysisStructuredAssistantPart[];
  hasGroundedClaims: boolean;
  groundingRefs: AnalysisGroundingRef[];
  injectedTableCards: InjectedAnalysisTableCard[];
}

// Narrow detector used only by the freelancing-log regression detector in the
// route post-pass. Unlike the old claim-check, this does not gate repair — it
// warns when the assistant quoted a specific number while making zero
// `confirmCitation` calls and emitting zero cite markers, so we can notice
// model-workflow regressions without blocking good prose.
const UNCITED_NUMERIC_PATTERNS = [
  /\b\d+(?:\.\d+)?%/,
  /\bn\s*=\s*\d+\b/i,
];

export function detectUncitedSpecificNumbers(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return UNCITED_NUMERIC_PATTERNS.some((pattern) => pattern.test(normalized));
}

const MAX_CONTEXT_REFS = 2;
const PLACEHOLDER_CITATION_LINE_RE = /^\s*\{\{(?:table|question|banner|survey|source):[^}]+\}\}\s*$/i;

function stripPlaceholderCitations(text: string): string {
  const lines = text.split("\n");
  const filtered = lines.filter((line) => !PLACEHOLDER_CITATION_LINE_RE.test(line));

  const compacted = filtered
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?:\n\s*---\s*\n)+/g, "\n\n")
    .trim();

  return compacted;
}

function stripPlaceholderCitationsFromAssistantParts(
  parts: AnalysisStructuredAssistantPart[],
): AnalysisStructuredAssistantPart[] {
  const cleanedParts: AnalysisStructuredAssistantPart[] = [];

  for (const part of parts) {
    if (!isAnalysisStructuredTextPart(part)) {
      cleanedParts.push(part);
      continue;
    }

    const cleaned = stripPlaceholderCitations(part.text);
    if (cleaned.length > 0) {
      cleanedParts.push({ type: "text", text: cleaned });
    }
  }

  return cleanedParts;
}

function collectRenderedTableCardsByTableId(
  parts: UIMessage["parts"],
): Map<string, { toolCallId: string; card: AnalysisTableCard }> {
  const byTableId = new Map<string, { toolCallId: string; card: AnalysisTableCard }>();
  for (const part of parts) {
    if (!isToolUIPart(part) || part.type !== FETCH_TABLE_TOOL_TYPE) continue;
    if (part.state !== "output-available") continue;
    if (!part.output || typeof part.output !== "object") continue;

    const card = part.output as AnalysisTableCard;
    if (card.status !== "available" || typeof card.tableId !== "string") continue;

    // Later-in-sequence wins for the same tableId — usually an intentional
    // refetch. Matches `renderAnchors.buildTableIdMap`.
    byTableId.set(card.tableId, { toolCallId: part.toolCallId, card });
  }
  return byTableId;
}

function buildCellRef(params: {
  cellId: string;
  tableId: string;
  rowKey: string;
  cutKey: string;
  cellSummary?: AnalysisCellSummary;
  renderedTable?: { toolCallId: string; card: AnalysisTableCard };
}): AnalysisGroundingRef {
  const { cellId, tableId, rowKey, cutKey, cellSummary, renderedTable } = params;
  const label = cellSummary
    ? `${cellSummary.tableTitle} — ${cellSummary.rowLabel} / ${cellSummary.cutName}`
    : `${tableId} — ${rowKey} / ${cutKey}`;

  return {
    claimId: cellId,
    claimType: "cell",
    evidenceKind: "cell",
    refType: "table",
    refId: tableId,
    label,
    anchorId: renderedTable?.toolCallId ?? null,
    artifactId: null,
    sourceTableId: tableId,
    sourceQuestionId: cellSummary?.questionId ?? null,
    rowKey,
    cutKey,
    renderedInCurrentMessage: Boolean(renderedTable),
  };
}

function buildContextRef(ref: AnalysisSourceRef): AnalysisGroundingRef {
  return {
    claimId: `context-${ref.refType}-${ref.refId}`,
    claimType: "context",
    evidenceKind: "context",
    refType: ref.refType,
    refId: ref.refId,
    label: ref.label ?? ref.refId,
    anchorId: null,
    artifactId: null,
    sourceTableId: null,
    sourceQuestionId: ref.refType === "question" || ref.refType === "survey_question" ? ref.refId : null,
    renderedInCurrentMessage: false,
  };
}

export function dedupeGroundingRefs(refs: AnalysisGroundingRef[]): AnalysisGroundingRef[] {
  const seen = new Set<string>();
  const deduped: AnalysisGroundingRef[] = [];

  for (const ref of refs) {
    const key = [
      ref.claimId,
      ref.claimType,
      ref.evidenceKind,
      ref.refType,
      ref.refId,
      ref.anchorId ?? "",
      ref.artifactId ?? "",
      ref.sourceTableId ?? "",
      ref.sourceQuestionId ?? "",
      ref.rowKey ?? "",
      ref.cutKey ?? "",
    ].join("::");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }

  return deduped;
}

function isContextRefType(ref: AnalysisSourceRef): boolean {
  return ref.refType !== "table" && ref.refType !== "question";
}

/**
 * Resolves grounded trust for a finalized assistant message. In Slice 1 the
 * route can now pass canonical structured assistant parts, so cite-derived
 * grounding comes from explicit `cite` parts when available and falls back to
 * legacy marker scanning only for older text-only paths.
 */
export function resolveAssistantMessageTrust(params: {
  assistantText?: string;
  assistantParts?: AnalysisStructuredAssistantPart[];
  responseParts: UIMessage["parts"];
  groundingEvents: AnalysisTurnGroundingEvent[];
}): ClaimCheckResult {
  const cleanedAssistantParts = params.assistantParts
    ? stripPlaceholderCitationsFromAssistantParts(params.assistantParts)
    : [];
  const cleanedAssistantText = cleanedAssistantParts.length > 0
    ? serializeAnalysisStructuredAssistantPartsToText(cleanedAssistantParts)
    : stripPlaceholderCitations(params.assistantText ?? "");

  const cellSummariesById = new Map<string, AnalysisCellSummary>();
  for (const event of params.groundingEvents) {
    if (event.cellSummary) {
      cellSummariesById.set(event.cellSummary.cellId, event.cellSummary);
    }
  }

  const renderedTablesByTableId = collectRenderedTableCardsByTableId(params.responseParts);

  const citedCellIds = cleanedAssistantParts.length > 0
    ? cleanedAssistantParts.flatMap((part) => (isAnalysisStructuredCitePart(part) ? part.cellIds : []))
    : extractAnalysisCiteMarkers(cleanedAssistantText).flatMap((marker) => marker.cellIds);

  const cellRefs: AnalysisGroundingRef[] = [];
  for (const cellId of citedCellIds) {
      const parsed = parseAnalysisCellId(cellId);
      if (!parsed) continue;

      cellRefs.push(buildCellRef({
        cellId,
        tableId: parsed.tableId,
        rowKey: parsed.rowKey,
        cutKey: parsed.cutKey,
        cellSummary: cellSummariesById.get(cellId),
        renderedTable: renderedTablesByTableId.get(parsed.tableId),
      }));
  }

  const contextRefs = params.groundingEvents
    .flatMap((event) => event.sourceRefs)
    .filter(isContextRefType)
    .slice(0, MAX_CONTEXT_REFS)
    .map(buildContextRef);

  return {
    assistantText: cleanedAssistantText,
    assistantParts: cleanedAssistantParts,
    hasGroundedClaims: cellRefs.length > 0,
    groundingRefs: dedupeGroundingRefs([...cellRefs, ...contextRefs]),
    // Kept for backwards-compatible route shape; no injection in v1.
    injectedTableCards: [],
  };
}
