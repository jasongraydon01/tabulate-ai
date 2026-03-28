import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  formatHealthCheckFailure,
  getHealthCheckProviderLabel,
  type HealthCheckResult,
} from '../HealthCheck';

describe('HealthCheck helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('formats failed deployments into a compact summary', () => {
    const health: HealthCheckResult = {
      success: false,
      durationMs: 42,
      deployments: [
        {
          name: 'gpt-5-mini',
          agents: ['BannerGenerateAgent', 'VerificationAgent'],
          ok: false,
          error: 'The project you are requesting has been archived and is no longer accessible',
          latencyMs: 12,
        },
        {
          name: 'gpt-5-nano',
          agents: ['BannerAgent'],
          ok: true,
          latencyMs: 8,
        },
      ],
    };

    expect(formatHealthCheckFailure(health)).toBe(
      'gpt-5-mini (BannerGenerateAgent, VerificationAgent): The project you are requesting has been archived and is no longer accessible',
    );
  });

  it('uses OpenAI as the fallback provider label', () => {
    vi.stubEnv('AI_PROVIDER', '');
    expect(getHealthCheckProviderLabel()).toBe('OpenAI');
  });

  it('maps azure provider label correctly', () => {
    vi.stubEnv('AI_PROVIDER', 'azure');
    vi.stubEnv('AZURE_API_KEY', 'test-azure-key-12345');
    vi.stubEnv('AZURE_RESOURCE_NAME', 'tabulate-ai');

    expect(getHealthCheckProviderLabel()).toBe('Azure');
  });
});
