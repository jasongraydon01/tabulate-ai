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

const HEALTH_CHECK_MAX_OUTPUT_TOKENS = 16;

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

export interface HealthCheckAgentModel {
  agent: string;
  model: string;
}

export function getHealthCheckProviderLabel(): string {
  try {
    return getEnvironmentConfig().aiProvider === 'openai' ? 'OpenAI' : 'Azure';
  } catch {
    return (process.env.AI_PROVIDER || 'openai').toLowerCase() === 'azure' ? 'Azure' : 'OpenAI';
  }
}

export function formatHealthCheckFailure(health: HealthCheckResult): string {
  const failed = health.deployments.filter(deployment => !deployment.ok);
  if (failed.length === 0) {
    return 'Unknown AI health check failure';
  }

  return failed
    .map((deployment) => (
      `${deployment.name} (${deployment.agents.join(', ')}): ${deployment.error || 'Unknown error'}`
    ))
    .join('; ');
}

export function buildDeploymentHealthTargets(
  agentModels: HealthCheckAgentModel[],
): Map<string, string[]> {
  const deploymentMap = new Map<string, string[]>();

  for (const { agent, model } of agentModels) {
    const existing = deploymentMap.get(model);
    if (existing) {
      existing.push(agent);
    } else {
      deploymentMap.set(model, [agent]);
    }
  }

  return deploymentMap;
}

function buildConfigErrorResult(startTime: number, error: unknown): HealthCheckResult {
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

async function runHealthCheckAgainstAgentModels(
  agentModels: HealthCheckAgentModel[],
  abortSignal?: AbortSignal,
): Promise<HealthCheckResult> {
  const startTime = Date.now();
  const provider = getActiveProvider();
  const deploymentMap = buildDeploymentHealthTargets(agentModels);

  if (deploymentMap.size === 0) {
    return {
      success: true,
      deployments: [],
      durationMs: 0,
    };
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
        model: provider.responses(deployment),
        prompt: 'Respond with: OK',
        maxOutputTokens: HEALTH_CHECK_MAX_OUTPUT_TOKENS,
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

export async function runHealthCheckForAgentModels(
  agentModels: HealthCheckAgentModel[],
  abortSignal?: AbortSignal,
): Promise<HealthCheckResult> {
  const startTime = Date.now();

  try {
    getEnvironmentConfig();
  } catch (error) {
    return buildConfigErrorResult(startTime, error);
  }

  return runHealthCheckAgainstAgentModels(agentModels, abortSignal);
}

export async function runHealthCheck(abortSignal?: AbortSignal): Promise<HealthCheckResult> {
  const startTime = Date.now();

  let config;
  try {
    config = getEnvironmentConfig();
  } catch (error) {
    return buildConfigErrorResult(startTime, error);
  }

  return runHealthCheckAgainstAgentModels(
    [
      { agent: 'BannerAgent', model: config.bannerModel },
      { agent: 'BannerGenerateAgent', model: config.bannerGenerateModel },
      { agent: 'CrosstabAgent', model: config.crosstabModel },
      { agent: 'VerificationAgent', model: config.verificationModel },
      { agent: 'LoopSemanticsAgent', model: config.loopSemanticsModel },
    ],
    abortSignal,
  );
}
