/**
 * Shared retry utility for handling transient Azure OpenAI / AI SDK errors.
 *
 * Design goal: the pipeline should not fail due to transient infrastructure issues
 * (rate limits, 5xx, flaky network) or stochastic safety filtering.
 *
 * IMPORTANT:
 * - This wrapper is intended to be the *primary* retry mechanism (8–10 outer attempts).
 * - Call sites should generally set the AI SDK's `maxRetries` to 0–1 to avoid double-retrying.
 */

import {
  APICallError,
  RetryError,
  TypeValidationError,
  JSONParseError,
  NoOutputGeneratedError,
  NoObjectGeneratedError,
} from 'ai';
import type { CircuitBreaker } from './CircuitBreaker';
import { getPipelineContext } from './pipeline/PipelineContext';

export interface RetryOptions {
  /** Maximum number of attempts (default: 10) */
  maxAttempts?: number;
  /** Base delay between retries in milliseconds (default: 2000) */
  delayMs?: number;
  /** Base delay for rate limit errors in milliseconds (default: 15000) */
  rateLimitDelayMs?: number;
  /** Base delay for policy errors in milliseconds (default: 500).
   *  Policy errors are stochastic — the same prompt often passes on retry —
   *  so a short delay is sufficient (just enough to avoid hammering). */
  policyDelayMs?: number;
  /** Maximum delay cap in milliseconds (default: 30000) */
  maxDelayMs?: number;
  /** Maximum delay cap for rate limits in milliseconds (default: 120000) */
  rateLimitMaxDelayMs?: number;
  /** Maximum delay cap for policy errors in milliseconds (default: 2000) */
  policyMaxDelayMs?: number;
  /**
   * How to handle policy-classified failures:
   * - 'ai' (default): keep retrying the wrapped function (legacy behavior)
   * - 'deterministic': do not retry the wrapped function on policy failure;
   *   return immediately so caller can apply deterministic fallback
   * - 'none': fail fast on policy failure (same retry behavior as deterministic,
   *   semantic intent is explicit no-policy-retry)
   */
  policyRetryMode?: 'ai' | 'deterministic' | 'none';
  /**
   * Attempt number (1-based) at which the caller may switch to a "policy-safe" prompt variant.
   * This wrapper doesn't change prompts itself; it provides `RetryContext.shouldUsePolicySafeVariant`.
   * Default: 9 (last resort — policy-safe degrades model context quality)
   */
  policySafeAfterAttempt?: number;
  /** Callback invoked on each retry attempt */
  onRetry?: (attempt: number, error: Error) => void;
  /** Callback invoked on each retry attempt with structured context */
  onRetryWithContext?: (context: RetryContext, error: Error, nextDelayMs: number) => void;
  /** AbortSignal to cancel retries */
  abortSignal?: AbortSignal;
  /** Random number generator for jitter (primarily for tests). Default: Math.random */
  random?: () => number;
  /** Optional explicit circuit breaker (primarily for tests/non-pipeline callers). */
  circuitBreaker?: CircuitBreaker | null;
}

export type RetryClassification =
  | 'rate_limit'
  | 'policy'
  | 'transient'
  | 'output_validation'
  | 'non_retryable';

export interface RetryContext {
  attempt: number;
  maxAttempts: number;
  /** Classification of the most recent failure (or 'non_retryable' for attempt 1) */
  lastClassification: RetryClassification;
  /** Short summary of the most recent failure */
  lastErrorSummary: string;
  /** True when repeated policy blocks suggest trying a policy-safe prompt variant */
  shouldUsePolicySafeVariant: boolean;
  /** True when this is the final attempt */
  isFinalAttempt: boolean;
  /** Response body from last 429 error (for diagnostics) */
  lastResponseBody?: unknown;
  /** Consecutive output_validation errors — 2+ suggests truncation */
  consecutiveOutputValidationErrors: number;
  /** True when 2+ consecutive output_validation errors suggest output truncation */
  possibleTruncation: boolean;
}

export interface RetryResult<T> {
  /** Whether the operation succeeded */
  success: boolean;
  /** The result if successful */
  result?: T;
  /** Error message if all retries failed */
  error?: string;
  /** Number of attempts made */
  attempts: number;
  /** Whether the final error was a policy error */
  wasPolicyError: boolean;
  /** Classification of the final error (if any) */
  finalClassification?: RetryClassification;
  /** Response body from last 429 error (for diagnostics) */
  lastResponseBody?: unknown;
}

