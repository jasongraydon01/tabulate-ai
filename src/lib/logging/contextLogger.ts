/**
 * Context-aware logging utility for pipeline execution
 *
 * Adds structured prefixes to all log messages:
 * [Project Name | runId | Stage] Message
 *
 * This makes Railway logs searchable by project or run ID.
 */

export interface LogContext {
  projectName: string;
  runId: string;
  stage?: string;
}

export interface ContextLogger {
  log: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string, err?: unknown) => void;
  withStage: (stage: string) => ContextLogger;
}

/**
 * Creates a context-aware logger with consistent prefixes
 *
 * @param context - Project name, run ID, and optional stage
 * @returns Logger instance with log/warn/error methods
 *
 * @example
 * const logger = createContextLogger({
 *   projectName: "My Study",
 *   runId: "pipeline-2026-02-14T02-00-07-829Z",
 *   stage: "R Execution"
 * });
 *
 * logger.log("Executing R script...");
 * // Output: [My Study | 07-829Z | R Execution] Executing R script...
 */
export function createContextLogger(context: LogContext): ContextLogger {
  // Truncate run ID to last 8 chars for readability
  const shortRunId = context.runId.slice(-8);

  // Build prefix: [Project | runId | Stage]
  const buildPrefix = (stage?: string): string => {
    const parts = [context.projectName, shortRunId];
    if (stage || context.stage) {
      parts.push(stage || context.stage!);
    }
    return `[${parts.join(' | ')}]`;
  };

  return {
    log: (msg: string) => {
      console.log(`${buildPrefix()} ${msg}`);
    },

    warn: (msg: string) => {
      console.warn(`${buildPrefix()} ${msg}`);
    },

    error: (msg: string, err?: unknown) => {
      const prefix = buildPrefix();
      if (err) {
        const fullErr = err instanceof Error ? err.message : String(err);
        console.error(`${prefix} ${msg}`, fullErr);
      } else {
        console.error(`${prefix} ${msg}`);
      }
    },

    /**
     * Create a new logger with a different stage
     * Useful for passing to sub-components
     */
    withStage: (stage: string) => {
      return createContextLogger({ ...context, stage });
    },
  };
}

/**
 * Fallback logger when context is not available
 * Uses generic prefixes but maintains same interface
 */
export function createFallbackLogger(runId: string): ContextLogger {
  return createContextLogger({
    projectName: 'Pipeline',
    runId,
    stage: undefined,
  });
}
