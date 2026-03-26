import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('ai', () => ({
  generateText: vi.fn(),
  Output: {
    object: vi.fn(() => ({})),
  },
  stepCountIs: vi.fn(() => undefined),
}));

vi.mock('../../lib/env', () => ({
  getBannerGenerateModel: vi.fn(() => 'mock-model'),
  getBannerGenerateModelName: vi.fn(() => 'mock-model'),
  getBannerGenerateModelTokenLimit: vi.fn(() => 4096),
  getBannerGenerateReasoningEffort: vi.fn(() => 'high'),
  getPromptVersions: vi.fn(() => ({ bannerGeneratePromptVersion: 'production' })),
  getGenerationConfig: vi.fn(() => ({ parallelToolCalls: true })),
  getGenerationSamplingParams: vi.fn(() => ({})),
}));

vi.mock('../tools/scratchpad', () => ({
  createContextScratchpadTool: vi.fn(() => ({})),
  getAllContextScratchpadEntries: vi.fn(() => []),
  clearContextScratchpadsForAgent: vi.fn(),
  clearAllContextScratchpads: vi.fn(),
  formatScratchpadAsMarkdown: vi.fn(() => ''),
}));

vi.mock('../../prompts', () => ({
  getBannerGeneratePrompt: vi.fn(() => 'SYSTEM PROMPT'),
  buildBannerGenerateUserPromptForVersion: vi.fn(() => 'USER PROMPT'),
}));

vi.mock('../../lib/retryWithPolicyHandling', () => ({
  retryWithPolicyHandling: vi.fn(async (fn: () => Promise<unknown>) => ({
    success: true,
    result: await fn(),
    attempts: 1,
    wasPolicyError: false,
  })),
}));

vi.mock('../../lib/observability', () => ({
  recordAgentMetrics: vi.fn(),
}));

vi.mock('../../lib/errors/ErrorPersistence', () => ({
  persistAgentErrorAuto: vi.fn(async () => {}),
}));

import { generateText } from 'ai';
import { persistAgentErrorAuto } from '../../lib/errors/ErrorPersistence';
import { generateBannerCutsWithValidation } from '../BannerGenerateAgent';

function makeInput(outputDir: string) {
  return {
    verboseDataMap: [
      {
        level: 'parent' as const,
        column: 'Q1',
        description: 'Question 1',
        valueType: 'Nominal',
        answerOptions: '1=Yes,2=No',
        parentQuestion: 'NA',
      },
      {
        level: 'parent' as const,
        column: 'Q2',
        description: 'Question 2',
        valueType: 'Nominal',
        answerOptions: '1=Yes,2=No',
        parentQuestion: 'NA',
      },
    ],
    outputDir,
  };
}

function modelOutput(groups: Array<{ groupName: string; columns: Array<{ name: string; original: string }> }>) {
  return {
    output: {
      bannerGroups: groups,
      confidence: 0.8,
      reasoning: 'test',
    },
    usage: {
      inputTokens: 10,
      outputTokens: 10,
    },
  };
}

const tempDirs: string[] = [];

afterEach(async () => {
  vi.clearAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('generateBannerCutsWithValidation', () => {
  it('returns initial result when all groups are valid', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'banner-valid-'));
    tempDirs.push(outDir);

    vi.mocked(generateText).mockResolvedValueOnce(
      modelOutput([
        {
          groupName: 'Q1 Group',
          columns: [
            { name: 'Yes', original: 'Q1==1' },
            { name: 'No', original: 'Q1==2' },
          ],
        },
      ]) as never,
    );

    const result = await generateBannerCutsWithValidation(makeInput(outDir));
    expect(result.agent).toHaveLength(1);
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1);

    const artifactRaw = await fs.readFile(path.join(outDir, 'agents', 'banner', 'banner-generated-validation.json'), 'utf-8');
    const artifact = JSON.parse(artifactRaw) as { retry: { attempted: boolean } };
    expect(artifact.retry.attempted).toBe(false);
    expect(vi.mocked(persistAgentErrorAuto)).not.toHaveBeenCalled();
  });

  it('retries once and returns corrected groups when initial output is invalid', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'banner-retry-'));
    tempDirs.push(outDir);

    vi.mocked(generateText)
      .mockResolvedValueOnce(
        modelOutput([
          {
            groupName: 'Mixed',
            columns: [
              { name: 'A', original: 'Q1==1' },
              { name: 'B', original: 'Q2==1' },
            ],
          },
        ]) as never,
      )
      .mockResolvedValueOnce(
        modelOutput([
          {
            groupName: 'Q1 Fixed',
            columns: [
              { name: 'Yes', original: 'Q1==1' },
              { name: 'No', original: 'Q1==2' },
            ],
          },
        ]) as never,
      );

    const result = await generateBannerCutsWithValidation(makeInput(outDir));
    expect(result.agent).toHaveLength(1);
    expect(result.agent[0].groupName).toBe('Q1 Fixed');
    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2);

    const artifactRaw = await fs.readFile(path.join(outDir, 'agents', 'banner', 'banner-generated-validation.json'), 'utf-8');
    const artifact = JSON.parse(artifactRaw) as { retry: { attempted: boolean; invalid: number } };
    expect(artifact.retry.attempted).toBe(true);
    expect(artifact.retry.invalid).toBe(0);
  });

  it('drops still-invalid groups after retry and persists warnings', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'banner-drop-'));
    tempDirs.push(outDir);

    vi.mocked(generateText)
      .mockResolvedValueOnce(
        modelOutput([
          {
            groupName: 'Initial Mixed',
            columns: [
              { name: 'A', original: 'Q1==1' },
              { name: 'B', original: 'Q2==1' },
            ],
          },
        ]) as never,
      )
      .mockResolvedValueOnce(
        modelOutput([
          {
            groupName: 'Q1 Fixed',
            columns: [
              { name: 'Yes', original: 'Q1==1' },
              { name: 'No', original: 'Q1==2' },
            ],
          },
          {
            groupName: 'Still Mixed',
            columns: [
              { name: 'A', original: 'Q1==1' },
              { name: 'B', original: 'Q2==1' },
            ],
          },
        ]) as never,
      );

    const result = await generateBannerCutsWithValidation(makeInput(outDir));
    expect(result.agent).toHaveLength(1);
    expect(result.agent[0].groupName).toBe('Q1 Fixed');
    expect(vi.mocked(persistAgentErrorAuto)).toHaveBeenCalled();
  });

  it('throws when no valid groups remain after correction retry', async () => {
    const outDir = await fs.mkdtemp(path.join(os.tmpdir(), 'banner-fail-'));
    tempDirs.push(outDir);

    vi.mocked(generateText)
      .mockResolvedValueOnce(
        modelOutput([
          {
            groupName: 'Initial Mixed',
            columns: [
              { name: 'A', original: 'Q1==1' },
              { name: 'B', original: 'Q2==1' },
            ],
          },
        ]) as never,
      )
      .mockResolvedValueOnce(
        modelOutput([
          {
            groupName: 'Still Mixed',
            columns: [
              { name: 'A', original: 'Q1==1' },
              { name: 'B', original: 'Q2==1' },
            ],
          },
        ]) as never,
      );

    await expect(generateBannerCutsWithValidation(makeInput(outDir))).rejects.toThrow(
      '0 valid groups after correction retry',
    );
  });
});