/**
 * Patterns that indicate a content policy/moderation error from Azure OpenAI.
 * These errors are often transient and worth retrying.
 */
const POLICY_ERROR_PATTERNS = [
  'usage policy',
  'content policy',
  'flagged as potentially violating',
  'content_filter',
  'content_policy_violation',
  'responsibleaipolicy',
  'content management policy',
];

/**
 * Patterns that indicate a transient/retryable error (not policy, but still worth retrying).
 * Includes null output, timeouts, rate limits, and server errors.
 */
const RETRYABLE_ERROR_PATTERNS = [
  'invalid output',
  'no output',
  'timeout',
  'econnreset',
  'econnrefused',
  'socket hang up',
  'network error',
  '429',
  'rate limit',
  'too many requests',
  'throttl',
  '502',
  '503',
  '504',
  'service unavailable',
  'bad gateway',
  'gateway timeout',
  'could not parse the json body of your request',
  'expects a json payload',
];

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value);
}

function extractAzureErrorCodeFromResponseBody(responseBody: unknown): string {
  try {
    if (!responseBody) return '';
    if (typeof responseBody === 'string') return responseBody.toLowerCase();
    if (typeof responseBody === 'object') {
      const body = responseBody as Record<string, unknown>;
      const directCode = typeof body.code === 'string' ? body.code : '';
      const directMessage = typeof body.message === 'string' ? body.message : '';
      // Azure often wraps as { error: { code, message } }
      const nested = typeof body.error === 'object' && body.error !== null ? (body.error as Record<string, unknown>) : null;
      const nestedCode = nested && typeof nested.code === 'string' ? nested.code : '';
      const nestedMessage = nested && typeof nested.message === 'string' ? nested.message : '';
      return `${directCode} ${nestedCode} ${directMessage} ${nestedMessage}`.toLowerCase();
    }
    return String(responseBody).toLowerCase();
  } catch {
    return '';
  }
}

function unwrapErrorChain(error: unknown): Error[] {
  const chain: Error[] = [];

  const add = (e: unknown) => {
    if (!e) return;
    chain.push(toError(e));
  };

  if (RetryError.isInstance(error)) {
    // Prefer lastError (most actionable), but keep the full list for classification.
    add(error.lastError);
    for (const e of error.errors || []) add(e);
    return chain.length > 0 ? chain : [toError(error)];
  }

  if (NoOutputGeneratedError.isInstance(error)) {
    add(error);
    if (error.cause) add(error.cause);
    return chain;
  }

  // For other errors, follow `cause` if present.
  const root = toError(error);
  chain.push(root);
  const anyRoot = root as unknown as { cause?: unknown };
  if (anyRoot && anyRoot.cause) {
    add(anyRoot.cause);
  }
  return chain;
}

/**
 * Check if an error is a rate limit error (needs longer backoff).
 */
export function isRateLimitError(error: unknown): boolean {
  if (!error) return false;
  const chain = unwrapErrorChain(error);
  for (const e of chain) {
    if (APICallError.isInstance(e)) {
      if (e.statusCode === 429) return true;
      // Some providers omit statusCode but set isRetryable for rate limits; fall back to message.
    }
    const msg = e.message.toLowerCase();
    if (msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('throttl')) {
      return true;
    }
  }
  return false;
}

/**
 * Check if an error is a content policy/moderation error.
 */
export function isPolicyError(error: unknown): boolean {
  if (!error) return false;
  const chain = unwrapErrorChain(error);
  for (const e of chain) {
    if (APICallError.isInstance(e)) {
      // Azure content filtering commonly returns HTTP 400 with code "content_filter".
      if (e.statusCode === 400) {
        const codeText = extractAzureErrorCodeFromResponseBody(e.responseBody);
        if (codeText.includes('content_filter') || codeText.includes('content filter') || codeText.includes('responsibleai')) {
          return true;
        }
      }
    }
    const msg = e.message.toLowerCase();
    if (POLICY_ERROR_PATTERNS.some(pattern => msg.includes(pattern))) return true;
  }
  return false;
}

