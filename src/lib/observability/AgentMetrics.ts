/**
 * AgentMetrics
 *
 * Tracks token usage and costs across all agents in the pipeline.
 * Provides aggregate metrics for pipeline runs.
 *
 * Usage:
 *   const metrics = new AgentMetricsCollector();
 *
 *   // After each agent call:
 *   metrics.record('VerificationAgent', 'gpt-4o', { input: 1500, output: 800 }, 2341);
 *
 *   // At end of pipeline:
 *   const summary = await metrics.getSummary();
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as Sentry from '@sentry/nextjs';
import {
  calculateCost,
  calculateCostSync,
  formatCost,
  type TokenUsage,
  type CostBreakdown,
} from './CostCalculator';
import { getPipelineEventBus } from '../events';
import type { WideEvent } from './wide-event';

// =============================================================================
// Types
// =============================================================================

export interface AgentMetric {
  agentName: string;
  model: string;
  tokens: TokenUsage;
  durationMs: number;
  cost?: CostBreakdown;
  timestamp: Date;
}

export interface AgentSummary {
  agentName: string;
  model: string;
  calls: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalDurationMs: number;
  avgDurationMs: number;
  estimatedCostUsd: number;
}

export interface PipelineSummary {
  byAgent: AgentSummary[];
  totals: {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    durationMs: number;
    estimatedCostUsd: number;
  };
  timestamp: string;
}

// =============================================================================
// Metrics Collector
// =============================================================================

export class AgentMetricsCollector {
  private metrics: AgentMetric[] = [];
  private wideEvent: WideEvent | null = null;

  /** Bind a WideEvent so all subsequent record() calls enrich it. */
  bindWideEvent(event: WideEvent): void {
    this.wideEvent = event;
  }

  /** Unbind the WideEvent (call at pipeline end). */
  unbindWideEvent(): void {
    this.wideEvent = null;
  }

  /**
   * Record metrics from an agent call
   *
   * @param agentName - Name of the agent (BannerAgent, CrosstabAgent, etc.)
   * @param model - Model used (from env or response)
   * @param tokens - Token usage { input, output }
   * @param durationMs - Call duration in milliseconds
   */
  record(
    agentName: string,
    model: string,
    tokens: TokenUsage,
    durationMs: number
  ): void {
    this.metrics.push({
      agentName,
      model,
      tokens,
      durationMs,
      timestamp: new Date(),
    });

    // Emit cost:update event for CLI
    const costBreakdown = calculateCostSync(model, tokens);
    const totalCostUsd = this.getTotalCostSync();
    getPipelineEventBus().emitCostUpdate(
      agentName,
      model,
      tokens.input,
      tokens.output,
      costBreakdown.totalCost,
      totalCostUsd
    );

    // Enrich WideEvent (auto-instruments all agents)
    this.wideEvent?.recordAgentCall({
      agentName,
      model,
      inputTokens: tokens.input,
      outputTokens: tokens.output,
      durationMs,
      costUsd: costBreakdown.totalCost,
    });

    // Add Sentry breadcrumb for error context
    if (typeof Sentry.addBreadcrumb === 'function') {
      Sentry.addBreadcrumb({
        category: 'agent',
        message: `${agentName} call completed`,
        level: 'info',
        data: {
          model,
          inputTokens: tokens.input,
          outputTokens: tokens.output,
          durationMs,
          costUsd: costBreakdown.totalCost,
        },
      });
    }
  }

  /**
   * Get total cost synchronously (for event emission)
   */
  private getTotalCostSync(): number {
    let total = 0;
    for (const metric of this.metrics) {
      const cost = calculateCostSync(metric.model, metric.tokens);
      total += cost.totalCost;
    }
    return total;
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): AgentMetric[] {
    return [...this.metrics];
  }

  /**
   * Get summary with cost calculations
   */
  async getSummary(): Promise<PipelineSummary> {
    // Calculate costs for all metrics
    const metricsWithCosts = await Promise.all(
      this.metrics.map(async (m) => ({
        ...m,
        cost: await calculateCost(m.model, m.tokens),
      }))
    );

    // Group by agent
    const byAgentMap = new Map<string, AgentMetric[]>();
    for (const metric of metricsWithCosts) {
      const key = `${metric.agentName}|${metric.model}`;
      if (!byAgentMap.has(key)) {
        byAgentMap.set(key, []);
      }
      byAgentMap.get(key)!.push(metric);
    }

    // Build per-agent summaries
    const byAgent: AgentSummary[] = [];
    for (const [key, agentMetrics] of byAgentMap) {
      const [agentName, model] = key.split('|');
      const totalInputTokens = agentMetrics.reduce((sum, m) => sum + m.tokens.input, 0);
      const totalOutputTokens = agentMetrics.reduce((sum, m) => sum + m.tokens.output, 0);
      const totalDurationMs = agentMetrics.reduce((sum, m) => sum + m.durationMs, 0);
      const estimatedCostUsd = agentMetrics.reduce(
        (sum, m) => sum + (m.cost?.totalCost || 0),
        0
      );

      byAgent.push({
        agentName,
        model,
        calls: agentMetrics.length,
        totalInputTokens,
        totalOutputTokens,
        totalTokens: totalInputTokens + totalOutputTokens,
        totalDurationMs,
        avgDurationMs: Math.round(totalDurationMs / agentMetrics.length),
        estimatedCostUsd,
      });
    }

    // Sort by agent name
    byAgent.sort((a, b) => a.agentName.localeCompare(b.agentName));

    // Calculate totals
    const totals = {
      calls: this.metrics.length,
      inputTokens: byAgent.reduce((sum, a) => sum + a.totalInputTokens, 0),
      outputTokens: byAgent.reduce((sum, a) => sum + a.totalOutputTokens, 0),
      totalTokens: byAgent.reduce((sum, a) => sum + a.totalTokens, 0),
      durationMs: byAgent.reduce((sum, a) => sum + a.totalDurationMs, 0),
      estimatedCostUsd: byAgent.reduce((sum, a) => sum + a.estimatedCostUsd, 0),
    };

    return {
      byAgent,
      totals,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Format summary for console display
   */
  async formatSummary(): Promise<string> {
    const summary = await this.getSummary();
    const lines: string[] = [];

    lines.push('');
    lines.push('═'.repeat(70));
    lines.push('  Pipeline Cost Summary');
    lines.push('═'.repeat(70));
    lines.push('');

    // Per-agent breakdown
    for (const agent of summary.byAgent) {
      lines.push(`  ${agent.agentName} (${agent.model})`);
      lines.push(`    Calls: ${agent.calls}`);
      lines.push(
        `    Tokens: ${agent.totalInputTokens.toLocaleString()} in / ${agent.totalOutputTokens.toLocaleString()} out`
      );
      lines.push(`    Duration: ${(agent.totalDurationMs / 1000).toFixed(1)}s total, ${(agent.avgDurationMs / 1000).toFixed(2)}s avg`);
      lines.push(`    Cost: ${formatCost(agent.estimatedCostUsd)}`);
      lines.push('');
    }

    // Totals
    lines.push('─'.repeat(70));
    lines.push(`  TOTAL`);
    lines.push(`    Calls: ${summary.totals.calls}`);
    lines.push(
      `    Tokens: ${summary.totals.inputTokens.toLocaleString()} in / ${summary.totals.outputTokens.toLocaleString()} out (${summary.totals.totalTokens.toLocaleString()} total)`
    );
    lines.push(`    Agent Time: ${(summary.totals.durationMs / 1000).toFixed(1)}s (cumulative, may exceed wall-clock due to parallelism)`);
    lines.push(`    Estimated Cost: ${formatCost(summary.totals.estimatedCostUsd)}`);
    lines.push('═'.repeat(70));
    lines.push('');

    return lines.join('\n');
  }

  /**
   * Clear all recorded metrics
   */
  clear(): void {
    this.metrics = [];
  }
}

// =============================================================================
// Pipeline-scoped metrics (AsyncLocalStorage for concurrent run isolation)
// =============================================================================

const pipelineMetricsStorage = new AsyncLocalStorage<AgentMetricsCollector>();

/** Global fallback for CLI/scripts (one pipeline at a time). */
let globalCollector: AgentMetricsCollector | null = null;

/**
 * Get the metrics collector for the current pipeline run.
 *
 * Prefers the pipeline-scoped collector (set via `runWithMetricsCollector`)
 * over the global singleton. This ensures concurrent web API pipeline runs
 * each get their own collector, while CLI scripts (which don't use
 * AsyncLocalStorage) fall back to the global singleton.
 */
export function getMetricsCollector(): AgentMetricsCollector {
  return pipelineMetricsStorage.getStore() ?? getGlobalCollector();
}

function getGlobalCollector(): AgentMetricsCollector {
  if (!globalCollector) {
    globalCollector = new AgentMetricsCollector();
  }
  return globalCollector;
}

/**
 * Reset the global metrics collector.
 * Used by CLI scripts (PipelineRunner) that run one pipeline at a time.
 */
export function resetMetricsCollector(): void {
  globalCollector = new AgentMetricsCollector();
}

/**
 * Run a function with a pipeline-scoped metrics collector.
 *
 * All `recordAgentMetrics()` / `getMetricsCollector()` calls within `fn`
 * (and its async descendants) will use this collector instead of the global.
 * This isolates concurrent pipeline runs from each other.
 *
 * Usage (in pipelineOrchestrator):
 *   const collector = new AgentMetricsCollector();
 *   await runWithMetricsCollector(collector, async () => { ... });
 */
export function runWithMetricsCollector<T>(
  collector: AgentMetricsCollector,
  fn: () => T,
): T {
  return pipelineMetricsStorage.run(collector, fn);
}

// =============================================================================
// Convenience Functions
// =============================================================================

/**
 * Record metrics to the current pipeline's collector
 */
export function recordAgentMetrics(
  agentName: string,
  model: string,
  tokens: TokenUsage,
  durationMs: number
): void {
  getMetricsCollector().record(agentName, model, tokens, durationMs);
}

/**
 * Get and format the current pipeline's summary
 */
export async function getPipelineCostSummary(): Promise<string> {
  return getMetricsCollector().formatSummary();
}
