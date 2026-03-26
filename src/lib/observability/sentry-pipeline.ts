/**
 * Sentry pipeline span helpers.
 *
 * Thin wrapper that keeps Sentry SDK details out of PipelineRunner.
 * Pipeline runs happen outside the HTTP request lifecycle, so we use
 * `Sentry.startInactiveSpan` for manual span management.
 */

import * as Sentry from '@sentry/nextjs';
import type { AuthContext } from '@/lib/auth';

// =============================================================================
// Types
// =============================================================================

export interface StageSpan {
  finish: (status: 'ok' | 'error') => void;
}

export interface PipelineSpanContext {
  startStage: (name: string) => StageSpan;
  finish: (status: 'ok' | 'error') => void;
}

interface PipelineTransactionOpts {
  pipelineId: string;
  dataset: string;
  orgId?: string;
}

// =============================================================================
// Span helpers
// =============================================================================

/**
 * Start a manual Sentry span for a background pipeline run.
 * Returns a context object with helpers for child spans.
 *
 * Uses `startInactiveSpan` (not `startSpanManual`) because the pipeline
 * is a long-lived background process — the span outlives any callback scope.
 * Child spans use explicit `parentSpan` to maintain the trace hierarchy.
 */
export function startPipelineTransaction(opts: PipelineTransactionOpts): PipelineSpanContext {
  const rootSpan =
    typeof Sentry.startInactiveSpan === 'function'
      ? Sentry.startInactiveSpan({
          name: 'pipeline.run',
          op: 'pipeline',
          attributes: {
            'pipeline.id': opts.pipelineId,
            'pipeline.dataset': opts.dataset,
            ...(opts.orgId ? { 'pipeline.org_id': opts.orgId } : {}),
          },
        })
      : undefined;

  let finished = false;

  return {
    startStage(name: string): StageSpan {
      const stageSpan = rootSpan
        && typeof Sentry.startInactiveSpan === 'function'
        ? Sentry.startInactiveSpan({
            name: `pipeline.stage.${name}`,
            op: 'pipeline.stage',
            attributes: { 'stage.name': name },
            parentSpan: rootSpan,
          })
        : undefined;

      return {
        finish(status: 'ok' | 'error') {
          if (stageSpan) {
            stageSpan.setStatus({
              code: status === 'ok' ? 1 : 2, // 1 = OK, 2 = ERROR in OpenTelemetry
              message: status,
            });
            stageSpan.end();
          }
        },
      };
    },

    finish(status: 'ok' | 'error') {
      if (finished) return;
      finished = true;

      if (rootSpan) {
        rootSpan.setStatus({
          code: status === 'ok' ? 1 : 2,
          message: status,
        });
        rootSpan.end();
      }
    },
  };
}

/**
 * Set Sentry user context from auth.
 * Only sends opaque userId — no email or PII.
 */
export function setSentryUser(auth: AuthContext): void {
  if (typeof Sentry.setUser === 'function') {
    Sentry.setUser({ id: auth.userId });
  }
  if (typeof Sentry.setTag === 'function') {
    Sentry.setTag('org_id', auth.orgId);
  }
}
