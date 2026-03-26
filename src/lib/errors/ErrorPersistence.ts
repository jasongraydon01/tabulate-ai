import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';

import {
  PipelineErrorRecordSchema,
  type PipelineErrorActionTaken,
  type PipelineErrorClassification,
  type PipelineErrorRecord,
  type PipelineErrorSeverity,
  type PipelineErrorSource,
} from '../../schemas/pipelineErrorSchema';

import { isPolicyError, isRateLimitError } from '../retryWithPolicyHandling';

// =============================================================================
// Paths
// =============================================================================

export function getErrorsDir(outputDir: string): string {
  return path.join(outputDir, 'errors');
}

export function getErrorsLogPath(outputDir: string): string {
  return path.join(getErrorsDir(outputDir), 'errors.ndjson');
}

export function getErrorsArchiveDir(outputDir: string): string {
  return path.join(getErrorsDir(outputDir), 'archive');
}

export function getGlobalSystemOutputDir(): string {
  // Used when we don't have a pipeline output dir yet (early failures).
  return path.join(process.cwd(), 'outputs', '_system', 'pipeline-global');
}

export function inferRunIdentityFromOutputDir(outputDir: string): { dataset: string; pipelineId: string } {
  // Expected: outputs/<dataset>/<pipelineId>
  try {
    const rel = path.relative(process.cwd(), outputDir);
    const parts = rel.split(path.sep).filter(Boolean);
    const outputsIdx = parts.indexOf('outputs');
    if (outputsIdx >= 0 && parts.length >= outputsIdx + 3) {
      const dataset = parts[outputsIdx + 1] || '';
      const pipelineId = parts[outputsIdx + 2] || '';
      return { dataset, pipelineId };
    }
  } catch {
    // ignore
  }
  return { dataset: '', pipelineId: '' };
}

// =============================================================================
// Write serialization (avoid concurrent append interleaving)
// =============================================================================

const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(key: string, fn: () => Promise<void>): Promise<void> {
  const prev = writeQueues.get(key) || Promise.resolve();
  const next = prev
    .catch(() => {
      // Swallow previous write failures so later writes can still proceed.
    })
    .then(fn)
    .finally(() => {
      // Prevent unbounded map growth (best-effort).
      if (writeQueues.get(key) === next) {
        writeQueues.delete(key);
      }
    });

  writeQueues.set(key, next);
  return next;
}

// =============================================================================
// Record assembly
// =============================================================================

function toErrorParts(error: unknown): { name: string; message: string; stack: string } {
  if (error instanceof Error) {
    return {
      name: error.name || 'Error',
      message: error.message || String(error),
      stack: error.stack || '',
    };
  }
  return { name: 'UnknownError', message: String(error), stack: '' };
}

function safeMeta(meta: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!meta) return {};
  try {
    // Ensure JSON-serializable by forcing a roundtrip.
    return JSON.parse(JSON.stringify(meta)) as Record<string, unknown>;
  } catch {
    return { meta: String(meta) };
  }
}

export function classifyErrorForPersistence(error: unknown): PipelineErrorClassification {
  if (isRateLimitError(error)) return 'rate_limit';
  if (isPolicyError(error)) return 'policy';

  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (
    msg.includes('invalid output') ||
    msg.includes('typevalidationerror') ||
    msg.includes('no object generated') ||
    msg.includes('jsonparseerror')
  ) {
    return 'output_validation';
  }

  if (
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('502') ||
    msg.includes('503') ||
    msg.includes('504') ||
    msg.includes('service unavailable') ||
    msg.includes('gateway timeout')
  ) {
    return 'transient';
  }

  return 'unknown';
}

