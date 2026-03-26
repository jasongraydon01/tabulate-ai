/**
 * Circuit Breaker for Azure OpenAI API failures.
 *
 * Tracks consecutive failures of the same classification across the entire pipeline.
 * When the threshold is reached, triggers a callback (typically to abort the pipeline).
 *
 * Design:
 * - Any success resets the counter (proves Azure is reachable)
 * - Only specified classifications trigger the breaker (default: rate_limit, transient)
 * - Breaker binding is pipeline-context scoped (no process-global singleton)
 */

import type { RetryClassification } from './retryWithPolicyHandling';
import { getPipelineContext, requirePipelineContext } from './pipeline/PipelineContext';

export interface CircuitBreakerOptions {
  /** Consecutive failure count before tripping. Default: 3 */
  threshold?: number;
  /** Which failure classifications trigger the breaker */
  classifications?: RetryClassification[];
  /** Called when the breaker trips */
  onTrip: (info: { classification: string; consecutiveCount: number; lastError: string }) => void;
}

export class CircuitBreaker {
  private threshold: number;
  private classifications: Set<RetryClassification>;
  private onTrip: CircuitBreakerOptions['onTrip'];
  private consecutiveCount = 0;
  private lastClassification: RetryClassification | null = null;
  private tripped = false;

  constructor(options: CircuitBreakerOptions) {
    this.threshold = options.threshold ?? 3;
    this.classifications = new Set(options.classifications ?? ['rate_limit', 'transient']);
    this.onTrip = options.onTrip;
  }

  recordFailure(classification: RetryClassification, errorSummary: string): void {
    if (this.tripped) return;

    if (!this.classifications.has(classification)) {
      // Non-matching classification resets counter
      this.consecutiveCount = 0;
      this.lastClassification = null;
      return;
    }

    if (this.lastClassification === classification) {
      this.consecutiveCount++;
    } else {
      // Different matching classification — start counting from 1
      this.consecutiveCount = 1;
      this.lastClassification = classification;
    }

    if (this.consecutiveCount >= this.threshold) {
      this.tripped = true;
      this.onTrip({
        classification,
        consecutiveCount: this.consecutiveCount,
        lastError: errorSummary,
      });
    }
  }

  recordSuccess(): void {
    this.consecutiveCount = 0;
    this.lastClassification = null;
  }

  isTripped(): boolean {
    return this.tripped;
  }
}

export function setActiveCircuitBreaker(breaker: CircuitBreaker | null): void {
  requirePipelineContext().resilience.circuitBreaker = breaker;
}

export function getActiveCircuitBreaker(): CircuitBreaker | null {
  return getPipelineContext()?.resilience.circuitBreaker ?? null;
}
