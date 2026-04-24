import { promises as fs } from "fs";
import path from "path";
import {
  isReasoningUIPart,
  isToolUIPart,
  type UIMessage,
} from "ai";

import { isAnalysisTableCard } from "@/lib/analysis/types";
import { isPathInsideOutputsBase } from "@/lib/paths/outputs";
import { uploadRunOutputArtifact } from "@/lib/r2/R2FileManager";
import type { RetryClassification } from "@/lib/retryWithPolicyHandling";
import { parseRunResult } from "@/schemas/runResultSchema";

const TRACE_VERSION = 1;
const TRACE_DIR_SEGMENTS = ["agents", "analysis"] as const;
const TRACE_TEXT_LIMIT = 8_000;
const TRACE_VALUE_STRING_LIMIT = 1_000;
const TRACE_VALUE_ARRAY_LIMIT = 20;
const TRACE_VALUE_OBJECT_LIMIT = 30;
const TRACE_VALUE_MAX_DEPTH = 4;
const TRUNCATED_MARKER = "[TRUNCATED]";

export interface AnalysisTraceRetryEvent {
  attempt: number;
  maxAttempts: number;
  nextDelayMs: number;
  lastClassification: RetryClassification;
  lastErrorSummary: string;
  shouldUsePolicySafeVariant: boolean;
  possibleTruncation: boolean;
}

export interface AnalysisTraceUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  nonCachedInputTokens?: number;
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  durationMs: number;
  estimatedCostUsd: number;
}

export interface AnalysisTraceCapture {
  usage: AnalysisTraceUsage;
  retryEvents: AnalysisTraceRetryEvent[];
  retryAttempts: number;
  finalClassification: RetryClassification | null;
  terminalError: string | null;
}

export interface AnalysisToolTraceEntry {
  toolName: string;
  toolCallId: string | null;
  state: string | null;
  inputPreview: unknown;
  outputPreview: unknown;
}

export interface AnalysisTurnTrace {
  version: number;
  kind: "success";
  runId: string;
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  messageId: string;
  createdAt: string;
  assistantText: string;
  reasoningParts: string[];
  toolTimeline: AnalysisToolTraceEntry[];
  retrySummary: {
    totalAttempts: number;
    finalClassification: RetryClassification | null;
    terminalError: string | null;
    events: AnalysisTraceRetryEvent[];
  };
  usage: AnalysisTraceUsage;
}

export interface AnalysisTurnErrorTrace {
  version: number;
  kind: "error";
  runId: string;
  projectId: string;
  sessionId: string;
  sessionTitle: string;
  createdAt: string;
  latestUserPrompt: string;
  retrySummary: {
    totalAttempts: number;
    finalClassification: RetryClassification | null;
    terminalError: string | null;
    events: AnalysisTraceRetryEvent[];
  };
  errorMessage: string;
  usage: AnalysisTraceUsage;
}

export interface AnalysisTurnTraceIndexEntry {
  path: string;
  kind: "success" | "error";
  createdAt: string;
  messageId: string | null;
}

export interface AnalysisTurnTraceIndexSession {
  sessionId: string;
  sessionTitle: string;
  updatedAt: string;
  turns: AnalysisTurnTraceIndexEntry[];
}

export interface AnalysisTurnTraceIndex {
  version: number;
  updatedAt: string;
  runId: string;
  sessions: AnalysisTurnTraceIndexSession[];
}

interface TracePersistenceContext {
  outputDir: string;
  orgId?: string;
  projectId?: string;
  runId?: string;
}

interface WriteTraceBaseArgs {
  runResultValue: unknown;
  orgId?: string;
  projectId: string;
  runId: string;
  sessionId: string;
  sessionTitle: string;
}

export interface WriteAnalysisTurnTraceArgs extends WriteTraceBaseArgs {
  messageId: string;
  createdAt: string;
  assistantText: string;
  responseParts: UIMessage["parts"];
  traceCapture: AnalysisTraceCapture;
}

