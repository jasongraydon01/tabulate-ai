import { isToolUIPart, type UIMessage } from "ai";

import { FETCH_TABLE_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import type {
  AnalysisGroundingRef,
  AnalysisSourceRef,
  AnalysisTableCard,
} from "@/lib/analysis/types";

export interface AnalysisTurnGroundingEvent {
  toolName: string;
  toolCallId: string;
  sourceRefs: AnalysisSourceRef[];
  tableCard?: AnalysisTableCard;
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
  hasGroundedClaims: boolean;
  groundingRefs: AnalysisGroundingRef[];
  injectedTableCards: InjectedAnalysisTableCard[];
}

const NUMERIC_CLAIM_PATTERNS = [
  /\b\d+(?:\.\d+)?%/i,
  /\bn\s*=\s*\d+\b/i,
  /\bbase\s*(?:size|n)?\s*(?:of|is|was)?\s*\d+\b/i,
  /\bmean\b/i,
  /\bsignificant(?:ly)?\b/i,
  /\b\d+(?:\.\d+)?\s+points?\b/i,
  /\b(?:higher|lower|up|down)\s+than\b/i,
];

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

function hasGroundedClaimSignals(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  return NUMERIC_CLAIM_PATTERNS.some((pattern) => pattern.test(normalized));
}

function repairUnsupportedGroundedClaims(): string {
  return "I don't want to quantify that without a supporting table card in the thread. I can pull the relevant table first and then put numbers on it.";
}

function buildNumericTableRef(params: {
  label: string;
  refId: string;
  sourceTableId: string;
  sourceQuestionId?: string | null;
  anchorId?: string | null;
  artifactId?: string | null;
  renderedInCurrentMessage?: boolean;
}): AnalysisGroundingRef {
  return {
    claimId: "numeric-1",
    claimType: "numeric",
    evidenceKind: "table_card",
    refType: "table",
    refId: params.refId,
    label: params.label,
    anchorId: params.anchorId ?? null,
    artifactId: params.artifactId ?? null,
    sourceTableId: params.sourceTableId,
    sourceQuestionId: params.sourceQuestionId ?? null,
    renderedInCurrentMessage: params.renderedInCurrentMessage ?? false,
  };
}

function buildContextRef(ref: AnalysisSourceRef): AnalysisGroundingRef {
  return {
    claimId: "context-1",
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

function dedupeGroundingRefs(refs: AnalysisGroundingRef[]): AnalysisGroundingRef[] {
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
    ].join("::");

    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(ref);
  }

  return deduped;
}

function collectRenderedTableCards(parts: UIMessage["parts"]): InjectedAnalysisTableCard[] {
  return parts.flatMap((part) => {
    if (!isToolUIPart(part) || part.type !== FETCH_TABLE_TOOL_TYPE) return [];
    if (part.state !== "output-available") return [];
    if (!part.output || typeof part.output !== "object") return [];

    const card = part.output as AnalysisTableCard;
    if (card.status !== "available" || typeof card.tableId !== "string") return [];

    return [{
      toolCallId: part.toolCallId,
      card,
    }];
  });
}

function isContextRefType(ref: AnalysisSourceRef): boolean {
  return ref.refType !== "table" && ref.refType !== "question";
}

export function resolveAssistantMessageTrust(params: {
  assistantText: string;
  responseParts: UIMessage["parts"];
  groundingEvents: AnalysisTurnGroundingEvent[];
  priorTableArtifacts: AnalysisSessionTableArtifact[];
}): ClaimCheckResult {
  const cleanedAssistantText = stripPlaceholderCitations(params.assistantText);
  const hasGroundedClaims = hasGroundedClaimSignals(cleanedAssistantText);
  if (!hasGroundedClaims) {
    return {
      assistantText: cleanedAssistantText,
      hasGroundedClaims: false,
      groundingRefs: [],
      injectedTableCards: [],
    };
  }

  const currentRenderedCards = collectRenderedTableCards(params.responseParts);

  // Every fetchTable call this turn produces a part in the message (rendered
  // inline via marker, or silently appended as fallback by the renderer).
  // Treat them all as candidate support for numeric claims.
  const numericRefs: AnalysisGroundingRef[] = currentRenderedCards.map(({ toolCallId, card }) =>
    buildNumericTableRef({
      label: card.title,
      refId: card.tableId,
      sourceTableId: card.tableId,
      sourceQuestionId: card.questionId,
      anchorId: toolCallId,
      renderedInCurrentMessage: true,
    }));

  const injectedTableCards: InjectedAnalysisTableCard[] = [];

  if (numericRefs.length === 0) {
    // Claim but no fetchTable this turn — look for a prior-turn artifact that
    // the agent's grounding events referenced. Surface it as a grounding ref
    // so the evidence panel links back to the original rendered card without
    // re-injecting a duplicate card in this message.
    const usedTableIds = new Set(
      params.groundingEvents
        .flatMap((event) => event.sourceRefs)
        .filter((ref) => ref.refType === "table")
        .map((ref) => ref.refId),
    );

    for (const artifact of params.priorTableArtifacts) {
      const matchingTableId = artifact.sourceTableIds.find((tableId) => usedTableIds.has(tableId));
      if (!matchingTableId) continue;

      numericRefs.push(buildNumericTableRef({
        label: artifact.title,
        refId: matchingTableId,
        sourceTableId: matchingTableId,
        sourceQuestionId: artifact.sourceQuestionIds[0] ?? null,
        anchorId: artifact.artifactId,
        artifactId: artifact.artifactId,
        renderedInCurrentMessage: false,
      }));
    }
  }

  if (numericRefs.length === 0) {
    return {
      assistantText: repairUnsupportedGroundedClaims(),
      hasGroundedClaims: false,
      groundingRefs: [],
      injectedTableCards: [],
    };
  }

  const contextRefs = params.groundingEvents
    .flatMap((event) => event.sourceRefs)
    .filter(isContextRefType)
    .slice(0, MAX_CONTEXT_REFS)
    .map(buildContextRef);

  return {
    assistantText: cleanedAssistantText,
    hasGroundedClaims: true,
    groundingRefs: dedupeGroundingRefs([...numericRefs, ...contextRefs]),
    injectedTableCards,
  };
}