/**
 * Check if an error is retryable (policy error OR transient error).
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;
  const classification = classifyRetry(error);
  return classification !== 'non_retryable';
}

function classifyRetry(error: unknown): RetryClassification {
  if (!error) return 'non_retryable';

  // Output/schema validation failures are retryable (agent can often correct on retry).
  if (TypeValidationError.isInstance(error) || JSONParseError.isInstance(error) || NoObjectGeneratedError.isInstance(error)) {
    return 'output_validation';
  }

  const chain = unwrapErrorChain(error);
  for (const e of chain) {
    const msg = e.message.toLowerCase();
    if (msg.includes('invalid variables:')) {
      return 'output_validation';
    }
  }

  if (isRateLimitError(error)) return 'rate_limit';
  if (isPolicyError(error)) return 'policy';

  for (const e of chain) {
    if (APICallError.isInstance(e)) {
      // Respect the SDK's isRetryable when available.
      if (e.isRetryable) return 'transient';
      const status = e.statusCode;
      if (status && status >= 500) return 'transient';
      if (status === 408) return 'transient';
      // 409/425 can be transient in some infrastructures; treat as transient.
      if (status === 409 || status === 425) return 'transient';
      // 400/401/403/404 etc: generally non-retryable (unless policy, handled above).
    }

    const msg = e.message.toLowerCase();
    if (RETRYABLE_ERROR_PATTERNS.some(pattern => msg.includes(pattern))) return 'transient';
  }

  // Treat "no output generated" as retryable because it often wraps transient issues.
  if (NoOutputGeneratedError.isInstance(error)) return 'output_validation';

  return 'non_retryable';
}

function summarizeErrorForRetry(error: unknown): { summary: string; responseBody?: unknown } {
  const chain = unwrapErrorChain(error);
  const top = chain[0];
  if (APICallError.isInstance(top)) {
    const codeText = extractAzureErrorCodeFromResponseBody(top.responseBody);
    const status = top.statusCode ? `HTTP ${top.statusCode}` : 'HTTP ?';
    const code = codeText ? ` | ${codeText.substring(0, 120)}` : '';
    const summary = `${status}${code}`.trim();
    // Capture response body for 429 diagnostics
    const responseBody = top.statusCode === 429 ? top.responseBody : undefined;
    return { summary, responseBody };
  }
  return { summary: getErrorMessage(error).substring(0, 200) };
}

/**
 * Extract the server-suggested retry delay from a 429 error.
 *
 * Handles both providers:
 * - Azure:  "Please retry after 17 seconds."
 * - OpenAI: "Please try again in 6s." or "Please try again in 0.015s."
 *
 * Returns delay in milliseconds, or 0 if not found.
 */
function extractRetryAfterMs(error: unknown): number {
  if (!error) return 0;

  const chain = unwrapErrorChain(error);
  for (const e of chain) {
    const ms = parseRetryAfterFromText(e.message);
    if (ms > 0) return ms;

    // Check the response body (both Azure and OpenAI wrap as { error: { message: "..." } })
    if (APICallError.isInstance(e) && e.responseBody) {
      try {
        const bodyStr = typeof e.responseBody === 'string'
          ? e.responseBody
          : JSON.stringify(e.responseBody);
        const bodyMs = parseRetryAfterFromText(bodyStr);
        if (bodyMs > 0) return bodyMs;
      } catch {
        // ignore parse errors
      }
    }
  }
  return 0;
}

/**
 * Parse retry delay from error text. Supports:
 * - "retry after 17 seconds" (Azure)
 * - "try again in 6s" (OpenAI, whole seconds)
 * - "try again in 0.015s" (OpenAI, fractional seconds)
 * - "try again in 1m30s" (OpenAI, minutes+seconds, rare)
 */
function parseRetryAfterFromText(text: string): number {
  if (!text) return 0;

  // Azure: "retry after N seconds"
  const azureMatch = text.match(/retry after (\d+) second/i);
  if (azureMatch) return parseInt(azureMatch[1], 10) * 1000;

  // OpenAI: "try again in Ns" or "try again in N.NNNs"
  const openaiMatch = text.match(/try again in (\d+\.?\d*)s/i);
  if (openaiMatch) return Math.ceil(parseFloat(openaiMatch[1]) * 1000);

  // OpenAI: "try again in NmNs" (e.g., "1m30s")
  const openaiMinMatch = text.match(/try again in (\d+)m(\d+\.?\d*)s/i);
  if (openaiMinMatch) {
    const mins = parseInt(openaiMinMatch[1], 10);
    const secs = parseFloat(openaiMinMatch[2]);
    return Math.ceil((mins * 60 + secs) * 1000);
  }

  return 0;
}

