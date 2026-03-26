/**
 * Shared Sentry event scrubbing — strips sensitive data before events are sent.
 *
 * Applied via `beforeSend` in all three Sentry configs (server, edge, client).
 */

import type { ErrorEvent } from '@sentry/nextjs';

const SENSITIVE_KEY_PATTERNS = [
  'key',
  'secret',
  'password',
  'token',
  'dsn',
  'authorization',
  'cookie',
  'credential',
  'api_key',
  'apikey',
  'access_token',
  'refresh_token',
  'session_id',
];

const SENSITIVE_HEADER_KEYS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-forwarded-for',
  'x-real-ip',
]);

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/**
 * Recursively scrub sensitive keys from an object (max depth 5).
 */
function scrubObject(obj: Record<string, unknown>, depth = 0): void {
  if (depth > 5) return;

  for (const key of Object.keys(obj)) {
    if (isSensitiveKey(key)) {
      obj[key] = '[REDACTED]';
    } else if (obj[key] && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
      scrubObject(obj[key] as Record<string, unknown>, depth + 1);
    }
  }
}

/**
 * Sentry beforeSend hook that strips sensitive data from events.
 *
 * Scrubs:
 * - event.extra (recursive)
 * - event.contexts (recursive)
 * - event.request headers (Authorization, Cookie, etc.)
 * - event.request data (POST body)
 * - event.breadcrumbs data (recursive)
 */
export function scrubSentryEvent(event: ErrorEvent): ErrorEvent {
  // Scrub extras (recursive)
  if (event.extra && typeof event.extra === 'object') {
    scrubObject(event.extra as Record<string, unknown>);
  }

  // Scrub contexts (recursive)
  if (event.contexts && typeof event.contexts === 'object') {
    for (const ctx of Object.values(event.contexts)) {
      if (ctx && typeof ctx === 'object') {
        scrubObject(ctx as Record<string, unknown>);
      }
    }
  }

  // Scrub request headers and body
  if (event.request) {
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (SENSITIVE_HEADER_KEYS.has(key.toLowerCase())) {
          event.request.headers[key] = '[REDACTED]';
        }
      }
    }
    if (event.request.data) {
      event.request.data = '[REDACTED]';
    }
  }

  // Scrub breadcrumb data
  if (event.breadcrumbs) {
    for (const crumb of event.breadcrumbs) {
      if (crumb.data && typeof crumb.data === 'object') {
        scrubObject(crumb.data as Record<string, unknown>);
      }
    }
  }

  return event;
}
