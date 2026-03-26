/**
 * AI Model Health Check
 *
 * Probes each unique model deployment before the pipeline starts.
 * Works with both Azure OpenAI and direct OpenAI API.
 * Catches bad API keys, expired deployments, or quota exhaustion in ~5 seconds
 * instead of failing 10-15 minutes into the pipeline.
 *
 * Cost: ~10 tokens per unique deployment (negligible).
 */

import { generateText } from 'ai';
import { getActiveProvider, getEnvironmentConfig } from '../env';

export interface DeploymentHealthResult {
  name: string;
  agents: string[];
  ok: boolean;
  error?: string;
  latencyMs: number;
}

export interface HealthCheckResult {
  success: boolean;
  deployments: DeploymentHealthResult[];
  durationMs: number;
}

export async function runHealthCheck(abortSignal?: AbortSignal): Promise<HealthCheckResult> {
  const startTime = Date.now();

  let config;
  try {
    config = getEnvironmentConfig();
  } catch (error) {
    return {
      success: false,
      deployments: [{
        name: '(config)',
        agents: ['all'],
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        latencyMs: Date.now() - startTime,
      }],
      durationMs: Date.now() - startTime,
    };
  }

  const provider = getActiveProvider();

  // Deduplicate deployments for active pipeline agents.
  // Deprecated Path C agents (SkipLogicAgent/FilterTranslatorAgent) are intentionally excluded.
  const deploymentMap = new Map<string, string[]>();
  const agentModels: [string, string][] = [
    ['BannerAgent', config.bannerModel],
    ['BannerGenerateAgent', config.bannerGenerateModel],
    ['CrosstabAgent', config.crosstabModel],
    ['VerificationAgent', config.verificationModel],
    ['LoopSemanticsAgent', config.loopSemanticsModel],
  ];

  for (const [agent, model] of agentModels) {
    const existing = deploymentMap.get(model);
    if (existing) {
      existing.push(agent);
    } else {
      deploymentMap.set(model, [agent]);
    }
  }

  // 15-second timeout for the entire health check
  const ac = new AbortController();
  const timeout = setTimeout(() => ac.abort(new Error('Health check timeout (15s)')), 15_000);
  if (abortSignal) {
    if (abortSignal.aborted) {
      clearTimeout(timeout);
      ac.abort(abortSignal.reason);
    } else {
      abortSignal.addEventListener('abort', () => {
        clearTimeout(timeout);
        ac.abort(abortSignal.reason);
      }, { once: true });
    }
  }

  const results: DeploymentHealthResult[] = [];

  // Test each unique deployment sequentially (avoid rate limits)
  for (const [deployment, agents] of deploymentMap) {
    if (ac.signal.aborted) {
      results.push({
        name: deployment,
        agents,
        ok: false,
        error: 'Skipped (health check aborted)',
        latencyMs: 0,
      });
      continue;
    }

    const probeStart = Date.now();
    try {
      await generateText({
        model: provider.chat(deployment),
        prompt: 'Respond with: OK',
        maxOutputTokens: 5,
        maxRetries: 0,
        abortSignal: ac.signal,
      });
      results.push({
        name: deployment,
        agents,
        ok: true,
        latencyMs: Date.now() - probeStart,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.push({
        name: deployment,
        agents,
        ok: false,
        error: errorMsg.substring(0, 300),
        latencyMs: Date.now() - probeStart,
      });
    }
  }

  clearTimeout(timeout);

  return {
    success: results.every(r => r.ok),
    deployments: results,
    durationMs: Date.now() - startTime,
  };
}
