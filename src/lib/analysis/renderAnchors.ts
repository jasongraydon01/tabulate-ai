import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";

import { isAnalysisTableCard, type AnalysisTableCard } from "@/lib/analysis/types";

// ID-addressable render marker. The model emits `[[render tableId=A3]]` (or
// `[[render tableId="A3"]]`) in prose; the renderer resolves the id against
// this-turn's fetchTable call cache.
const RENDER_MARKER_BODY_SOURCE = `\\[\\[render\\s+tableId=(?:"([A-Za-z0-9_.-]{1,200})"|([A-Za-z0-9_.-]{1,200}))\\s*\\]\\]`;
const RENDER_MARKER_GLOBAL_RE = new RegExp(RENDER_MARKER_BODY_SOURCE, "g");

type FetchTableUIPart = UIMessage["parts"][number] & {
  type: "tool-fetchTable";
  toolCallId: string;
  state: "output-available";
  output: AnalysisTableCard;
};

export type AnalysisRenderableBlock =
  | { kind: "text"; key: string; text: string }
  | { kind: "placeholder"; key: string }
  | { kind: "missing"; key: string; tableId: string }
  | { kind: "table"; key: string; part: FetchTableUIPart };

function normalizeRenderableText(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function matchedTableId(match: RegExpExecArray): string {
  return (match[1] ?? match[2] ?? "").trim();
}

function getRenderableTableParts(parts: UIMessage["parts"]): FetchTableUIPart[] {
  function isFetchTableUIPart(part: UIMessage["parts"][number]): part is FetchTableUIPart {
    return (
      isToolUIPart(part)
      && part.type === "tool-fetchTable"
      && part.state === "output-available"
      && typeof part.toolCallId === "string"
      && isAnalysisTableCard(part.output)
    );
  }

  return parts.flatMap((part) => {
    if (isFetchTableUIPart(part)) return [part];
    return [];
  });
}

function buildTableIdMap(parts: FetchTableUIPart[]): Map<string, FetchTableUIPart> {
  // When multiple fetches hit the same tableId, later-in-sequence wins — that
  // is usually the intentional refetch (e.g., a refined cutFilter).
  const map = new Map<string, FetchTableUIPart>();
  for (const part of parts) {
    if (part.output.tableId) {
      map.set(part.output.tableId, part);
    }
  }
  return map;
}

export function stripAnalysisRenderAnchors(text: string): string {
  return normalizeRenderableText(text.replace(RENDER_MARKER_GLOBAL_RE, "\n\n"));
}

export function buildAnalysisRenderableBlocks(
  message: Pick<UIMessage, "id" | "parts">,
  options?: {
    isStreaming?: boolean;
  },
): AnalysisRenderableBlock[] {
  const text = message.parts
    .filter(isTextUIPart)
    .map((part) => part.text)
    .join("");
  const tableParts = getRenderableTableParts(message.parts);
  const tableMap = buildTableIdMap(tableParts);

  // Collect marker positions + referenced tableIds up-front.
  const markers: Array<{ start: number; end: number; tableId: string }> = [];
  const markerRe = new RegExp(RENDER_MARKER_BODY_SOURCE, "g");
  let match: RegExpExecArray | null = markerRe.exec(text);
  while (match) {
    const tableId = matchedTableId(match);
    if (tableId) {
      markers.push({ start: match.index, end: markerRe.lastIndex, tableId });
    }
    match = markerRe.exec(text);
  }

  const referencedTableIds = new Set(markers.map((m) => m.tableId));

  // No markers → legacy append behavior: text first, then any table parts
  // in the order the agent produced them. Keeps streaming UX forgiving when
  // the agent fetched a table without citing it.
  if (markers.length === 0) {
    if (text.trim().length === 0 && options?.isStreaming && tableParts.length > 0) {
      return [];
    }

    const blocks: AnalysisRenderableBlock[] = [];
    const cleanedText = normalizeRenderableText(text);
    if (cleanedText) {
      blocks.push({ kind: "text", key: `${message.id}-text-0`, text: cleanedText });
    }
    tableParts.forEach((part, index) => {
      blocks.push({
        kind: "table",
        key: `${message.id}-table-${part.toolCallId ?? index}`,
        part,
      });
    });
    return blocks;
  }

  // Walk the text, emitting text / table / placeholder / missing blocks in
  // order dictated by marker positions.
  const blocks: AnalysisRenderableBlock[] = [];
  let cursor = 0;
  markers.forEach((marker, index) => {
    const segment = text.slice(cursor, marker.start);
    const cleanedSegment = normalizeRenderableText(segment);
    if (cleanedSegment) {
      blocks.push({
        kind: "text",
        key: `${message.id}-text-${index}`,
        text: cleanedSegment,
      });
    }

    const part = tableMap.get(marker.tableId);
    if (part) {
      blocks.push({
        kind: "table",
        key: `${message.id}-table-${part.toolCallId}-${index}`,
        part,
      });
    } else if (options?.isStreaming) {
      // fetchTable may still be in-flight this turn; render a placeholder and
      // let the next streaming update resolve it.
      blocks.push({ kind: "placeholder", key: `${message.id}-placeholder-${index}` });
    } else {
      // Stream has settled; the tableId was never fetched. Emit a missing
      // block so the UI can render a minimal diagnostic; the model's claim-
      // check post-pass will still strip unsupported specifics separately.
      blocks.push({
        kind: "missing",
        key: `${message.id}-missing-${index}-${marker.tableId}`,
        tableId: marker.tableId,
      });
    }

    cursor = marker.end;
  });

  const tail = text.slice(cursor);
  const cleanedTail = normalizeRenderableText(tail);
  if (cleanedTail) {
    blocks.push({
      kind: "text",
      key: `${message.id}-text-tail`,
      text: cleanedTail,
    });
  }

  // Fallback append: any fetched table that was never cited by a marker still
  // appears at the end of the message. Preserves forgiving UX if the model
  // fetched but forgot to cite.
  tableParts.forEach((part, index) => {
    if (part.output.tableId && referencedTableIds.has(part.output.tableId)) return;
    blocks.push({
      kind: "table",
      key: `${message.id}-table-fallback-${part.toolCallId ?? index}`,
      part,
    });
  });

  return blocks;
}

// Exported for prompt-time reference and for claim-check's marker-injection.
export function buildAnalysisRenderMarker(tableId: string): string {
  return `[[render tableId=${tableId}]]`;
}

export interface AnalysisRenderMarkerOccurrence {
  tableId: string;
  raw: string;
}

export function extractAnalysisRenderMarkers(text: string): AnalysisRenderMarkerOccurrence[] {
  const markers: AnalysisRenderMarkerOccurrence[] = [];
  const re = new RegExp(RENDER_MARKER_BODY_SOURCE, "g");
  let match: RegExpExecArray | null = re.exec(text);
  while (match) {
    const tableId = matchedTableId(match);
    if (tableId) markers.push({ tableId, raw: match[0] });
    match = re.exec(text);
  }
  return markers;
}

export type AnalysisRenderMarkerInvalidReason =
  | "not_fetched_this_turn"
  | "not_in_run";

export interface AnalysisRenderMarkerValidationIssue {
  tableId: string;
  raw: string;
  reason: AnalysisRenderMarkerInvalidReason;
}

// Validate that every `[[render tableId=X]]` marker in the assistant text
// points at a table that (a) exists in the run's catalog, and (b) was
// fetched this turn via fetchTable. Unmet → the model emitted a marker
// without grounding; callers can surface this as an error to the model
// (for a repair pass) or strip the marker before rendering.
export function validateAnalysisRenderMarkers(params: {
  text: string;
  fetchedTableIds: Iterable<string>;
  catalogTableIds: Iterable<string>;
}): AnalysisRenderMarkerValidationIssue[] {
  const fetched = new Set(params.fetchedTableIds);
  const catalog = new Set(params.catalogTableIds);
  const markers = extractAnalysisRenderMarkers(params.text);

  const issues: AnalysisRenderMarkerValidationIssue[] = [];
  for (const marker of markers) {
    if (!catalog.has(marker.tableId)) {
      issues.push({ tableId: marker.tableId, raw: marker.raw, reason: "not_in_run" });
      continue;
    }
    if (!fetched.has(marker.tableId)) {
      issues.push({ tableId: marker.tableId, raw: marker.raw, reason: "not_fetched_this_turn" });
    }
  }
  return issues;
}

export function stripInvalidAnalysisRenderMarkers(
  text: string,
  issues: AnalysisRenderMarkerValidationIssue[],
): string {
  if (issues.length === 0) return text;
  const rawValues = new Set(issues.map((issue) => issue.raw));

  const stripped = text.replace(RENDER_MARKER_GLOBAL_RE, (match) => {
    return rawValues.has(match) ? "" : match;
  });
  // Markers often sit on their own line surrounded by blank lines; removing
  // the marker leaves extra blank lines. Collapse runs of 3+ newlines back
  // to a clean paragraph break, then trim trailing whitespace on each line.
  return stripped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
