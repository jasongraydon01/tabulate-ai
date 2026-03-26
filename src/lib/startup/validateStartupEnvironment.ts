/**
 * Tier 1 startup validation: synchronous env var presence checks.
 *
 * This module is deliberately isolated from src/lib/env.ts to avoid pulling
 * in heavy AI SDK provider imports during the instrumentation hook.
 * It reads process.env directly — no network calls, no side effects.
 */

export interface StartupValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

function requireVar(
  name: string,
  errors: string[],
): boolean {
  if (!process.env[name]) {
    errors.push(`Missing required environment variable: ${name}`);
    return false;
  }
  return true;
}

function requireVarProdOnly(
  name: string,
  errors: string[],
  warnings: string[],
): boolean {
  if (!process.env[name]) {
    if (process.env.NODE_ENV === 'production') {
      errors.push(`Missing required environment variable: ${name}`);
      return false;
    } else {
      warnings.push(`${name} is not set (required in production)`);
      return false;
    }
  }
  return true;
}

export function validateStartupEnvironment(): StartupValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── AI Provider ──────────────────────────────────────────────────────
  const aiProvider = (process.env.AI_PROVIDER || 'azure').toLowerCase();

  if (aiProvider === 'azure') {
    requireVar('AZURE_API_KEY', errors);
    requireVar('AZURE_RESOURCE_NAME', errors);
  } else if (aiProvider === 'openai') {
    requireVar('OPENAI_API_KEY', errors);
  } else {
    errors.push(`Unknown AI_PROVIDER: "${aiProvider}" (expected "azure" or "openai")`);
  }

  // ── Convex ───────────────────────────────────────────────────────────
  if (requireVar('CONVEX_URL', errors)) {
    try {
      new URL(process.env.CONVEX_URL!);
    } catch {
      errors.push(`CONVEX_URL is not a valid URL: "${process.env.CONVEX_URL}"`);
    }
  }

  requireVarProdOnly('CONVEX_DEPLOY_KEY', errors, warnings);

  // ── Cloudflare R2 ────────────────────────────────────────────────────
  requireVar('R2_ACCOUNT_ID', errors);
  requireVar('R2_ACCESS_KEY_ID', errors);
  requireVar('R2_SECRET_ACCESS_KEY', errors);
  requireVar('R2_BUCKET_NAME', errors);

  // ── Authentication ───────────────────────────────────────────────────
  const authBypass = process.env.AUTH_BYPASS === 'true';
  const hasWorkOS = !!(process.env.WORKOS_CLIENT_ID && process.env.WORKOS_API_KEY);

  if (authBypass && process.env.NODE_ENV === 'production') {
    errors.push('AUTH_BYPASS=true is not allowed in production');
  }

  if (!authBypass && !hasWorkOS) {
    errors.push(
      'No authentication strategy configured. Set AUTH_BYPASS=true (dev only) or provide WORKOS_CLIENT_ID + WORKOS_API_KEY',
    );
  }

  // ── Billing (Stripe) ────────────────────────────────────────────────
  requireVarProdOnly('STRIPE_SECRET_KEY', errors, warnings);
  requireVarProdOnly('STRIPE_WEBHOOK_SECRET', errors, warnings);
  requireVarProdOnly('STRIPE_METER_ID', errors, warnings);
  requireVarProdOnly('STRIPE_PRICE_PAYG', errors, warnings);
  requireVarProdOnly('STRIPE_PRICE_PAYG_METERED', errors, warnings);
  requireVarProdOnly('STRIPE_PRICE_STARTER', errors, warnings);
  requireVarProdOnly('STRIPE_PRICE_STARTER_METERED', errors, warnings);
  requireVarProdOnly('STRIPE_PRICE_PROFESSIONAL', errors, warnings);
  requireVarProdOnly('STRIPE_PRICE_PROFESSIONAL_METERED', errors, warnings);
  requireVarProdOnly('STRIPE_PRICE_STUDIO', errors, warnings);
  requireVarProdOnly('STRIPE_PRICE_STUDIO_METERED', errors, warnings);

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