export interface WriteAnalysisTurnErrorTraceArgs extends WriteTraceBaseArgs {
  createdAt: string;
  latestUserPrompt: string;
  errorMessage: string;
  traceCapture: AnalysisTraceCapture;
}

function safeFileSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

function toPosixRelativePath(filePath: string, baseDir: string): string {
  return path.relative(baseDir, filePath).split(path.sep).join("/");
}

function sanitizeLongText(value: string, maxLength = TRACE_TEXT_LIMIT): string {
  const cleaned = value.replace(/[<>]/g, "");
  if (cleaned.length <= maxLength) return cleaned;
  return `${cleaned.slice(0, Math.max(0, maxLength - (TRUNCATED_MARKER.length + 1)))} ${TRUNCATED_MARKER}`;
}

function sanitizeStringForTrace(value: string): string {
  const cleaned = value.replace(/[<>]/g, "");
  if (cleaned.length <= TRACE_VALUE_STRING_LIMIT) return cleaned;
  return `${cleaned.slice(0, Math.max(0, TRACE_VALUE_STRING_LIMIT - (TRUNCATED_MARKER.length + 1)))} ${TRUNCATED_MARKER}`;
}

export function sanitizeForTrace(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === "string") return sanitizeStringForTrace(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= TRACE_VALUE_MAX_DEPTH) {
    return TRUNCATED_MARKER;
  }

  if (Array.isArray(value)) {
    const sanitized = value
      .slice(0, TRACE_VALUE_ARRAY_LIMIT)
      .map((item) => sanitizeForTrace(item, depth + 1));
    if (value.length > TRACE_VALUE_ARRAY_LIMIT) {
      sanitized.push(TRUNCATED_MARKER);
    }
    return sanitized;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const sanitizedEntries = entries
      .slice(0, TRACE_VALUE_OBJECT_LIMIT)
      .map(([key, entryValue]) => [key, sanitizeForTrace(entryValue, depth + 1)] as const);

    if (entries.length > TRACE_VALUE_OBJECT_LIMIT) {
      sanitizedEntries.push(["__truncated__", TRUNCATED_MARKER]);
    }

    return Object.fromEntries(sanitizedEntries);
  }

  return sanitizeStringForTrace(String(value));
}

function getTableCardPreview(output: unknown): unknown {
  if (!isAnalysisTableCard(output)) {
    return sanitizeForTrace(output);
  }

  return {
    status: output.status,
    tableId: output.tableId,
    questionId: output.questionId,
    title: output.title,
    totalRows: output.totalRows,
    totalColumns: output.totalColumns,
    truncatedRows: output.truncatedRows,
    truncatedColumns: output.truncatedColumns,
    valueMode: output.valueMode,
  };
}

export function serializeAnalysisToolTimeline(parts: UIMessage["parts"]): AnalysisToolTraceEntry[] {
  return parts.flatMap((part) => {
    if (!isToolUIPart(part)) return [];

    return [{
      toolName: part.type,
      toolCallId: part.toolCallId ?? null,
      state: part.state ?? null,
      inputPreview: sanitizeForTrace("input" in part ? part.input : null),
      outputPreview: part.type === "tool-fetchTable"
        ? getTableCardPreview("output" in part ? part.output : null)
        : sanitizeForTrace("output" in part ? part.output : null),
    }];
  });
}

function collectReasoningParts(parts: UIMessage["parts"]): string[] {
  return parts.flatMap((part) => {
    if (!isReasoningUIPart(part) || !part.text) return [];
    return [sanitizeLongText(part.text)];
  });
}

function buildTracePersistenceContext(args: WriteTraceBaseArgs): TracePersistenceContext | null {
  const outputDir = parseRunResult(args.runResultValue)?.outputDir;
  if (!outputDir || !isPathInsideOutputsBase(outputDir)) {
    return null;
  }

  return {
    outputDir,
    orgId: args.orgId,
    projectId: args.projectId,
    runId: args.runId,
  };
}

