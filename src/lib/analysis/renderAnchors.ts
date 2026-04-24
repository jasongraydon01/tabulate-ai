import { isTextUIPart, isToolUIPart, type UIMessage } from "ai";

import {
  isAnalysisTableCard,
  type AnalysisFetchTableCutGroups,
  type AnalysisTableCard,
} from "@/lib/analysis/types";

const RENDER_MARKER_PARAM_RE = /([a-zA-Z][a-zA-Z0-9]*)=((?:\[[^\]]*\])|"(?:[^"\\]|\\.)*"|[A-Za-z0-9_.:-]+)/g;
const MAX_RENDER_ROW_FOCUS = 5;
const MAX_RENDER_GROUP_FOCUS = 3;
const TOTAL_GROUP_KEY = "__total__";
const RENDER_MARKER_PREFIX = "[[render";

type FetchTableUIPart = UIMessage["parts"][number] & {
  type: "tool-fetchTable";
  toolCallId: string;
  state: "output-available";
  input?: {
    tableId?: string;
    cutGroups?: AnalysisFetchTableCutGroups | null;
  };
  output: AnalysisTableCard;
};

export interface AnalysisRenderFocus {
  focusedRowKeys: string[];
  focusedGroupKeys: string[];
}

export type AnalysisRenderableBlock =
  | { kind: "text"; key: string; text: string }
  | { kind: "placeholder"; key: string }
  | { kind: "missing"; key: string; tableId: string }
  | { kind: "table"; key: string; part: FetchTableUIPart; focus: AnalysisRenderFocus };

interface ParsedRenderMarker {
  tableId: string;
  rowLabels: string[];
  rowRefs: string[];
  groupNames: string[];
  groupRefs: string[];
  raw: string;
}

interface ParsedRenderMarkerOccurrence extends ParsedRenderMarker {
  start: number;
  end: number;
}

function normalizeRenderableText(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMarkerListValue(rawValue: string): string[] {
  const value = rawValue.trim();
  if (!value) return [];

  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter((entry, index, values) => entry.length > 0 && values.indexOf(entry) === index);
    } catch {
      return [];
    }
  }

  if (value.startsWith("\"") && value.endsWith("\"")) {
    try {
      const parsed = JSON.parse(value) as string;
      return parsed.trim().length > 0 ? [parsed.trim()] : [];
    } catch {
      return [];
    }
  }

  return value.trim().length > 0 ? [value.trim()] : [];
}

function parseRenderMarker(match: RegExpExecArray): ParsedRenderMarker | null {
  const raw = match[0];
  const body = (match[1] ?? "").trim();
  if (!body) return null;

  const params = new Map<string, string[]>();
  let paramMatch: RegExpExecArray | null = RENDER_MARKER_PARAM_RE.exec(body);
  while (paramMatch) {
    const key = paramMatch[1]!;
    const values = parseMarkerListValue(paramMatch[2] ?? "");
    if (values.length > 0) {
      const existing = params.get(key) ?? [];
      params.set(
        key,
        [...existing, ...values].filter((value, index, all) => all.indexOf(value) === index),
      );
    }
    paramMatch = RENDER_MARKER_PARAM_RE.exec(body);
  }
  RENDER_MARKER_PARAM_RE.lastIndex = 0;

  const tableId = (params.get("tableId") ?? [])[0] ?? "";
  if (!tableId) return null;

  return {
    tableId,
    rowLabels: params.get("rowLabels") ?? [],
    rowRefs: params.get("rowRefs") ?? [],
    groupNames: params.get("groupNames") ?? [],
    groupRefs: params.get("groupRefs") ?? [],
    raw,
  };
}

