/**
 * Console output capture for pipeline runs
 *
 * Hooks console.log/warn/error to:
 * 1. Add context prefix: [Project Name | runId | stage]
 * 2. Write to logs/pipeline.log file
 *
 * Benefits:
 * - Searchable Railway logs by project name and run ID
 * - Full sequential log file persisted in R2
 * - Isolated per-pipeline using AsyncLocalStorage (no cross-contamination)
 *
 * ARCHITECTURE:
 * - Console methods are hooked ONCE globally (singleton pattern)
 * - Each pipeline run sets its context in AsyncLocalStorage
 * - Console hooks read context from AsyncLocalStorage dynamically
 * - Multiple concurrent pipelines get independent logging contexts
 */

import { createWriteStream, type WriteStream } from 'fs';
import { promises as fs } from 'fs';
import * as path from 'path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { getPipelineContext } from '../pipeline/PipelineContext';

interface CaptureContext {
  projectName: string;
  runId: string;
  stage?: string;
}

interface OriginalConsoleMethods {
  log: typeof console.log;
  warn: typeof console.warn;
  error: typeof console.error;
}

// =============================================================================
// Global Console Hook State (installed once per process)
// =============================================================================

/** AsyncLocalStorage for per-pipeline console context */
const consoleContextStorage = new AsyncLocalStorage<CaptureContext>();

/** Map of runId -> log stream (each pipeline writes to its own log file) */
const logStreams = new Map<string, { stream: WriteStream; writeQueue: Promise<void> }>();

/** Original console methods (saved once) */
let originalConsoleMethods: OriginalConsoleMethods | null = null;

/** Whether global console hooks have been installed */
let hooksInstalled = false;

/**
 * Install global console hooks (idempotent - only runs once per process)
 * These hooks read context from AsyncLocalStorage at call time
 */
function installGlobalConsoleHooks(): void {
  if (hooksInstalled) return;

  // Save original methods
  originalConsoleMethods = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  // Hook console.log
  console.log = (...args: unknown[]) => {
    const ctx = consoleContextStorage.getStore();
    const message = formatMessage(args);

    if (ctx) {
      const shortRunId = ctx.runId.slice(-8);
      const prefix = `[${ctx.projectName} | ${shortRunId}]`;
      writeToLogFile(ctx.runId, 'INFO', message);
      originalConsoleMethods!.log(`${prefix} ${message}`);
    } else {
      // No context - pass through to original
      originalConsoleMethods!.log(...args);
    }
  };

  // Hook console.warn
  console.warn = (...args: unknown[]) => {
    const ctx = consoleContextStorage.getStore();
    const message = formatMessage(args);

    if (ctx) {
      const shortRunId = ctx.runId.slice(-8);
      const prefix = `[${ctx.projectName} | ${shortRunId}]`;
      writeToLogFile(ctx.runId, 'WARN', message);
      originalConsoleMethods!.warn(`${prefix} ${message}`);
    } else {
      originalConsoleMethods!.warn(...args);
    }
  };

  // Hook console.error
  console.error = (...args: unknown[]) => {
    const ctx = consoleContextStorage.getStore();
    const message = formatMessage(args);

    if (ctx) {
      const shortRunId = ctx.runId.slice(-8);
      const prefix = `[${ctx.projectName} | ${shortRunId}]`;
      writeToLogFile(ctx.runId, 'ERROR', message);
      originalConsoleMethods!.error(`${prefix} ${message}`);
    } else {
      originalConsoleMethods!.error(...args);
    }
  };

  hooksInstalled = true;
}

/**
 * Format console arguments into a single message string
 */
function formatMessage(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      if (arg instanceof Error) return `${arg.message}\n${arg.stack}`;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');
}

/**
 * Write log entry to file with timestamp and level
 * Uses write queue to prevent interleaving within same pipeline
 */
function writeToLogFile(runId: string, level: string, message: string): void {
  const streamData = logStreams.get(runId);
  if (!streamData) return;

  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${level}] ${message}\n`;

  // Queue writes to prevent interleaving
  streamData.writeQueue = streamData.writeQueue
    .catch((err) => {
      originalConsoleMethods?.error('[ConsoleCapture] Previous log write failed:', err);
    })
    .then(
      () =>
        new Promise<void>((resolve, reject) => {
          streamData.stream.write(line, (err) => {
            if (err) reject(err);
            else resolve();
          });
        })
    );
}

async function closeStreamSafely(streamData: { stream: WriteStream; writeQueue: Promise<void> }): Promise<void> {
  try {
    await streamData.writeQueue;
  } catch (err) {
    originalConsoleMethods?.error('[ConsoleCapture] Pending log write queue failed during stop:', err);
  }

  await new Promise<void>((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    streamData.stream.once('error', (err) => {
      originalConsoleMethods?.error('[ConsoleCapture] Failed to close log stream:', err);
      done();
    });
    streamData.stream.end(done);
  });
}

// =============================================================================
// ConsoleCapture Class (per-pipeline instance)
// =============================================================================

export class ConsoleCapture {
  private logPath: string;
  private context: CaptureContext;

  constructor(outputDir: string, context: CaptureContext) {
    this.logPath = path.join(outputDir, 'logs', 'pipeline.log');
    this.context = context;
  }

  /**
   * Start capturing console output for this pipeline
   * Opens log file stream and registers context
   */
  async start(): Promise<void> {
    // Install global hooks (idempotent)
    installGlobalConsoleHooks();

    // Create logs directory
    await fs.mkdir(path.dirname(this.logPath), { recursive: true });

    const existing = logStreams.get(this.context.runId);
    if (existing) {
      await closeStreamSafely(existing);
      logStreams.delete(this.context.runId);
    }

    // Open log file stream for this pipeline
    const stream = createWriteStream(this.logPath, { flags: 'a' });
    logStreams.set(this.context.runId, {
      stream,
      writeQueue: Promise.resolve(),
    });

    const ctx = getPipelineContext();
    if (ctx) {
      ctx.logging.activeRunLogId = this.context.runId;
    }
  }

  /**
   * Stop capturing and close log file stream
   * Does NOT restore console methods (they remain hooked globally)
   */
  async stop(): Promise<void> {
    const streamData = logStreams.get(this.context.runId);
    if (!streamData) return;

    try {
      await closeStreamSafely(streamData);
    } finally {
      logStreams.delete(this.context.runId);
      const ctx = getPipelineContext();
      if (ctx?.logging.activeRunLogId === this.context.runId) {
        delete ctx.logging.activeRunLogId;
      }
    }
  }

  /**
   * Run a function with console context set for this pipeline
   * All console.log/warn/error calls within fn will use this context
   */
  run<T>(fn: () => T | Promise<T>): T | Promise<T> {
    return consoleContextStorage.run(this.context, fn);
  }
}

/**
 * Run a function with console isolation for a specific pipeline
 * Convenience function that combines context setting with execution
 */
export function runWithConsoleContext<T>(
  context: CaptureContext,
  fn: () => T | Promise<T>
): T | Promise<T> {
  installGlobalConsoleHooks();
  return consoleContextStorage.run(context, fn);
}

export function getConsoleCaptureContext(): CaptureContext | null {
  return consoleContextStorage.getStore() ?? null;
}
