/**
 * CostCalculator
 *
 * Calculates token costs using LiteLLM's pricing database.
 * Fetches latest pricing on first use, caches for session.
 *
 * Usage:
 *   const cost = await calculateCost('gpt-4o', { input: 1000, output: 500 });
 *   // Returns: { inputCost: 0.0025, outputCost: 0.005, totalCost: 0.0075 }
 */

// =============================================================================
// Types
// =============================================================================

export interface TokenUsage {
  input: number;
  output: number;
}

export interface CostBreakdown {
  inputCost: number;
  outputCost: number;
  totalCost: number;
  model: string;
  tokens: TokenUsage;
}

interface ModelPricing {
  input_cost_per_token?: number;
  output_cost_per_token?: number;
  litellm_provider?: string;
  max_input_tokens?: number;
  max_output_tokens?: number;
}

// =============================================================================
// Pricing Cache
// =============================================================================

const LITELLM_PRICING_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';

let pricingCache: Record<string, ModelPricing> | null = null;
let pricingFetchPromise: Promise<Record<string, ModelPricing>> | null = null;

/**
 * Fetch and cache LiteLLM pricing data
 */
async function fetchPricing(): Promise<Record<string, ModelPricing>> {
  if (pricingCache) {
    return pricingCache;
  }

  // Dedupe concurrent fetches
  if (pricingFetchPromise) {
    return pricingFetchPromise;
  }

  pricingFetchPromise = (async () => {
    try {
      console.log('[CostCalculator] Fetching LiteLLM pricing...');
      const response = await fetch(LITELLM_PRICING_URL);

      if (!response.ok) {
        throw new Error(`Failed to fetch pricing: ${response.status}`);
      }

      const data = await response.json();
      pricingCache = data;
      console.log(`[CostCalculator] Loaded pricing for ${Object.keys(data).length} models`);
      return data;
    } catch (error) {
      console.warn('[CostCalculator] Failed to fetch pricing, using fallback:', error);
      pricingCache = FALLBACK_PRICING;
      return FALLBACK_PRICING;
    } finally {
      pricingFetchPromise = null;
    }
  })();

  return pricingFetchPromise;
}

// =============================================================================
// Fallback Pricing (if fetch fails)
// =============================================================================

const FALLBACK_PRICING: Record<string, ModelPricing> = {
  'gpt-4o': {
    input_cost_per_token: 2.5e-6,
    output_cost_per_token: 10e-6,
  },
  'gpt-4o-mini': {
    input_cost_per_token: 0.15e-6,
    output_cost_per_token: 0.6e-6,
  },
  'o1': {
    input_cost_per_token: 15e-6,
    output_cost_per_token: 60e-6,
  },
  'o3-mini': {
    input_cost_per_token: 1.1e-6,
    output_cost_per_token: 4.4e-6,
  },
  'gpt-4.1': {
    input_cost_per_token: 2e-6,
    output_cost_per_token: 8e-6,
  },
  'gpt-4.1-mini': {
    input_cost_per_token: 0.4e-6,
    output_cost_per_token: 1.6e-6,
  },
  'gpt-4.1-nano': {
    input_cost_per_token: 0.1e-6,
    output_cost_per_token: 0.4e-6,
  },
  'gpt-5-mini': {
    input_cost_per_token: 0.5e-6,
    output_cost_per_token: 2e-6,
  },
};

// =============================================================================
// Model Name Normalization
// =============================================================================

/**
 * Normalize model name to match LiteLLM pricing keys
 *
 * LiteLLM uses keys like:
 * - "gpt-4o" (OpenAI)
 * - "azure/gpt-4o" (Azure)
 * - "bedrock/claude-3-5-sonnet" (Bedrock)
 *
 * Our env vars might have deployment names or slightly different formats.
 */
