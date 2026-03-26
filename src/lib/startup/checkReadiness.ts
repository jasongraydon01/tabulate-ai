/**
 * Tier 2 readiness checks: async dependency probes.
 *
 * Called by the /api/ready route. Each check has its own timeout.
 * Results are cached for 10 seconds to avoid hammering dependencies
 * every time Docker or Railway pings the readiness endpoint.
 */

import { validateStartupEnvironment } from './validateStartupEnvironment';
import { findRscriptAsync } from './findRscriptBinary';

export interface ReadinessCheck {
  name: string;
  status: 'pass' | 'fail';
  latencyMs: number;
  error?: string;
}

export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessCheck[];
}

// ── Cache ────────────────────────────────────────────────────────────────
const CACHE_TTL_MS = 10_000;
let cachedResult: ReadinessResult | null = null;
let cachedAt = 0;

/** Exposed for testing — resets the readiness cache. */
export function _resetCache(): void {
  cachedResult = null;
  cachedAt = 0;
}

// ── Individual checks ────────────────────────────────────────────────────

async function checkEnvValidation(): Promise<ReadinessCheck> {
  const start = Date.now();
  const result = validateStartupEnvironment();
  return {
    name: 'env_validation',
    status: result.valid ? 'pass' : 'fail',
    latencyMs: Date.now() - start,
    ...(result.valid ? {} : { error: result.errors.join('; ') }),
  };
}

async function checkConvex(): Promise<ReadinessCheck> {
  const start = Date.now();
  const convexUrl = process.env.CONVEX_URL;
  if (!convexUrl) {
    return { name: 'convex', status: 'fail', latencyMs: 0, error: 'CONVEX_URL not set' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(convexUrl, {
      method: 'HEAD',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    // Convex returns 405 for HEAD — that still proves connectivity
    const ok = res.ok || res.status === 405;
    return {
      name: 'convex',
      status: ok ? 'pass' : 'fail',
      latencyMs: Date.now() - start,
      ...(!ok ? { error: `Unexpected status: ${res.status}` } : {}),
    };
  } catch (err) {
    return {
      name: 'convex',
      status: 'fail',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Connection failed',
    };
  }
}

async function checkRscript(): Promise<ReadinessCheck> {
  const start = Date.now();
  try {
    const result = await findRscriptAsync();
    if (result) {
      return { name: 'rscript', status: 'pass', latencyMs: Date.now() - start };
    }
    return {
      name: 'rscript',
      status: 'fail',
      latencyMs: Date.now() - start,
      error: 'No working Rscript binary found',
    };
  } catch (err) {
    return {
      name: 'rscript',
      status: 'fail',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Rscript check failed',
    };
  }
}

async function checkR2(): Promise<ReadinessCheck> {
  const start = Date.now();
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET_NAME;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) {
    return {
      name: 'r2',
      status: 'fail',
      latencyMs: 0,
      error: 'R2 credentials not configured',
    };
  }

  try {
    // Lazy import to keep module load fast — @aws-sdk/client-s3 is heavy
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');

    const client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    await client.send(
      new HeadBucketCommand({ Bucket: bucket }),
      { abortSignal: controller.signal },
    );
    clearTimeout(timeout);

    return { name: 'r2', status: 'pass', latencyMs: Date.now() - start };
  } catch (err) {
    return {
      name: 'r2',
      status: 'fail',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'R2 check failed',
    };
  }
}

// ── Main readiness function ──────────────────────────────────────────────

export async function checkReadiness(): Promise<ReadinessResult> {
  // Return cached result if fresh
  if (cachedResult && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedResult;
  }

  // Run all checks in parallel
  const checks = await Promise.all([
    checkEnvValidation(),
    checkConvex(),
    checkRscript(),
    checkR2(),
  ]);

  const ready = checks.every((c) => c.status === 'pass');
  const result: ReadinessResult = { ready, checks };

  // Cache the result
  cachedResult = result;
  cachedAt = Date.now();

  return result;
}