function buildSessionDir(outputDir: string, sessionId: string): string {
  return path.join(outputDir, ...TRACE_DIR_SEGMENTS, "sessions", safeFileSegment(sessionId));
}

function buildIndexPath(outputDir: string): string {
  return path.join(outputDir, ...TRACE_DIR_SEGMENTS, "index.json");
}

async function readTraceIndex(indexPath: string, runId: string): Promise<AnalysisTurnTraceIndex> {
  try {
    const raw = JSON.parse(await fs.readFile(indexPath, "utf-8")) as AnalysisTurnTraceIndex;
    if (raw && raw.version === TRACE_VERSION && raw.runId === runId && Array.isArray(raw.sessions)) {
      return raw;
    }
  } catch {
    // Ignore invalid or missing index files and recreate them.
  }

  return {
    version: TRACE_VERSION,
    updatedAt: new Date(0).toISOString(),
    runId,
    sessions: [],
  };
}

export async function updateAnalysisTraceIndex(args: {
  outputDir: string;
  runId: string;
  sessionId: string;
  sessionTitle: string;
  createdAt: string;
  relativePath: string;
  kind: "success" | "error";
  messageId: string | null;
}): Promise<AnalysisTurnTraceIndex> {
  const indexPath = buildIndexPath(args.outputDir);
  await fs.mkdir(path.dirname(indexPath), { recursive: true });

  const current = await readTraceIndex(indexPath, args.runId);
  const nextSessions = [...current.sessions];
  const sessionIndex = nextSessions.findIndex((session) => session.sessionId === args.sessionId);
  const nextEntry: AnalysisTurnTraceIndexEntry = {
    path: args.relativePath,
    kind: args.kind,
    createdAt: args.createdAt,
    messageId: args.messageId,
  };

  if (sessionIndex >= 0) {
    const existing = nextSessions[sessionIndex];
    const turns = [...existing.turns.filter((turn) => turn.path !== args.relativePath), nextEntry]
      .sort((left, right) => {
        if (left.createdAt === right.createdAt) {
          return left.path.localeCompare(right.path);
        }
        return left.createdAt.localeCompare(right.createdAt);
      });

    nextSessions[sessionIndex] = {
      sessionId: existing.sessionId,
      sessionTitle: args.sessionTitle,
      updatedAt: args.createdAt,
      turns,
    };
  } else {
    nextSessions.push({
      sessionId: args.sessionId,
      sessionTitle: args.sessionTitle,
      updatedAt: args.createdAt,
      turns: [nextEntry],
    });
  }

  nextSessions.sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  const nextIndex: AnalysisTurnTraceIndex = {
    version: TRACE_VERSION,
    updatedAt: args.createdAt,
    runId: args.runId,
    sessions: nextSessions,
  };

  await fs.writeFile(indexPath, JSON.stringify(nextIndex, null, 2), "utf-8");
  return nextIndex;
}

async function uploadTraceArtifacts(args: {
  context: TracePersistenceContext;
  relativeTracePath: string;
  traceBody: string;
  indexBody: string;
}): Promise<void> {
  if (!args.context.orgId || !args.context.projectId || !args.context.runId) return;

  try {
    await uploadRunOutputArtifact({
      orgId: args.context.orgId,
      projectId: args.context.projectId,
      runId: args.context.runId,
      relativePath: args.relativeTracePath,
      body: args.traceBody,
      contentType: "application/json",
    });
  } catch (error) {
    console.warn("[AnalysisTrace] Failed to upload trace artifact:", error);
  }

  try {
    await uploadRunOutputArtifact({
      orgId: args.context.orgId,
      projectId: args.context.projectId,
      runId: args.context.runId,
      relativePath: path.posix.join(...TRACE_DIR_SEGMENTS, "index.json"),
      body: args.indexBody,
      contentType: "application/json",
    });
  } catch (error) {
    console.warn("[AnalysisTrace] Failed to upload trace index:", error);
  }
}