function extractParsedRenderMarkerOccurrences(text: string): ParsedRenderMarkerOccurrence[] {
  const markers: ParsedRenderMarkerOccurrence[] = [];

  for (let searchIndex = 0; searchIndex < text.length;) {
    const markerStart = text.indexOf(RENDER_MARKER_PREFIX, searchIndex);
    if (markerStart === -1) break;

    const bodyStart = markerStart + RENDER_MARKER_PREFIX.length;
    if (!/\s/.test(text[bodyStart] ?? "")) {
      searchIndex = markerStart + RENDER_MARKER_PREFIX.length;
      continue;
    }

    let inQuotes = false;
    let arrayDepth = 0;
    let isEscaped = false;
    let markerEnd = -1;

    for (let index = bodyStart; index < text.length - 1; index += 1) {
      const char = text[index]!;
      const next = text[index + 1]!;

      if (isEscaped) {
        isEscaped = false;
        continue;
      }

      if (char === "\\") {
        isEscaped = true;
        continue;
      }

      if (char === "\"") {
        inQuotes = !inQuotes;
        continue;
      }

      if (inQuotes) continue;

      if (char === "[") {
        arrayDepth += 1;
        continue;
      }

      if (char === "]" && arrayDepth > 0) {
        arrayDepth -= 1;
        continue;
      }

      if (char === "]" && next === "]" && arrayDepth === 0) {
        markerEnd = index + 2;
        break;
      }
    }

    if (markerEnd === -1) {
      searchIndex = markerStart + RENDER_MARKER_PREFIX.length;
      continue;
    }

    const raw = text.slice(markerStart, markerEnd);
    const body = text.slice(bodyStart, markerEnd - 2).trim();
    const marker = parseRenderMarker([raw, body] as unknown as RegExpExecArray);
    if (marker) {
      markers.push({
        ...marker,
        start: markerStart,
        end: markerEnd,
      });
    }

    searchIndex = markerEnd;
  }

  return markers;
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

  return parts.flatMap((part) => (isFetchTableUIPart(part) ? [part] : []));
}

function buildTableIdMap(parts: FetchTableUIPart[]): Map<string, FetchTableUIPart> {
  const map = new Map<string, FetchTableUIPart>();
  for (const part of parts) {
    if (part.output.tableId) {
      map.set(part.output.tableId, part);
    }
  }
  return map;
}

function getFetchedGroupKeys(part: FetchTableUIPart): Set<string> {
  const groups = (part.output.columnGroups ?? []).filter((group) => group.groupKey !== TOTAL_GROUP_KEY);
  const requestedCutGroups = part.input?.cutGroups;
  if (requestedCutGroups === "*") {
    return new Set(groups.map((group) => group.groupKey));
  }

  const requested = new Set(
    (Array.isArray(requestedCutGroups) ? requestedCutGroups : [])
      .map((groupName) => normalizeText(groupName)),
  );

  return new Set(
    groups
      .filter((group) => requested.has(normalizeText(group.groupName)))
      .map((group) => group.groupKey),
  );
}

function resolveRenderFocus(part: FetchTableUIPart, marker: ParsedRenderMarker): AnalysisRenderFocus {
  const focusedRowKeys: string[] = [];
  const focusedGroupKeys: string[] = [];
  const rows = part.output.rows;
  const groups = (part.output.columnGroups ?? []).filter((group) => group.groupKey !== TOTAL_GROUP_KEY);
  const fetchedGroupKeys = getFetchedGroupKeys(part);

  for (const rowLabel of marker.rowLabels) {
    if (focusedRowKeys.length >= MAX_RENDER_ROW_FOCUS) break;
    const matches = rows.filter((row) => normalizeText(row.label) === normalizeText(rowLabel));
    if (matches.length !== 1) continue;
    const rowKey = matches[0]!.rowKey;
    if (!focusedRowKeys.includes(rowKey)) {
      focusedRowKeys.push(rowKey);
    }
  }

  for (const rowRef of marker.rowRefs) {
    if (focusedRowKeys.length >= MAX_RENDER_ROW_FOCUS) break;
    if (!rows.some((row) => row.rowKey === rowRef)) continue;
    if (!focusedRowKeys.includes(rowRef)) {
      focusedRowKeys.push(rowRef);
    }
  }

  for (const groupName of marker.groupNames) {
    if (focusedGroupKeys.length >= MAX_RENDER_GROUP_FOCUS) break;
    const matches = groups.filter((group) => normalizeText(group.groupName) === normalizeText(groupName));
    if (matches.length !== 1) continue;
    const groupKey = matches[0]!.groupKey;
    if (!fetchedGroupKeys.has(groupKey) || focusedGroupKeys.includes(groupKey)) continue;
    focusedGroupKeys.push(groupKey);
  }

  for (const groupRef of marker.groupRefs) {
    if (focusedGroupKeys.length >= MAX_RENDER_GROUP_FOCUS) break;
    if (!groups.some((group) => group.groupKey === groupRef)) continue;
    if (!fetchedGroupKeys.has(groupRef) || focusedGroupKeys.includes(groupRef)) continue;
    focusedGroupKeys.push(groupRef);
  }

  return {
    focusedRowKeys,
    focusedGroupKeys,
  };
}

