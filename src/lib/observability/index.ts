/**
 * Observability utilities for TabulateAI pipeline
 *
 * Provides token usage tracking, cost estimation, wide events, and Sentry integration.
 */

export {
  calculateCost,
  calculateCostSync,
  formatCost,
  formatCostBreakdown,
  preloadPricing,
  type TokenUsage,
  type CostBreakdown,
} from './CostCalculator';

export {
  AgentMetricsCollector,
  getMetricsCollector,
  resetMetricsCollector,
  runWithMetricsCollector,
  recordAgentMetrics,
  getPipelineCostSummary,
  type AgentMetric,
  type AgentSummary,
  type PipelineSummary,
} from './AgentMetrics';

export {
  WideEvent,
  type WideEventInit,
  type StageRecord,
  type AgentCallRecord,
  type WideEventOutcome,
} from './wide-event';

export {
  startPipelineTransaction,
  setSentryUser,
  type PipelineSpanContext,
  type StageSpan,
} from './sentry-pipeline';