export async function writeAnalysisTurnTrace(
  args: WriteAnalysisTurnTraceArgs,
): Promise<string | null> {
  const context = buildTracePersistenceContext(args);
  if (!context) return null;

  const trace: AnalysisTurnTrace = {
    version: TRACE_VERSION,
    kind: "success",
    runId: args.runId,
    projectId: args.projectId,
    sessionId: args.sessionId,
    sessionTitle: args.sessionTitle,
    messageId: args.messageId,
    createdAt: args.createdAt,
    assistantText: sanitizeLongText(args.assistantText),
    reasoningParts: collectReasoningParts(args.responseParts),
    toolTimeline: serializeAnalysisToolTimeline(args.responseParts),
    retrySummary: {
      totalAttempts: args.traceCapture.retryAttempts,
      finalClassification: args.traceCapture.finalClassification,
      terminalError: args.traceCapture.terminalError,
      events: args.traceCapture.retryEvents,
    },
    usage: args.traceCapture.usage,
  };

  const sessionDir = buildSessionDir(context.outputDir, args.sessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  const fileName = `turn-${Date.parse(args.createdAt)}-${safeFileSegment(args.messageId)}.json`;
  const tracePath = path.join(sessionDir, fileName);
  const traceBody = JSON.stringify(trace, null, 2);
  await fs.writeFile(tracePath, traceBody, "utf-8");

  const relativeTracePath = toPosixRelativePath(tracePath, context.outputDir);
  const nextIndex = await updateAnalysisTraceIndex({
    outputDir: context.outputDir,
    runId: args.runId,
    sessionId: args.sessionId,
    sessionTitle: args.sessionTitle,
    createdAt: args.createdAt,
    relativePath: relativeTracePath,
    kind: "success",
    messageId: args.messageId,
  });

  await uploadTraceArtifacts({
    context,
    relativeTracePath,
    traceBody,
    indexBody: JSON.stringify(nextIndex, null, 2),
  });

  return relativeTracePath;
}

export async function writeAnalysisTurnErrorTrace(
  args: WriteAnalysisTurnErrorTraceArgs,
): Promise<string | null> {
  const context = buildTracePersistenceContext(args);
  if (!context) return null;

  const trace: AnalysisTurnErrorTrace = {
    version: TRACE_VERSION,
    kind: "error",
    runId: args.runId,
    projectId: args.projectId,
    sessionId: args.sessionId,
    sessionTitle: args.sessionTitle,
    createdAt: args.createdAt,
    latestUserPrompt: sanitizeLongText(args.latestUserPrompt),
    retrySummary: {
      totalAttempts: args.traceCapture.retryAttempts,
      finalClassification: args.traceCapture.finalClassification,
      terminalError: args.traceCapture.terminalError,
      events: args.traceCapture.retryEvents,
    },
    errorMessage: sanitizeLongText(args.errorMessage),
    usage: args.traceCapture.usage,
  };

  const sessionDir = buildSessionDir(context.outputDir, args.sessionId);
  await fs.mkdir(sessionDir, { recursive: true });

  const fileName = `turn-error-${Date.parse(args.createdAt)}.json`;
  const tracePath = path.join(sessionDir, fileName);
  const traceBody = JSON.stringify(trace, null, 2);
  await fs.writeFile(tracePath, traceBody, "utf-8");

  const relativeTracePath = toPosixRelativePath(tracePath, context.outputDir);
  const nextIndex = await updateAnalysisTraceIndex({
    outputDir: context.outputDir,
    runId: args.runId,
    sessionId: args.sessionId,
    sessionTitle: args.sessionTitle,
    createdAt: args.createdAt,
    relativePath: relativeTracePath,
    kind: "error",
    messageId: null,
  });

  await uploadTraceArtifacts({
    context,
    relativeTracePath,
    traceBody,
    indexBody: JSON.stringify(nextIndex, null, 2),
  });

  return relativeTracePath;
}
