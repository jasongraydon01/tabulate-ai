import { buildAnalysisCiteMarker, extractAnalysisCiteMarkers } from "@/lib/analysis/citeAnchors";
import {
  buildAnalysisRenderMarker,
  extractAnalysisRenderMarkerOccurrences,
  type AnalysisRenderMarkerParsedOccurrence,
} from "@/lib/analysis/renderAnchors";
import type {
  AnalysisRenderDirectiveFocus,
  AnalysisStructuredAssistantPart,
  AnalysisStructuredCitePart,
  AnalysisStructuredRenderPart,
} from "@/lib/analysis/types";

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

  return parts;
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
