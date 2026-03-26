/**
 * @temporary — Feature gates for hiding unreleased UI in production.
 *
 * Remove this file (and all call sites) when pricing and demo are ready
 * for production. Search the codebase for "featureGates" or "@temporary"
 * to find every usage.
 *
 * Gated features:
 *  - /pricing page + nav links
 *  - /demo page + nav links + landing page CTAs
 *  - BillingSection "View Plans" link
 */

/**
 * Returns `true` when preview features (pricing, demo) should be visible.
 * Gated on the PREVIEW_FEATURES env var so it works correctly in deployed
 * environments where NODE_ENV is always 'production' (Next.js optimizations).
 *
 * Set NEXT_PUBLIC_PREVIEW_FEATURES=true in Railway for staging; omit it for production.
 * Locally, it falls back to NODE_ENV !== 'production' for convenience.
 *
 * @temporary — remove when these features are production-ready.
 */
export function isPreviewFeatureEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_PREVIEW_FEATURES !== undefined) {
    return process.env.NEXT_PUBLIC_PREVIEW_FEATURES === 'true';
  }
  return process.env.NODE_ENV !== 'production';
}