function computeDelayMs(args: {
  classification: RetryClassification;
  attempt: number;
  baseDelayMs: number;
  rateLimitDelayMs: number;
  policyDelayMs: number;
  maxDelayMs: number;
  rateLimitMaxDelayMs: number;
  policyMaxDelayMs: number;
  random: () => number;
  serverRetryAfterMs?: number;
}): number {
  const {
    classification,
    attempt,
    baseDelayMs,
    rateLimitDelayMs,
    policyDelayMs,
    maxDelayMs,
    rateLimitMaxDelayMs,
    policyMaxDelayMs,
    random,
    serverRetryAfterMs,
  } = args;

  const exp = Math.pow(2, Math.max(0, attempt - 1));
  let rawDelay: number;
  if (classification === 'rate_limit') {
    rawDelay = Math.min(rateLimitMaxDelayMs, rateLimitDelayMs * exp);
  } else if (classification === 'policy') {
    // Policy errors are stochastic — the same prompt often passes on retry.
    // Use a short, gently-growing delay (just enough to avoid hammering).
    rawDelay = Math.min(policyMaxDelayMs, policyDelayMs * exp);
  } else {
    rawDelay = Math.min(maxDelayMs, baseDelayMs * exp);
  }

  // Equal jitter: [raw/2, raw]
  const jittered = Math.floor(rawDelay / 2 + random() * (rawDelay / 2));
  const computed = Math.max(250, jittered); // never hammer the API at 0ms

  // For rate limits: if Azure told us how long to wait, respect that as a floor
  // Add 1s buffer to avoid retrying right at the boundary
  if (serverRetryAfterMs && serverRetryAfterMs > 0) {
    const serverWithBuffer = serverRetryAfterMs + 1000;
    if (serverWithBuffer > computed) {
      return serverWithBuffer;
    }
  }

  return computed;
}

/**
 * Sleep for the specified duration, respecting abort signal.
 */
async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'));
      return;
    }

    const timeout = setTimeout(resolve, ms);

    signal?.addEventListener('abort', () => {
      clearTimeout(timeout);
      reject(new Error('Aborted'));
    }, { once: true });
  });
}

/**
 * Execute an async function with retry logic for retryable errors.
 *
 * @example
 * ```typescript
 * const result = await retryWithPolicyHandling(
 *   async (ctx) => {
 *     const { output } = await generateText({ ... });
 *     return output;
 *   },
 *   {
 *     maxAttempts: 10,
 *     onRetryWithContext: (ctx, err, delayMs) => {
 *       console.warn(`Retry ${ctx.attempt}/${ctx.maxAttempts}: ${ctx.lastClassification} (${delayMs}ms): ${err.message}`);
 *     }
 *   }
 * );
 *
 * if (result.success) {
 *   // Use result.result
 * } else {
 *   // Handle failure, result.error contains message
 * }
 * ```
 */
