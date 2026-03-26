/**
 * Thin helper for API routes — calls checkRateLimit and returns a 429
 * NextResponse with standard headers, or null if the request is allowed.
 */
import { NextResponse } from 'next/server';
import { checkRateLimit, type RateLimitTier } from './rateLimit';

/**
 * Apply rate limiting to an API route.
 *
 * @returns `null` if allowed, or a 429 `NextResponse` if rate-limited.
 *
 * Usage (in a route handler, after auth):
 * ```ts
 * const limited = applyRateLimit(String(auth.convexOrgId), 'critical', 'projects/launch');
 * if (limited) return limited;
 * ```
 */
export function applyRateLimit(
  orgId: string,
  tier: RateLimitTier,
  routeKey: string,
): NextResponse | null {
  const result = checkRateLimit(orgId, tier, routeKey);

  if (result.allowed) {
    return null;
  }

  return NextResponse.json(
    { error: 'Too many requests. Please try again later.' },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfter ?? 60),
        'X-RateLimit-Remaining': '0',
        'X-RateLimit-Reset': String(Math.ceil(result.resetAt / 1000)),
      },
    },
  );
}
