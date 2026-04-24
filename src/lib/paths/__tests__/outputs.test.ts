import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { getOutputsBaseDir, getWorkspaceRoot, isPathInsideOutputsBase } from '@/lib/paths/outputs';

describe('outputs path helpers', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('prefers INIT_CWD as the workspace root when available', () => {
    vi.stubEnv('INIT_CWD', '/Users/jasongraydon01/tabulate-ai');

    expect(getWorkspaceRoot()).toBe('/Users/jasongraydon01/tabulate-ai');
    expect(getOutputsBaseDir()).toBe('/Users/jasongraydon01/tabulate-ai/outputs');
  });

  it('walks up from nested directories to find the repo root', () => {
    vi.stubEnv('INIT_CWD', '/Users/jasongraydon01/tabulate-ai/src/lib/worker');

    expect(getWorkspaceRoot()).toBe('/Users/jasongraydon01/tabulate-ai');
    expect(getOutputsBaseDir()).toBe('/Users/jasongraydon01/tabulate-ai/outputs');
  });

  it('accepts repo-scoped output directories and rejects outside paths', () => {
    vi.stubEnv('INIT_CWD', '/Users/jasongraydon01/tabulate-ai');

    expect(
      isPathInsideOutputsBase(
        '/Users/jasongraydon01/tabulate-ai/outputs/cambridge-savings-bank-w3-data-3-31-26/pipeline-2026-04-17T14-03-36-709Z',
      ),
    ).toBe(true);

    expect(
      isPathInsideOutputsBase(
        path.join('/Users/jasongraydon01/tabulate-ai', 'tmp', 'pipeline-1'),
      ),
    ).toBe(false);
  });
});
