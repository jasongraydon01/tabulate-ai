import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateStartupEnvironment } from '../validateStartupEnvironment';

// Store original env to restore after each test
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
});

afterEach(() => {
  process.env = originalEnv;
});

function setMinimalValidEnv() {
  process.env.AI_PROVIDER = 'azure';
  process.env.AZURE_API_KEY = 'test-azure-key-12345';
  process.env.AZURE_RESOURCE_NAME = 'my-resource';
  process.env.CONVEX_URL = 'https://test.convex.cloud';
  process.env.CONVEX_DEPLOY_KEY = 'deploy-key-123';
  process.env.R2_ACCOUNT_ID = 'test-account';
  process.env.R2_ACCESS_KEY_ID = 'test-access-key';
  process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
  process.env.R2_BUCKET_NAME = 'test-bucket';
  process.env.AUTH_BYPASS = 'true';
  // Stripe billing
  process.env.STRIPE_SECRET_KEY = 'sk_test_123';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_123';
  process.env.STRIPE_METER_ID = 'meter_test_123';
  process.env.STRIPE_PRICE_STARTER = 'price_starter';
  process.env.STRIPE_PRICE_STARTER_METERED = 'price_starter_m';
  process.env.STRIPE_PRICE_PROFESSIONAL = 'price_pro';
  process.env.STRIPE_PRICE_PROFESSIONAL_METERED = 'price_pro_m';
  process.env.STRIPE_PRICE_STUDIO = 'price_studio';
  process.env.STRIPE_PRICE_STUDIO_METERED = 'price_studio_m';
  process.env.STRIPE_PRICE_PAYG = 'price_payg';
  process.env.STRIPE_PRICE_PAYG_METERED = 'price_payg_m';
  (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
}

describe('validateStartupEnvironment', () => {
  describe('valid configurations', () => {
    it('passes with all required Azure vars present', () => {
      setMinimalValidEnv();
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('passes with OpenAI provider', () => {
      setMinimalValidEnv();
      process.env.AI_PROVIDER = 'openai';
      process.env.OPENAI_API_KEY = 'sk-test-key-12345';
      delete process.env.AZURE_API_KEY;
      delete process.env.AZURE_RESOURCE_NAME;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('passes with WorkOS auth instead of AUTH_BYPASS', () => {
      setMinimalValidEnv();
      delete process.env.AUTH_BYPASS;
      process.env.WORKOS_CLIENT_ID = 'client_123';
      process.env.WORKOS_API_KEY = 'sk_test_123';
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('defaults to azure when AI_PROVIDER is not set', () => {
      setMinimalValidEnv();
      delete process.env.AI_PROVIDER;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(true);
    });
  });

  describe('missing AI provider credentials', () => {
    it('errors when AZURE_API_KEY is missing (azure provider)', () => {
      setMinimalValidEnv();
      delete process.env.AZURE_API_KEY;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: AZURE_API_KEY');
    });

    it('errors when AZURE_RESOURCE_NAME is missing (azure provider)', () => {
      setMinimalValidEnv();
      delete process.env.AZURE_RESOURCE_NAME;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: AZURE_RESOURCE_NAME');
    });

    it('errors when OPENAI_API_KEY is missing (openai provider)', () => {
      setMinimalValidEnv();
      process.env.AI_PROVIDER = 'openai';
      delete process.env.OPENAI_API_KEY;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: OPENAI_API_KEY');
    });

    it('errors on unknown AI_PROVIDER', () => {
      setMinimalValidEnv();
      process.env.AI_PROVIDER = 'gemini';
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('Unknown AI_PROVIDER');
    });
  });

  describe('Convex validation', () => {
    it('errors when CONVEX_URL is missing', () => {
      setMinimalValidEnv();
      delete process.env.CONVEX_URL;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: CONVEX_URL');
    });

    it('errors when CONVEX_URL is not a valid URL', () => {
      setMinimalValidEnv();
      process.env.CONVEX_URL = 'not-a-url';
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('not a valid URL'))).toBe(true);
    });

    it('warns (not errors) when CONVEX_DEPLOY_KEY is missing in development', () => {
      setMinimalValidEnv();
      delete process.env.CONVEX_DEPLOY_KEY;
      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('CONVEX_DEPLOY_KEY is not set (required in production)');
    });

    it('errors when CONVEX_DEPLOY_KEY is missing in production', () => {
      setMinimalValidEnv();
      delete process.env.CONVEX_DEPLOY_KEY;
      delete process.env.AUTH_BYPASS;
      process.env.WORKOS_CLIENT_ID = 'client_123';
      process.env.WORKOS_API_KEY = 'sk_test_123';
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: CONVEX_DEPLOY_KEY');
    });
  });

  describe('R2 validation', () => {
    it('errors when any R2 var is missing', () => {
      const r2Vars = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
      for (const varName of r2Vars) {
        setMinimalValidEnv();
        delete process.env[varName];
        const result = validateStartupEnvironment();
        expect(result.valid).toBe(false);
        expect(result.errors).toContain(`Missing required environment variable: ${varName}`);
      }
    });
  });

  describe('auth validation', () => {
    it('errors when no auth strategy is configured', () => {
      setMinimalValidEnv();
      delete process.env.AUTH_BYPASS;
      delete process.env.WORKOS_CLIENT_ID;
      delete process.env.WORKOS_API_KEY;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('No authentication strategy'))).toBe(true);
    });

    it('errors when AUTH_BYPASS=true in production', () => {
      setMinimalValidEnv();
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      process.env.AUTH_BYPASS = 'true';
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('AUTH_BYPASS=true is not allowed in production');
    });

    it('passes with AUTH_BYPASS=true in development', () => {
      setMinimalValidEnv();
      (process.env as Record<string, string | undefined>).NODE_ENV = 'development';
      process.env.AUTH_BYPASS = 'true';
      const result = validateStartupEnvironment();
      expect(result.errors.filter((e) => e.includes('AUTH_BYPASS'))).toHaveLength(0);
    });
  });

  describe('billing (Stripe) validation', () => {
    it('warns when Stripe vars are missing in development', () => {
      setMinimalValidEnv();
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_METER_ID;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('STRIPE_SECRET_KEY is not set (required in production)');
      expect(result.warnings).toContain('STRIPE_METER_ID is not set (required in production)');
    });

    it('errors when Stripe vars are missing in production', () => {
      setMinimalValidEnv();
      delete process.env.AUTH_BYPASS;
      process.env.WORKOS_CLIENT_ID = 'client_123';
      process.env.WORKOS_API_KEY = 'sk_test_123';
      (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
      delete process.env.STRIPE_SECRET_KEY;
      delete process.env.STRIPE_PRICE_STARTER;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required environment variable: STRIPE_SECRET_KEY');
      expect(result.errors).toContain('Missing required environment variable: STRIPE_PRICE_STARTER');
    });

    it('passes when all Stripe vars are present', () => {
      setMinimalValidEnv();
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(true);
      expect(result.warnings.filter((w) => w.includes('STRIPE'))).toHaveLength(0);
    });
  });

  describe('multiple errors', () => {
    it('collects all errors when multiple vars are missing', () => {
      setMinimalValidEnv();
      delete process.env.AZURE_API_KEY;
      delete process.env.CONVEX_URL;
      delete process.env.R2_BUCKET_NAME;
      const result = validateStartupEnvironment();
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });
});
