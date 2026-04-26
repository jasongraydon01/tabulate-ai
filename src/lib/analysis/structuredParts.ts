import type { UIMessage } from "ai";

import { buildAnalysisCiteMarker, extractAnalysisCiteMarkers } from "@/lib/analysis/citeAnchors";
import {
  buildAnalysisRenderMarker,
  extractAnalysisRenderMarkerOccurrences,
  type AnalysisRenderMarkerParsedOccurrence,
} from "@/lib/analysis/renderAnchors";
import { SUBMIT_ANSWER_TOOL_TYPE } from "@/lib/analysis/toolLabels";
import type {
  AnalysisRenderDirectiveFocus,
  AnalysisStructuredAssistantPart,
  AnalysisStructuredCitePart,
  AnalysisStructuredRenderPart,
  AnalysisStructuredTextPart,
} from "@/lib/analysis/types";
import { AnalysisStructuredAnswerSchema } from "@/schemas/analysisStructuredAnswerSchema";

type AssistantMarkerOccurrence =
  | ({ kind: "render" } & AnalysisRenderMarkerParsedOccurrence)
  | ({ kind: "cite" } & ReturnType<typeof extractAnalysisCiteMarkers>[number]);

function normalizeRenderFocus(
  focus: AnalysisRenderDirectiveFocus | undefined,
): AnalysisRenderDirectiveFocus | undefined {
  if (!focus) return undefined;

  const normalized: AnalysisRenderDirectiveFocus = {};
  if (focus.rowLabels && focus.rowLabels.length > 0) normalized.rowLabels = [...focus.rowLabels];
  if (focus.rowRefs && focus.rowRefs.length > 0) normalized.rowRefs = [...focus.rowRefs];
  if (focus.groupNames && focus.groupNames.length > 0) normalized.groupNames = [...focus.groupNames];
  if (focus.groupRefs && focus.groupRefs.length > 0) normalized.groupRefs = [...focus.groupRefs];

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeStructuredTextPart(
  part: Pick<AnalysisStructuredTextPart, "text">,
): AnalysisStructuredTextPart | null {
  return part.text.trim().length > 0 ? { type: "text", text: part.text } : null;
}

function normalizeStructuredRenderPart(
  part: AnalysisStructuredRenderPart,
): AnalysisStructuredRenderPart {
  return {
    type: "render",
    tableId: part.tableId.trim(),
    ...(normalizeRenderFocus(part.focus) ? { focus: normalizeRenderFocus(part.focus) } : {}),
  };
}

function normalizeStructuredCitePart(
  part: AnalysisStructuredCitePart,
): AnalysisStructuredCitePart | null {
  const cellIds = [...new Set(part.cellIds.map((cellId) => cellId.trim()).filter((cellId) => cellId.length > 0))];
  return cellIds.length > 0 ? { type: "cite", cellIds } : null;
}

export function normalizeAnalysisStructuredAssistantParts(
  parts: AnalysisStructuredAssistantPart[],
): AnalysisStructuredAssistantPart[] {
  const normalized: AnalysisStructuredAssistantPart[] = [];

  for (const part of parts) {
    if (part.type === "text") {
      const normalizedText = normalizeStructuredTextPart(part);
      if (normalizedText) normalized.push(normalizedText);
      continue;
    }

    if (part.type === "render") {
      normalized.push(normalizeStructuredRenderPart(part));
      continue;
    }

    const normalizedCite = normalizeStructuredCitePart(part);
    if (normalizedCite) normalized.push(normalizedCite);
  }

  return normalized;
}

function buildRenderPartFromOccurrence(
  occurrence: Extract<AssistantMarkerOccurrence, { kind: "render" }>,
): AnalysisStructuredRenderPart {
  return {
    type: "render",
    tableId: occurrence.tableId,
    ...(normalizeRenderFocus({
      rowLabels: occurrence.rowLabels,
      rowRefs: occurrence.rowRefs,
      groupNames: occurrence.groupNames,
      groupRefs: occurrence.groupRefs,
    }) ? {
      focus: normalizeRenderFocus({
        rowLabels: occurrence.rowLabels,
        rowRefs: occurrence.rowRefs,
        groupNames: occurrence.groupNames,
        groupRefs: occurrence.groupRefs,
      }),
    } : {}),
  };
}

function buildCitePartFromOccurrence(
  occurrence: Extract<AssistantMarkerOccurrence, { kind: "cite" }>,
): AnalysisStructuredCitePart {
  return {
    type: "cite",
    cellIds: [...occurrence.cellIds],
  };
}

function normalizeTextSegment(
  text: string,
  options?: {
    trimStartForRenderBoundary?: boolean;
    trimEndForRenderBoundary?: boolean;
  },
): string {
  let normalized = text;

  if (options?.trimStartForRenderBoundary) {
    normalized = normalized.replace(/^\s*\n{2,}[ \t]*/u, "");
  }

  if (options?.trimEndForRenderBoundary) {
    normalized = normalized.replace(/[ \t]*\n{2,}\s*$/u, "");
  }

  return normalized;
}

export function buildAnalysisStructuredAssistantPartsFromText(
  text: string,
): AnalysisStructuredAssistantPart[] {
  const renderOccurrences = extractAnalysisRenderMarkerOccurrences(text)
    .map((occurrence) => ({ ...occurrence, kind: "render" as const }));
  const citeOccurrences = extractAnalysisCiteMarkers(text)
    .map((occurrence) => ({ ...occurrence, kind: "cite" as const }));

  const occurrences: AssistantMarkerOccurrence[] = [...renderOccurrences, ...citeOccurrences]
    .sort((left, right) => {
      if (left.start === right.start) {
        return left.end - right.end;
      }
      return left.start - right.start;
    });

  if (occurrences.length === 0) {
    return text.length > 0 ? [{ type: "text", text }] : [];
  }

  const parts: AnalysisStructuredAssistantPart[] = [];
  let cursor = 0;
  let previousWasRender = false;

  for (const occurrence of occurrences) {
    if (occurrence.start > cursor) {
      const rawSegment = text.slice(cursor, occurrence.start);
      const normalizedSegment = normalizeTextSegment(rawSegment, {
        trimStartForRenderBoundary: previousWasRender,
        trimEndForRenderBoundary: occurrence.kind === "render",
      });
      if (normalizedSegment.length > 0) {
        parts.push({ type: "text", text: normalizedSegment });
      }
    }

    parts.push(
      occurrence.kind === "render"
        ? buildRenderPartFromOccurrence(occurrence)
        : buildCitePartFromOccurrence(occurrence),
    );
    cursor = occurrence.end;
    previousWasRender = occurrence.kind === "render";
  }

  if (cursor < text.length) {
    const tail = normalizeTextSegment(text.slice(cursor), {
      trimStartForRenderBoundary: previousWasRender,
    });
    if (tail.length > 0) {
      parts.push({ type: "text", text: tail });
    }
  }

  return normalizeAnalysisStructuredAssistantParts(parts);
}

export function getAnalysisTextFromStructuredAssistantParts(
  parts: AnalysisStructuredAssistantPart[],
): string {
  let output = "";
  let previous: AnalysisStructuredAssistantPart | null = null;

  for (const part of parts) {
    if (part.type === "cite") {
      previous = part;
      continue;
    }

    const needsRenderBoundary = part.type === "render" || previous?.type === "render";
    if (part.type === "text") {
      if (needsRenderBoundary && output.trim().length > 0) {
        output += "\n\n";
      }
      output += part.text;
    }

    previous = part;
  }

  return output
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

export function extractAnalysisStructuredAssistantPartsFromSubmitAnswer(
  parts: UIMessage["parts"],
): AnalysisStructuredAssistantPart[] | null {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (!part || typeof part !== "object") continue;

    const record = part as Record<string, unknown>;
    if (record.type !== SUBMIT_ANSWER_TOOL_TYPE) continue;

    const payload = record.state === "output-available" ? record.output : record.input;
    const parsed = AnalysisStructuredAnswerSchema.safeParse(payload);
    if (!parsed.success) continue;

    return normalizeAnalysisStructuredAssistantParts(parsed.data.parts);
  }

  return null;
}

export type AnalysisStructuredAnswerExtractionFailureReason =
  | "missing_submit_answer"
  | "multiple_submit_answers"
  | "submit_answer_invalid"
  | "submit_answer_empty"
  | "assistant_text_outside_submit_answer";

export interface AnalysisStructuredAnswerExtractionFailure {
  ok: false;
  reason: AnalysisStructuredAnswerExtractionFailureReason;
  message: string;
}

export interface AnalysisStructuredAnswerExtractionSuccess {
  ok: true;
  parts: AnalysisStructuredAssistantPart[];
  submitAnswerIndex: number;
}

export function extractStrictAnalysisStructuredAssistantPartsFromSubmitAnswer(
  parts: UIMessage["parts"],
): AnalysisStructuredAnswerExtractionFailure | AnalysisStructuredAnswerExtractionSuccess {
  const submitAnswerParts = parts
    .map((part, index) => ({ part, index }))
    .filter(({ part }) => {
      if (!part || typeof part !== "object") return false;
      const record = part as Record<string, unknown>;
      return record.type === SUBMIT_ANSWER_TOOL_TYPE;
    });

  if (submitAnswerParts.length === 0) {
    return {
      ok: false,
      reason: "missing_submit_answer",
      message: "Analysis turn failed: assistant did not finalize with submitAnswer({ parts }).",
    };
  }

  if (submitAnswerParts.length !== 1) {
    return {
      ok: false,
      reason: "multiple_submit_answers",
      message: "Analysis turn failed: assistant emitted multiple submitAnswer calls.",
    };
  }

  const [{ part, index }] = submitAnswerParts;
  const record = part as Record<string, unknown>;
  const payload = record.state === "output-available" ? record.output : record.input;
  const parsed = AnalysisStructuredAnswerSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "submit_answer_invalid",
      message: "Analysis turn failed: submitAnswer payload did not match the structured answer schema.",
    };
  }

  const normalizedParts = normalizeAnalysisStructuredAssistantParts(parsed.data.parts);
  if (normalizedParts.length === 0) {
    return {
      ok: false,
      reason: "submit_answer_empty",
      message: "Analysis turn failed: submitAnswer payload contained no usable assistant parts.",
    };
  }

  const hasAssistantTextOutsideSubmitAnswer = parts.some((candidate, candidateIndex) => (
    candidateIndex !== index
    && candidate.type === "text"
    && typeof candidate.text === "string"
    && candidate.text.trim().length > 0
  ));
  if (hasAssistantTextOutsideSubmitAnswer) {
    return {
      ok: false,
      reason: "assistant_text_outside_submit_answer",
      message: "Analysis turn failed: assistant emitted prose outside submitAnswer({ parts }).",
    };
  }

  return {
    ok: true,
    parts: normalizedParts,
    submitAnswerIndex: index,
  };
}

function separatorBetweenParts(
  previous: AnalysisStructuredAssistantPart | null,
  current: AnalysisStructuredAssistantPart,
): string {
  if (!previous) return "";
  if (previous.type === "text" && current.type === "cite") return "";
  if (previous.type === "cite" && current.type === "text") return "";
  if (previous.type === "cite" && current.type === "cite") return "";
  if (previous.type === "render" || current.type === "render") return "\n\n";
  return "";
}

function serializeRenderPart(part: AnalysisStructuredRenderPart): string {
  return buildAnalysisRenderMarker(part.tableId, part.focus);
}

function serializePart(part: AnalysisStructuredAssistantPart): string {
  if (part.type === "text") return part.text;
  if (part.type === "render") return serializeRenderPart(part);
  return buildAnalysisCiteMarker(part.cellIds);
}

export function serializeAnalysisStructuredAssistantPartsToText(
  parts: AnalysisStructuredAssistantPart[],
): string {
  let output = "";
  let previous: AnalysisStructuredAssistantPart | null = null;

  for (const part of parts) {
    output += separatorBetweenParts(previous, part);
    output += serializePart(part);
    previous = part;
  }

  return output
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}