function normalizeModelName(model: string): string[] {
  const normalized = model.toLowerCase().trim();

  // Generate variations to try
  const variations: string[] = [
    normalized,
    `azure/${normalized}`,
    `openai/${normalized}`,
  ];

  // Handle deployment name patterns (e.g., "my-gpt4o-deployment" → "gpt-4o")
  if (normalized.includes('gpt-4o-mini') || normalized.includes('gpt4o-mini')) {
    variations.push('gpt-4o-mini', 'azure/gpt-4o-mini');
  } else if (normalized.includes('gpt-4o') || normalized.includes('gpt4o')) {
    variations.push('gpt-4o', 'azure/gpt-4o');
  } else if (normalized.includes('o1-mini')) {
    variations.push('o1-mini', 'azure/o1-mini');
  } else if (normalized.includes('o1')) {
    variations.push('o1', 'azure/o1');
  } else if (normalized.includes('o3-mini')) {
    variations.push('o3-mini', 'azure/o3-mini');
  }

  // Handle gpt-4.1 series
  if (normalized.includes('gpt-4.1-nano')) {
    variations.push('gpt-4.1-nano', 'azure/gpt-4.1-nano');
  } else if (normalized.includes('gpt-4.1-mini')) {
    variations.push('gpt-4.1-mini', 'azure/gpt-4.1-mini');
  } else if (normalized.includes('gpt-4.1')) {
    variations.push('gpt-4.1', 'azure/gpt-4.1');
  }

  // Handle gpt-5 series
  if (normalized.includes('gpt-5-mini')) {
    variations.push('gpt-5-mini', 'azure/gpt-5-mini');
  } else if (normalized.includes('gpt-5')) {
    variations.push('gpt-5', 'azure/gpt-5');
  }

  return [...new Set(variations)]; // Dedupe
}

/**
 * Find pricing for a model, trying multiple name variations
 */
async function findModelPricing(model: string): Promise<ModelPricing | null> {
  const pricing = await fetchPricing();
  const variations = normalizeModelName(model);

  for (const variant of variations) {
    if (pricing[variant]) {
      return pricing[variant];
    }
  }

  // Try partial match as last resort
  const modelLower = model.toLowerCase();
  for (const [key, value] of Object.entries(pricing)) {
    if (key.toLowerCase().includes(modelLower) || modelLower.includes(key.toLowerCase())) {
      return value;
    }
  }

  return null;
}

// =============================================================================
// Cost Calculation
// =============================================================================

/**
 * Calculate cost for a model run
 *
 * @param model - Model name (from env or API response)
 * @param usage - Token counts { input, output }
 * @returns Cost breakdown with input/output/total in USD
 */
export async function calculateCost(
  model: string,
  usage: TokenUsage
): Promise<CostBreakdown> {
  const pricing = await findModelPricing(model);

  if (!pricing || !pricing.input_cost_per_token || !pricing.output_cost_per_token) {
    console.warn(`[CostCalculator] No pricing found for model: ${model}`);
    return {
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      model,
      tokens: usage,
    };
  }

  const inputCost = usage.input * pricing.input_cost_per_token;
  const outputCost = usage.output * pricing.output_cost_per_token;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    model,
    tokens: usage,
  };
}

/**
 * Calculate cost synchronously using cached pricing (or fallback)
 * Use this when you need sync calculation and pricing is already fetched
 */
export function calculateCostSync(
  model: string,
  usage: TokenUsage
): CostBreakdown {
  const pricing = pricingCache || FALLBACK_PRICING;
  const variations = normalizeModelName(model);

  let modelPricing: ModelPricing | null = null;
  for (const variant of variations) {
    if (pricing[variant]) {
      modelPricing = pricing[variant];
      break;
    }
  }

  if (!modelPricing || !modelPricing.input_cost_per_token || !modelPricing.output_cost_per_token) {
    return {
      inputCost: 0,
      outputCost: 0,
      totalCost: 0,
      model,
      tokens: usage,
    };
  }

  const inputCost = usage.input * modelPricing.input_cost_per_token;
  const outputCost = usage.output * modelPricing.output_cost_per_token;

  return {
    inputCost,
    outputCost,
    totalCost: inputCost + outputCost,
    model,
    tokens: usage,
  };
}

// =============================================================================
// Formatting Utilities
// =============================================================================

/**
 * Format cost as USD string
 */
export function formatCost(cost: number): string {
  if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  }
  return `$${cost.toFixed(2)}`;
}

/**
 * Format a cost breakdown for display
 */
export function formatCostBreakdown(breakdown: CostBreakdown): string {
  const { inputCost, outputCost, totalCost, model, tokens } = breakdown;
  return [
    `Model: ${model}`,
    `Tokens: ${tokens.input.toLocaleString()} in / ${tokens.output.toLocaleString()} out`,
    `Cost: ${formatCost(inputCost)} in + ${formatCost(outputCost)} out = ${formatCost(totalCost)} total`,
  ].join('\n');
}

// =============================================================================
// Preload (optional)
// =============================================================================

/**
 * Preload pricing data (call at app startup for faster first calculation)
 */
export async function preloadPricing(): Promise<void> {
  await fetchPricing();
}
