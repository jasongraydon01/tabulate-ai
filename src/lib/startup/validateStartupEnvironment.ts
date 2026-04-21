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

const VALID_ANALYSIS_REASONING_EFFORTS = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh'];
const VALID_ANALYSIS_TEXT_VERBOSITY = ['low', 'medium', 'high'];
const VALID_ANALYSIS_REASONING_SUMMARIES = ['auto', 'detailed'];

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
  const aiProvider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
  const analysisAiProvider = process.env.ANALYSIS_AI_PROVIDER?.toLowerCase();

  if (aiProvider === 'azure') {
    requireVar('AZURE_API_KEY', errors);
    requireVar('AZURE_RESOURCE_NAME', errors);
  } else if (aiProvider === 'openai') {
    requireVar('OPENAI_API_KEY', errors);
  } else {
    errors.push(`Unknown AI_PROVIDER: "${aiProvider}" (expected "azure" or "openai")`);
  }

  if (analysisAiProvider) {
    if (!['azure', 'openai', 'anthropic'].includes(analysisAiProvider)) {
      errors.push(`Unknown ANALYSIS_AI_PROVIDER: "${analysisAiProvider}" (expected "azure", "openai", or "anthropic")`);
    } else if (analysisAiProvider === 'azure') {
      requireVar('AZURE_API_KEY', errors);
      requireVar('AZURE_RESOURCE_NAME', errors);
    } else if (analysisAiProvider === 'openai') {
      requireVar('OPENAI_API_KEY', errors);
    } else if (analysisAiProvider === 'anthropic') {
      requireVar('ANTHROPIC_API_KEY', errors);
    }
  }

  if (
    process.env.ANALYSIS_REASONING_EFFORT
    && !VALID_ANALYSIS_REASONING_EFFORTS.includes(process.env.ANALYSIS_REASONING_EFFORT.toLowerCase())
  ) {
    warnings.push(`ANALYSIS_REASONING_EFFORT "${process.env.ANALYSIS_REASONING_EFFORT}" is invalid; analysis will use the provider default`);
  }

  if (
    process.env.ANALYSIS_TITLE_REASONING_EFFORT
    && !VALID_ANALYSIS_REASONING_EFFORTS.includes(process.env.ANALYSIS_TITLE_REASONING_EFFORT.toLowerCase())
  ) {
    warnings.push(`ANALYSIS_TITLE_REASONING_EFFORT "${process.env.ANALYSIS_TITLE_REASONING_EFFORT}" is invalid; analysis titles will use the default`);
  }

  if (
    process.env.ANALYSIS_TEXT_VERBOSITY
    && !VALID_ANALYSIS_TEXT_VERBOSITY.includes(process.env.ANALYSIS_TEXT_VERBOSITY.toLowerCase())
  ) {
    warnings.push(`ANALYSIS_TEXT_VERBOSITY "${process.env.ANALYSIS_TEXT_VERBOSITY}" is invalid; analysis will use the provider default`);
  }

  if (
    process.env.ANALYSIS_REASONING_SUMMARY
    && !VALID_ANALYSIS_REASONING_SUMMARIES.includes(process.env.ANALYSIS_REASONING_SUMMARY.toLowerCase())
  ) {
    warnings.push(`ANALYSIS_REASONING_SUMMARY "${process.env.ANALYSIS_REASONING_SUMMARY}" is invalid; analysis will use the provider default`);
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
