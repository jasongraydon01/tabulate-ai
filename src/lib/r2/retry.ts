/**
 * Retry utility for R2 operations.
 *
 * Provides exponential backoff for transient S3/R2 errors (503, 429,
 * connection resets, timeouts). Separate from retryWithPolicyHandling
 * which is AI-specific (content policy, circuit breakers, etc.).
 */

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 1000;

/** Error codes / status codes that indicate a transient failure worth retrying. */
const TRANSIENT_ERROR_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',       // DNS resolution transient
  'RequestTimeout',
  'SlowDown',        // S3 rate limit
  'ServiceUnavailable',
  'InternalError',
  'ThrottlingException',
];

function isTransientError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  const err = error as Record<string, unknown>;

  // AWS SDK error with status code
  const statusCode = err['$metadata']
    ? (err['$metadata'] as Record<string, unknown>)['httpStatusCode']
    : err['statusCode'] ?? err['status'];
  if (typeof statusCode === 'number' && (statusCode === 429 || statusCode === 503 || statusCode >= 500)) {
    return true;
  }

  // Node-level network errors
  const code = err['code'] ?? err['name'] ?? '';
  const message = err['message'] ?? '';
  const errorStr = `${code} ${message}`;

  return TRANSIENT_ERROR_PATTERNS.some((pattern) => errorStr.includes(pattern));
}

export interface RetryR2Options {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Base delay in ms — doubles each retry (default: 1000 → 1s, 2s, 4s) */
  baseDelayMs?: number;
  /** Label for log messages (e.g., the R2 key being uploaded) */
  label?: string;
}

export interface RetryR2Result<T> {
  result: T;
  /** Number of retries that were needed (0 = succeeded first try) */
  retriesUsed: number;
}

/**
 * Execute an R2 operation with exponential backoff on transient failures.
 *
 * Retries up to `maxRetries` times with delays of baseDelay * 2^attempt.
 * Only retries errors that look transient (network, 5xx, rate limit).
 * Non-transient errors are thrown immediately.
 */
export async function retryR2Operation<T>(
  operation: () => Promise<T>,
  options: RetryR2Options = {},
): Promise<RetryR2Result<T>> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const label = options.label ?? 'R2 operation';

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      return { result, retriesUsed: attempt };
    } catch (error) {
      lastError = error;

      // Don't retry non-transient errors
      if (!isTransientError(error)) {
        throw error;
      }

      // Don't retry if we've exhausted attempts
      if (attempt >= maxRetries) {
        break;
      }

      const delayMs = baseDelayMs * Math.pow(2, attempt);
      console.warn(
        `[R2 Retry] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delayMs}ms: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      await sleep(delayMs);
    }
  }

  // All retries exhausted — throw with context
  const msg = `[R2 Retry] ${label} failed after ${maxRetries + 1} attempts`;
  console.error(msg);

  if (lastError instanceof Error) {
    lastError.message = `${msg}: ${lastError.message}`;
    throw lastError;
  }
  throw new Error(`${msg}: ${String(lastError)}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Exported for testing
export { isTransientError as _isTransientError };