export function buildPipelineErrorRecord(args: {
  dataset: string;
  pipelineId: string;
  outputDir: string;
  source: PipelineErrorSource;
  agentName?: string;
  stageNumber?: number;
  stageName?: string;
  itemId?: string;
  severity?: PipelineErrorSeverity;
  classification?: PipelineErrorClassification;
  actionTaken?: PipelineErrorActionTaken;
  error: unknown;
  meta?: Record<string, unknown>;
}): PipelineErrorRecord {
  const parts = toErrorParts(args.error);

  const record: PipelineErrorRecord = {
    id: `err-${randomUUID()}`,
    timestamp: new Date().toISOString(),

    dataset: args.dataset,
    pipelineId: args.pipelineId,
    outputDirRelative: path.relative(process.cwd(), args.outputDir),

    source: args.source,
    agentName: args.agentName || '',

    stageNumber: args.stageNumber ?? 0,
    stageName: args.stageName ?? '',
    itemId: args.itemId ?? '',

    severity: args.severity ?? 'error',
    classification: args.classification ?? classifyErrorForPersistence(args.error),
    actionTaken: args.actionTaken ?? 'continued',

    name: parts.name,
    message: parts.message,
    stack: parts.stack,

    meta: safeMeta(args.meta),
  };

  // Validate at the boundary so verify tooling can trust the file.
  // If validation fails, fall back to a minimal safe record.
  const parsed = PipelineErrorRecordSchema.safeParse(record);
  if (parsed.success) return parsed.data;

  return {
    id: `err-${randomUUID()}`,
    timestamp: new Date().toISOString(),
    dataset: args.dataset || '',
    pipelineId: args.pipelineId || '',
    outputDirRelative: path.relative(process.cwd(), args.outputDir || ''),
    source: args.source,
    agentName: args.agentName || '',
    stageNumber: 0,
    stageName: '',
    itemId: args.itemId ?? '',
    severity: 'error',
    classification: 'unknown',
    actionTaken: 'continued',
    name: 'ErrorPersistenceValidationError',
    message: 'Failed to build a valid PipelineErrorRecord',
    stack: '',
    meta: { zodIssues: parsed.error.issues.map(i => ({ path: i.path, message: i.message })) },
  };
}

// =============================================================================
// Persistence
// =============================================================================

export async function persistPipelineError(outputDir: string, record: PipelineErrorRecord): Promise<void> {
  const errorsDir = getErrorsDir(outputDir);
  const logPath = getErrorsLogPath(outputDir);
  const key = logPath;

  await enqueueWrite(key, async () => {
    await fs.mkdir(errorsDir, { recursive: true });
    await fs.appendFile(logPath, `${JSON.stringify(record)}\n`, 'utf-8');
  });
}

