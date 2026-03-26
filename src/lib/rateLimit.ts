/**
 * In-memory sliding-window rate limiter.
 *
 * Tiered by route cost, keyed by orgId + routeKey.
 * Designed for Railway (long-lived process). If deployment shifts to
 * Vercel serverless, swap the in-memory store for Upstash Redis
 * while keeping the same `checkRateLimit` interface.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RateLimitTier = 'critical' | 'high' | 'medium' | 'low' | 'demo';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;       // Unix ms when the current window resets
  retryAfter?: number;   // Seconds until next request is allowed (only set when blocked)
}

interface TierConfig {
  requests: number;
  windowMs: number;
}

// ---------------------------------------------------------------------------
// Tier configuration
// ---------------------------------------------------------------------------

const TIER_CONFIGS: Record<RateLimitTier, TierConfig> = {
  critical: { requests: 5,  windowMs: 10 * 60 * 1000 }, // 5 req / 10 min
  high:     { requests: 15, windowMs: 60 * 1000 },       // 15 req / 1 min
  medium:   { requests: 30, windowMs: 60 * 1000 },       // 30 req / 1 min
  low:      { requests: 60, windowMs: 60 * 1000 },       // 60 req / 1 min
  demo:     { requests: 5,  windowMs: 60 * 60 * 1000 }, // 5 req / 1 hour (per IP)
};

const DEV_MULTIPLIER = 10;

function getTierConfig(tier: RateLimitTier): TierConfig {
  const base = TIER_CONFIGS[tier];
  const isDev = process.env.NODE_ENV === 'development';
  return isDev
    ? { requests: base.requests * DEV_MULTIPLIER, windowMs: base.windowMs }
    : base;
}

// ---------------------------------------------------------------------------
// Sliding-window store
// ---------------------------------------------------------------------------

/** Timestamps of requests within the current window */
const store = new Map<string, number[]>();

/**
 * Safety cap on the number of distinct keys in the store.
 * At ~80 users across ~5 orgs hitting ~13 routes, normal usage is ~65 keys.
 * 10,000 gives >100x headroom while still preventing unbounded growth.
 */
const MAX_STORE_SIZE = 10_000;

/**
 * Check (and record) a rate limit hit.
 *
 * @param orgId    - Organization identifier (from Convex auth)
 * @param tier     - Cost tier for this route
 * @param routeKey - Unique route identifier (e.g. "projects/launch")
 * @returns        - Whether the request is allowed, plus metadata
 */
export function checkRateLimit(
  orgId: string,
  tier: RateLimitTier,
  routeKey: string,
): RateLimitResult {
  const config = getTierConfig(tier);
  const key = `${orgId}:${routeKey}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  // Get existing timestamps, prune expired
  let timestamps = store.get(key) ?? [];
  timestamps = timestamps.filter(t => t > windowStart);

  const resetAt = now + config.windowMs;

  if (timestamps.length >= config.requests) {
    // Blocked — calculate when the oldest request in the window expires
    const oldestInWindow = timestamps[0];
    const retryAfterMs = (oldestInWindow + config.windowMs) - now;
    const retryAfter = Math.ceil(retryAfterMs / 1000);

    store.set(key, timestamps);

    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: Math.max(retryAfter, 1),
    };
  }

  // Reject if the store has hit the safety cap and this is a new key.
  // Existing keys are always allowed through — the cap only prevents new entries.
  if (!store.has(key) && store.size >= MAX_STORE_SIZE) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfter: 60,
    };
  }

  // Allowed — record this request
  timestamps.push(now);
  store.set(key, timestamps);

  return {
    allowed: true,
    remaining: config.requests - timestamps.length,
    resetAt,
  };
}

// ---------------------------------------------------------------------------
// Cleanup interval — prevent unbounded memory growth
// ---------------------------------------------------------------------------

const CLEANUP_INTERVAL_MS = 60_000; // 1 minute

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    // The longest window is 10 minutes (critical tier)
    const maxWindowMs = 10 * 60 * 1000;
    const cutoff = now - maxWindowMs;

    for (const [key, timestamps] of store) {
      const fresh = timestamps.filter(t => t > cutoff);
      if (fresh.length === 0) {
        store.delete(key);
      } else {
        store.set(key, fresh);
      }
    }
  }, CLEANUP_INTERVAL_MS);

  // Allow the process to exit without waiting for the timer
  if (cleanupTimer && typeof cleanupTimer === 'object' && 'unref' in cleanupTimer) {
    cleanupTimer.unref();
  }
}

/** Stop the cleanup interval. Call in test teardown to prevent timer leaks. */
export function stopCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}

// Start cleanup on module load
startCleanup();
