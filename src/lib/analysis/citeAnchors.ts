// End-of-sentence citation marker. Grammar:
//   [[cite cellIds=<id1>,<id2>,...]]   (unquoted; ids are URI-encoded
//                                       composites, so only ASCII-safe chars)
//   [[cite cellIds="<id1>,<id2>,...]]   (quoted; permissive body)
//   [[cite cellId=<id>]]               (singular alias; same parsing)
//
// Each cellId is `encodeURIComponent(tableId)|encodeURIComponent(rowKey)|
// encodeURIComponent(cutKey)|<valueMode>` as produced by
// `buildAnalysisCellId` in `@/lib/analysis/types`.
//
// This module is a sibling to renderAnchors.ts and deliberately kept disjoint
// — one parser change must not regress the other.

const CITE_MARKER_UNQUOTED_BODY = "[A-Za-z0-9_.%\\-~|,]";
const CITE_MARKER_QUOTED_BODY = "[^\"\\]]";

const CITE_MARKER_BODY_SOURCE =
  `\\[\\[cite\\s+cellIds?=(?:"(${CITE_MARKER_QUOTED_BODY}{1,4000})"|(${CITE_MARKER_UNQUOTED_BODY}{1,4000}))\\s*\\]\\]`;

const CITE_MARKER_GLOBAL_RE = new RegExp(CITE_MARKER_BODY_SOURCE, "g");

function normalizeCiteText(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function matchedMarkerBody(match: RegExpExecArray): string {
  return (match[1] ?? match[2] ?? "").trim();
}

function parseCellIdsFromBody(body: string): string[] {
  return body
    .split(",")
    .map((id) => id.trim())
    .filter((id) => id.length > 0);
}

export function buildAnalysisCiteMarker(cellIds: string[]): string {
  return `[[cite cellIds=${cellIds.join(",")}]]`;
}

export interface AnalysisCiteMarkerOccurrence {
  cellIds: string[];
  raw: string;
  start: number;
  end: number;
}

export function extractAnalysisCiteMarkers(text: string): AnalysisCiteMarkerOccurrence[] {
  const occurrences: AnalysisCiteMarkerOccurrence[] = [];
  const re = new RegExp(CITE_MARKER_BODY_SOURCE, "g");
  let match: RegExpExecArray | null = re.exec(text);
  while (match) {
    const body = matchedMarkerBody(match);
    const cellIds = parseCellIdsFromBody(body);
    occurrences.push({
      cellIds,
      raw: match[0],
      start: match.index,
      end: re.lastIndex,
    });
    match = re.exec(text);
  }
  return occurrences;
}

export function stripAnalysisCiteAnchors(text: string): string {
  return normalizeCiteText(text.replace(CITE_MARKER_GLOBAL_RE, ""));
}

export type AnalysisCiteMarkerInvalidReason =
  | "not_confirmed_this_turn"
  | "empty"
  | "partial_unconfirmed";

export interface AnalysisCiteMarkerValidationIssue {
  raw: string;
  reason: AnalysisCiteMarkerInvalidReason;
  cellIds: string[];
  unconfirmedCellIds: string[];
}

export function validateAnalysisCiteMarkers(params: {
  text: string;
  confirmedCellIds: Iterable<string>;
}): AnalysisCiteMarkerValidationIssue[] {
  const confirmed = new Set(params.confirmedCellIds);
  const markers = extractAnalysisCiteMarkers(params.text);

  const issues: AnalysisCiteMarkerValidationIssue[] = [];
  for (const marker of markers) {
    if (marker.cellIds.length === 0) {
      issues.push({
        raw: marker.raw,
        reason: "empty",
        cellIds: [],
        unconfirmedCellIds: [],
      });
      continue;
    }

    const unconfirmed = marker.cellIds.filter((id) => !confirmed.has(id));
    if (unconfirmed.length === 0) continue;

    if (unconfirmed.length === marker.cellIds.length) {
      issues.push({
        raw: marker.raw,
        reason: "not_confirmed_this_turn",
        cellIds: marker.cellIds,
        unconfirmedCellIds: unconfirmed,
      });
    } else {
      issues.push({
        raw: marker.raw,
        reason: "partial_unconfirmed",
        cellIds: marker.cellIds,
        unconfirmedCellIds: unconfirmed,
      });
    }
  }

  return issues;
}

export function stripInvalidAnalysisCiteMarkers(
  text: string,
  issues: AnalysisCiteMarkerValidationIssue[],
): string {
  if (issues.length === 0) return text;
  const rawValues = new Set(issues.map((issue) => issue.raw));

  const stripped = text.replace(CITE_MARKER_GLOBAL_RE, (match) => {
    return rawValues.has(match) ? "" : match;
  });

  return stripped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// One-based counter used as the numbered chip badge. Markers are numbered
// deterministically left-to-right over unique marker positions so `1` always
// refers to the first marker in the message.
export type AnalysisCiteSegment =
  | { kind: "text"; text: string }
  | { kind: "cite"; cellIds: string[]; raw: string; indexWithinMessage: number };

export function buildAnalysisCiteSegments(text: string): AnalysisCiteSegment[] {
  const markers = extractAnalysisCiteMarkers(text);
  if (markers.length === 0) {
    const trimmed = text;
    return trimmed.length > 0 ? [{ kind: "text", text: trimmed }] : [];
  }

  const segments: AnalysisCiteSegment[] = [];
  let cursor = 0;

  markers.forEach((marker, index) => {
    if (marker.start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, marker.start) });
    }
    segments.push({
      kind: "cite",
      cellIds: marker.cellIds,
      raw: marker.raw,
      indexWithinMessage: index + 1,
    });
    cursor = marker.end;
  });

  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }

  return segments;
}