export async function persistAgentError(args: {
  outputDir: string;
  dataset: string;
  pipelineId: string;
  agentName: string;
  stageNumber?: number;
  stageName?: string;
  itemId?: string;
  severity?: PipelineErrorSeverity;
  classification?: PipelineErrorClassification;
  actionTaken?: PipelineErrorActionTaken;
  error: unknown;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const record = buildPipelineErrorRecord({
    dataset: args.dataset,
    pipelineId: args.pipelineId,
    outputDir: args.outputDir,
    source: 'agent',
    agentName: args.agentName,
    stageNumber: args.stageNumber,
    stageName: args.stageName,
    itemId: args.itemId,
    severity: args.severity,
    classification: args.classification,
    actionTaken: args.actionTaken,
    error: args.error,
    meta: args.meta,
  });
  await persistPipelineError(args.outputDir, record);
}

export async function persistAgentErrorAuto(args: Omit<Parameters<typeof persistAgentError>[0], 'dataset' | 'pipelineId'>): Promise<void> {
  const { dataset, pipelineId } = inferRunIdentityFromOutputDir(args.outputDir);
  await persistAgentError({ ...args, dataset, pipelineId });
}

export async function persistSystemError(args: {
  outputDir: string;
  dataset: string;
  pipelineId: string;
  stageNumber?: number;
  stageName?: string;
  itemId?: string;
  severity?: PipelineErrorSeverity;
  classification?: PipelineErrorClassification;
  actionTaken?: PipelineErrorActionTaken;
  error: unknown;
  meta?: Record<string, unknown>;
}): Promise<void> {
  const record = buildPipelineErrorRecord({
    dataset: args.dataset,
    pipelineId: args.pipelineId,
    outputDir: args.outputDir,
    source: 'system',
    stageNumber: args.stageNumber,
    stageName: args.stageName,
    itemId: args.itemId,
    severity: args.severity,
    classification: args.classification,
    actionTaken: args.actionTaken,
    error: args.error,
    meta: args.meta,
  });
  await persistPipelineError(args.outputDir, record);
}

export async function persistSystemErrorAuto(args: Omit<Parameters<typeof persistSystemError>[0], 'dataset' | 'pipelineId'>): Promise<void> {
  const { dataset, pipelineId } = inferRunIdentityFromOutputDir(args.outputDir);
  await persistSystemError({ ...args, dataset, pipelineId });
}

// =============================================================================
// Read + summarize
// =============================================================================

export interface ReadPipelineErrorsResult {
  records: PipelineErrorRecord[];
  invalidLines: Array<{ lineNumber: number; raw: string; error: string }>;
}

export async function readPipelineErrors(outputDir: string): Promise<ReadPipelineErrorsResult> {
  const logPath = getErrorsLogPath(outputDir);
  try {
    const raw = await fs.readFile(logPath, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);

    const records: PipelineErrorRecord[] = [];
    const invalidLines: ReadPipelineErrorsResult['invalidLines'] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      try {
        const parsedJson = JSON.parse(line) as unknown;
        const parsed = PipelineErrorRecordSchema.safeParse(parsedJson);
        if (parsed.success) {
          records.push(parsed.data);
        } else {
          invalidLines.push({ lineNumber: i + 1, raw: line, error: parsed.error.message });
        }
      } catch (e) {
        invalidLines.push({ lineNumber: i + 1, raw: line, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return { records, invalidLines };
  } catch {
    return { records: [], invalidLines: [] };
  }
}

export interface PipelineErrorsSummary {
  total: number;
  bySource: Record<string, number>;
  bySeverity: Record<string, number>;
  byAgent: Record<string, number>;
  byStageName: Record<string, number>;
  lastErrorAt: string;
}

export function summarizePipelineErrors(records: PipelineErrorRecord[]): PipelineErrorsSummary {
  const bySource: Record<string, number> = {};
  const bySeverity: Record<string, number> = {};
  const byAgent: Record<string, number> = {};
  const byStageName: Record<string, number> = {};

  let last = '';
  for (const r of records) {
    bySource[r.source] = (bySource[r.source] || 0) + 1;
    bySeverity[r.severity] = (bySeverity[r.severity] || 0) + 1;
    if (r.agentName) byAgent[r.agentName] = (byAgent[r.agentName] || 0) + 1;
    if (r.stageName) byStageName[r.stageName] = (byStageName[r.stageName] || 0) + 1;
    if (!last || r.timestamp > last) last = r.timestamp;
  }

  return {
    total: records.length,
    bySource,
    bySeverity,
    byAgent,
    byStageName,
    lastErrorAt: last,
  };
}

// =============================================================================
// Clear / archive
// =============================================================================

export interface ClearErrorsReport {
  outputDirRelative: string;
  hadErrorsFile: boolean;
  archivedTo: string;
  clearedAt: string;
}

export async function archiveAndClearPipelineErrors(outputDir: string): Promise<ClearErrorsReport> {
  const logPath = getErrorsLogPath(outputDir);
  const archiveDir = getErrorsArchiveDir(outputDir);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const archivedTo = path.join(archiveDir, `errors-${timestamp}.ndjson`);

  let hadErrorsFile = false;
  try {
    await fs.access(logPath);
    hadErrorsFile = true;
  } catch {
    hadErrorsFile = false;
  }

  await fs.mkdir(archiveDir, { recursive: true });

  if (hadErrorsFile) {
    await fs.rename(logPath, archivedTo);
  } else {
    // Ensure directory exists even if there was nothing to archive.
    // Leave archivedTo empty in this case.
  }

  return {
    outputDirRelative: path.relative(process.cwd(), outputDir),
    hadErrorsFile,
    archivedTo: hadErrorsFile ? path.relative(outputDir, archivedTo) : '',
    clearedAt: new Date().toISOString(),
  };
}