export async function retryWithPolicyHandling<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<RetryResult<T>>;
export async function retryWithPolicyHandling<T>(fn: (context: RetryContext) => Promise<T>, options?: RetryOptions): Promise<RetryResult<T>>;
export async function retryWithPolicyHandling<T>(
  fn: (() => Promise<T>) | ((context: RetryContext) => Promise<T>),
  options?: RetryOptions
): Promise<RetryResult<T>> {
  const maxAttempts = options?.maxAttempts ?? 10;
  const baseDelayMs = options?.delayMs ?? 2000;
  const rateLimitDelayMs = options?.rateLimitDelayMs ?? 15000;
  const policyDelayMs = options?.policyDelayMs ?? 500;
  const maxDelayMs = options?.maxDelayMs ?? 30000;
  const rateLimitMaxDelayMs = options?.rateLimitMaxDelayMs ?? 120000;
  const policyMaxDelayMs = options?.policyMaxDelayMs ?? 2000;
  const policyRetryMode = options?.policyRetryMode ?? 'ai';
  const policySafeAfterAttempt = options?.policySafeAfterAttempt ?? 9;
  const random = options?.random ?? Math.random;
  const circuitBreaker = options?.circuitBreaker ?? getPipelineContext()?.resilience.circuitBreaker ?? null;
  const onRetry = options?.onRetry;
  const onRetryWithContext = options?.onRetryWithContext;
  const abortSignal = options?.abortSignal;

  let lastError: Error | undefined;
  let lastClassification: RetryClassification = 'non_retryable';
  let lastErrorSummary = '';
  let lastResponseBody: unknown;
  let policyErrorCount = 0;
  let consecutiveOutputValidationErrors = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Check for abort before each attempt
    if (abortSignal?.aborted) {
      return {
        success: false,
        error: 'Operation was cancelled',
        attempts: attempt - 1,
        wasPolicyError: false,
        finalClassification: 'non_retryable',
      };
    }

    const context: RetryContext = {
      attempt,
      maxAttempts,
      lastClassification,
      lastErrorSummary,
      shouldUsePolicySafeVariant: policyErrorCount > 0 && attempt >= policySafeAfterAttempt,
      isFinalAttempt: attempt === maxAttempts,
      lastResponseBody,
      consecutiveOutputValidationErrors,
      possibleTruncation: consecutiveOutputValidationErrors >= 2,
    };

    try {
      const result = await (fn as (c: RetryContext) => Promise<T>)(context);
      circuitBreaker?.recordSuccess();
      return {
        success: true,
        result,
        attempts: attempt,
        wasPolicyError: false,
      };
    } catch (error) {
      lastError = toError(error);
      lastClassification = classifyRetry(error);
      const errorInfo = summarizeErrorForRetry(error);
      lastErrorSummary = errorInfo.summary;
      lastResponseBody = errorInfo.responseBody;

      if (lastClassification === 'policy') policyErrorCount++;

      // Track consecutive output_validation errors (suggests truncation)
      if (lastClassification === 'output_validation') {
        consecutiveOutputValidationErrors++;
      } else {
        consecutiveOutputValidationErrors = 0;
      }

      // Log 429 response body for diagnostics
      if (lastResponseBody) {
        const retryAfterSec = lastClassification === 'rate_limit'
          ? extractRetryAfterMs(error) / 1000
          : 0;
        console.warn(
          `[retryWithPolicyHandling] 429 response body: ${JSON.stringify(lastResponseBody).substring(0, 500)}`
          + (retryAfterSec > 0 ? ` | server says retry after ${retryAfterSec}s` : '')
        );
      }

      // Notify circuit breaker (may abort the pipeline signal)
      circuitBreaker?.recordFailure(lastClassification, lastErrorSummary);

      // Only retry on retryable errors
      if (lastClassification === 'non_retryable') {
        return {
          success: false,
          error: lastError.message,
          attempts: attempt,
          wasPolicyError: isPolicyError(error),
          finalClassification: lastClassification,
          lastResponseBody,
        };
      }

      // Some callers want deterministic handling on policy blocks:
      // classify + return immediately so the caller can reuse prior output
      // or build a deterministic fallback without re-calling the model.
      if (lastClassification === 'policy' && policyRetryMode !== 'ai') {
        return {
          success: false,
          error: lastError.message,
          attempts: attempt,
          wasPolicyError: true,
          finalClassification: lastClassification,
          lastResponseBody,
        };
      }

      // Don't retry if this was the last attempt
      if (attempt === maxAttempts) {
        break;
      }

      // Extract server-suggested retry delay from Azure 429 responses
      const serverRetryAfterMs = lastClassification === 'rate_limit'
        ? extractRetryAfterMs(error)
        : 0;

      const nextDelayMs = computeDelayMs({
        classification: lastClassification,
        attempt,
        baseDelayMs,
        rateLimitDelayMs,
        policyDelayMs,
        maxDelayMs,
        rateLimitMaxDelayMs,
        policyMaxDelayMs,
        random,
        serverRetryAfterMs,
      });

      // Notify about retry
      onRetry?.(attempt, lastError);
      onRetryWithContext?.(
        {
          attempt,
          maxAttempts,
          lastClassification,
          lastErrorSummary,
          shouldUsePolicySafeVariant: policyErrorCount > 0 && (attempt + 1) >= policySafeAfterAttempt,
          isFinalAttempt: false,
          lastResponseBody,
          consecutiveOutputValidationErrors,
          possibleTruncation: consecutiveOutputValidationErrors >= 2,
        },
        lastError,
        nextDelayMs
      );

      // Wait before retrying
      try {
        await sleep(nextDelayMs, abortSignal);
      } catch {
        // Aborted during sleep
        return {
          success: false,
          error: 'Operation was cancelled',
          attempts: attempt,
          wasPolicyError: true,
          finalClassification: lastClassification,
          lastResponseBody,
        };
      }
    }
  }

  // All retries exhausted
  return {
    success: false,
    error: lastError?.message ?? 'Unknown error after retries',
    attempts: maxAttempts,
    wasPolicyError: isPolicyError(lastError),
    finalClassification: lastClassification,
    lastResponseBody,
  };
}
