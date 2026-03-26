/**
 * WideEvent — Canonical log line for pipeline runs.
 *
 * Inspired by Stripe's "wide events": one rich, structured event per pipeline
 * run that contains everything you'd need to debug it. Instead of hunting
 * through scattered console.logs, query one event.
 *
 * Usage:
 *   const event = new WideEvent({ pipelineId, dataset });
 *   event.set('bannerGroups', 5);
 *   event.recordStage('BannerAgent', 'ok', 1234);
 *   event.recordAgentCall({ agentName: 'BannerAgent', model: 'gpt-5-nano', ... });
 *   event.finish('success');
 */

import * as Sentry from '@sentry/nextjs';

// =============================================================================
// Types
// =============================================================================

export interface WideEventInit {
  pipelineId: string;
  dataset: string;
  orgId?: string;
  userId?: string;
  projectId?: string;
}

export interface StageRecord {
  name: string;
  status: 'ok' | 'error' | 'skipped';
  durationMs: number;
  error?: string;
}

export interface AgentCallRecord {
  agentName: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  costUsd: number;
}

export type WideEventOutcome = 'success' | 'error' | 'partial' | 'cancelled';

// =============================================================================
// WideEvent
// =============================================================================

/** Keys that should never be set on a WideEvent (prevents accidental secret leakage). */
const BLOCKED_KEYS = /key|secret|password|token|credential|dsn|authorization/i;

/** Max serialized size for a .set() value (10 KB). */
const MAX_VALUE_SIZE = 10_240;

export class WideEvent {
  private readonly pipelineId: string;
  private readonly dataset: string;
  private readonly orgId: string;
  private readonly userId: string;
  private readonly projectId: string;
  private readonly startTime: number;

  private fields: Record<string, unknown> = {};
  private stages: StageRecord[] = [];
  private agentCalls: AgentCallRecord[] = [];
  private finished = false;

  constructor(init: WideEventInit) {
    this.pipelineId = init.pipelineId;
    this.dataset = init.dataset;
    this.orgId = init.orgId ?? '';
    this.userId = init.userId ?? '';
    this.projectId = init.projectId ?? '';
    this.startTime = Date.now();
  }

  /** Accumulate an arbitrary key-value pair. Rejects sensitive keys and oversized values. */
  set(key: string, value: unknown): void {
    if (BLOCKED_KEYS.test(key)) {
      console.warn(`[WideEvent] Blocked sensitive key: "${key}"`);
      return;
    }
    try {
      const serialized = JSON.stringify(value);
      if (serialized && serialized.length > MAX_VALUE_SIZE) {
        console.warn(`[WideEvent] Value for "${key}" exceeds ${MAX_VALUE_SIZE} bytes, truncating`);
        this.fields[key] = `[TRUNCATED: ${serialized.length} bytes]`;
        return;
      }
    } catch {
      // non-serializable value — store as-is, Sentry will handle
    }
    this.fields[key] = value;
  }

  /** Record a pipeline stage completion. */
  recordStage(name: string, status: StageRecord['status'], durationMs: number, error?: string): void {
    this.stages.push({ name, status, durationMs, ...(error ? { error } : {}) });
  }

  /** Record an agent call (called from AgentMetricsCollector). */
  recordAgentCall(call: AgentCallRecord): void {
    this.agentCalls.push(call);
  }

  /** Finalize the event: compute totals, emit to Sentry + console. */
  finish(outcome: WideEventOutcome, error?: string): void {
    if (this.finished) return;
    this.finished = true;

    const durationMs = Date.now() - this.startTime;

    // Compute totals
    const totalInputTokens = this.agentCalls.reduce((s, c) => s + c.inputTokens, 0);
    const totalOutputTokens = this.agentCalls.reduce((s, c) => s + c.outputTokens, 0);
    const totalCostUsd = this.agentCalls.reduce((s, c) => s + c.costUsd, 0);
    const totalAgentCalls = this.agentCalls.length;

    const eventData = {
      pipelineId: this.pipelineId,
      dataset: this.dataset,
      orgId: this.orgId,
      userId: this.userId,
      projectId: this.projectId,
      outcome,
      durationMs,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd: Math.round(totalCostUsd * 10000) / 10000,
      totalAgentCalls,
      stages: this.stages,
      agentCalls: this.agentCalls,
      ...this.fields,
      ...(error ? { error } : {}),
    };

    // Emit to Sentry
    if (typeof Sentry.captureEvent === 'function') {
      Sentry.captureEvent({
        message: `pipeline.run.${outcome}`,
        level: outcome === 'success' || outcome === 'partial' ? 'info' : 'error',
        tags: {
          pipeline_id: this.pipelineId,
          dataset: this.dataset,
          org_id: this.orgId,
          project_id: this.projectId,
          outcome,
        },
        extra: eventData,
      });
    }

    // Emit canonical JSON line for local debugging
    console.log(JSON.stringify({ _event: 'pipeline.run', ...eventData }));
  }
}
