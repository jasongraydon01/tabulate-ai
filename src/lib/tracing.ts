/**
 * Tracing helpers (slim wrapper)
 *
 * Re-exports from observability modules. The original scaffolding has been
 * replaced by WideEvent + Sentry integration in Phase 3.5b.
 */

import * as Sentry from '@sentry/nextjs';

export { WideEvent, startPipelineTransaction, setSentryUser } from './observability';

/**
 * @deprecated Use Sentry.addBreadcrumb() or WideEvent directly.
 * Kept for backward compatibility with process-crosstab/route.ts.
 */
export const logAgentExecution = (
  sessionId: string,
  agentName: string,
  _input: unknown,
  _output: unknown,
  duration: number
): void => {
  if (typeof Sentry.addBreadcrumb === 'function') {
    Sentry.addBreadcrumb({
      category: 'agent',
      message: `${agentName} (session: ${sessionId})`,
      level: 'info',
      data: { duration },
    });
  }
};