function extractParsedRenderMarkers(text: string): ParsedRenderMarker[] {
  return extractParsedRenderMarkerOccurrences(text);
}

export function stripAnalysisRenderAnchors(text: string): string {
  const markers = extractParsedRenderMarkerOccurrences(text);
  if (markers.length === 0) {
    return normalizeRenderableText(text);
  }

  let output = "";
  let cursor = 0;
  for (const marker of markers) {
    output += text.slice(cursor, marker.start);
    output += "\n\n";
    cursor = marker.end;
  }
  output += text.slice(cursor);

  return normalizeRenderableText(output);
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

  const markers = extractParsedRenderMarkerOccurrences(text);

  const referencedTableIds = new Set(markers.map((marker) => marker.tableId));

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
        focus: { focusedRowKeys: [], focusedGroupKeys: [] },
      });
    });
    return blocks;
  }

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
        focus: resolveRenderFocus(part, marker),
      });
    } else if (options?.isStreaming) {
      blocks.push({ kind: "placeholder", key: `${message.id}-placeholder-${index}` });
    } else {
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

  tableParts.forEach((part, index) => {
    if (part.output.tableId && referencedTableIds.has(part.output.tableId)) return;
    blocks.push({
      kind: "table",
      key: `${message.id}-table-fallback-${part.toolCallId ?? index}`,
      part,
      focus: { focusedRowKeys: [], focusedGroupKeys: [] },
    });
  });

  return blocks;
}

export function buildAnalysisRenderMarker(
  tableId: string,
  options?: {
    rowLabels?: string[];
    rowRefs?: string[];
    groupNames?: string[];
    groupRefs?: string[];
  },
): string {
  const params = [`tableId=${tableId}`];

  if (options?.rowLabels && options.rowLabels.length > 0) {
    params.push(`rowLabels=${JSON.stringify(options.rowLabels.slice(0, MAX_RENDER_ROW_FOCUS))}`);
  }
  if (options?.rowRefs && options.rowRefs.length > 0) {
    params.push(`rowRefs=${JSON.stringify(options.rowRefs.slice(0, MAX_RENDER_ROW_FOCUS))}`);
  }
  if (options?.groupNames && options.groupNames.length > 0) {
    params.push(`groupNames=${JSON.stringify(options.groupNames.slice(0, MAX_RENDER_GROUP_FOCUS))}`);
  }
  if (options?.groupRefs && options.groupRefs.length > 0) {
    params.push(`groupRefs=${JSON.stringify(options.groupRefs.slice(0, MAX_RENDER_GROUP_FOCUS))}`);
  }

  return `[[render ${params.join(" ")}]]`;
}

export interface AnalysisRenderMarkerOccurrence {
  tableId: string;
  raw: string;
}

export function extractAnalysisRenderMarkers(text: string): AnalysisRenderMarkerOccurrence[] {
  return extractParsedRenderMarkers(text).map((marker) => ({
    tableId: marker.tableId,
    raw: marker.raw,
  }));
}

export type AnalysisRenderMarkerInvalidReason =
  | "not_fetched_this_turn"
  | "not_in_run";

export interface AnalysisRenderMarkerValidationIssue {
  tableId: string;
  raw: string;
  reason: AnalysisRenderMarkerInvalidReason;
}

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
  const markers = extractParsedRenderMarkerOccurrences(text);
  if (markers.length === 0) return text;

  let stripped = "";
  let cursor = 0;
  for (const marker of markers) {
    stripped += text.slice(cursor, marker.start);
    stripped += rawValues.has(marker.raw) ? "" : marker.raw;
    cursor = marker.end;
  }
  stripped += text.slice(cursor);

  return stripped
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
