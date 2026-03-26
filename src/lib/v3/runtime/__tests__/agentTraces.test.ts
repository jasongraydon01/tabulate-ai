import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  persistStageAgentTrace,
  writeAgentTracesIndex,
  type AgentTraceIndex,
} from '../agentTraces';

const tempDirs: string[] = [];

async function makeTempOutputDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'v3-agent-traces-test-'));
  tempDirs.push(dir);
  return dir;
}

async function readTraceIndex(outputDir: string): Promise<AgentTraceIndex> {
  const raw = await fs.readFile(
    path.join(outputDir, 'agents', 'agent-traces-index.json'),
    'utf-8',
  );
  return JSON.parse(raw) as AgentTraceIndex;
}

afterEach(async () => {
  await Promise.all(tempDirs.map(dir => fs.rm(dir, { recursive: true, force: true })));
  tempDirs.length = 0;
});

describe('agent traces index', () => {
  it('does not misclassify banner-generate scratchpad as BannerAgent output', async () => {
    const outputDir = await makeTempOutputDir();
    const bannerDir = path.join(outputDir, 'agents', 'banner');
    await fs.mkdir(bannerDir, { recursive: true });

    await fs.writeFile(path.join(bannerDir, 'scratchpad-banner-generate.md'), '# banner generate', 'utf-8');
    await fs.writeFile(path.join(bannerDir, 'banner-generated.json'), '{"ok":true}', 'utf-8');
    await fs.mkdir(path.join(outputDir, 'planning'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'planning', 'banner-route-metadata.json'), JSON.stringify({
      routeUsed: 'banner_generate',
      usedFallbackFromBannerAgent: false,
      bannerGenerateInputSource: 'generated',
    }), 'utf-8');

    await writeAgentTracesIndex(outputDir);
    const index = await readTraceIndex(outputDir);

    const bannerAgent = index.entries.find(e => e.agentName === 'BannerAgent');
    const bannerGenerate = index.entries.find(e => e.agentName === 'BannerGenerateAgent');

    expect(bannerAgent).toBeDefined();
    expect(bannerGenerate).toBeDefined();
    expect(bannerAgent?.scratchpadPath).toBeNull();
    expect(bannerAgent?.status).toBe('skipped');
    expect(bannerGenerate?.scratchpadPath).toBe('agents/banner/scratchpad-banner-generate.md');
    expect(bannerGenerate?.status).toBe('written');
  });

  it('indexes stamped crosstab output without duplicating raw artifact', async () => {
    const outputDir = await makeTempOutputDir();
    const crosstabDir = path.join(outputDir, 'agents', 'crosstab');
    await fs.mkdir(crosstabDir, { recursive: true });

    await fs.writeFile(path.join(crosstabDir, 'crosstab-output-raw.json'), '{"raw":true}', 'utf-8');
    await fs.writeFile(path.join(crosstabDir, 'crosstab-output-2026-03-17T09-00-00-000Z.json'), '{"plan":true}', 'utf-8');

    await writeAgentTracesIndex(outputDir);
    const index = await readTraceIndex(outputDir);
    const crosstab = index.entries.find(e => e.agentName === 'CrosstabAgentV2');

    expect(crosstab).toBeDefined();
    expect(crosstab?.status).toBe('written');
    expect(crosstab?.artifactPaths).toContain('agents/crosstab/crosstab-output-raw.json');
    expect(crosstab?.artifactPaths).toContain('agents/crosstab/crosstab-output-2026-03-17T09-00-00-000Z.json');
    const rawCount = crosstab?.artifactPaths.filter(p => p.endsWith('crosstab-output-raw.json')).length ?? 0;
    expect(rawCount).toBe(1);
  });

  it('reads deterministic stage reports into trace index entries', async () => {
    const outputDir = await makeTempOutputDir();
    await persistStageAgentTrace({
      outputDir,
      stageId: '10a',
      agentName: 'LoopGateAgent',
      status: 'skipped',
      reportFilename: '10a-loop-gate-report.json',
      scratchpadFilename: '10a-loop-gate-scratchpad.md',
      summary: { reason: 'no_loop_families' },
    });

    await writeAgentTracesIndex(outputDir);
    const index = await readTraceIndex(outputDir);
    const loopGate = index.entries.find(e => e.agentName === 'LoopGateAgent');

    expect(loopGate).toBeDefined();
    expect(loopGate?.status).toBe('skipped');
    expect(loopGate?.reportPath).toBe('agents/loop-gate/10a-loop-gate-report.json');
    expect(loopGate?.scratchpadPath).toBeNull();
    expect(loopGate?.artifactPaths).toEqual(['agents/loop-gate/10a-loop-gate-report.json']);
  });

  it('indexes survey-cleanup stage reports', async () => {
    const outputDir = await makeTempOutputDir();
    await persistStageAgentTrace({
      outputDir,
      stageId: '08b',
      agentName: 'SurveyCleanupAgent',
      status: 'written',
      reportFilename: '08b-survey-cleanup-report.json',
      scratchpadFilename: '08b-survey-cleanup-scratchpad.md',
      scratchpadMarkdown: '# cleanup scratchpad',
      summary: { chunkCount: 3 },
    });

    await writeAgentTracesIndex(outputDir);
    const index = await readTraceIndex(outputDir);
    const cleanup = index.entries.find(e => e.agentName === 'SurveyCleanupAgent');

    expect(cleanup).toBeDefined();
    expect(cleanup?.status).toBe('written');
    expect(cleanup?.reportPath).toBe('agents/survey-cleanup/08b-survey-cleanup-report.json');
    expect(cleanup?.scratchpadPath).toBe('agents/survey-cleanup/08b-survey-cleanup-scratchpad.md');
  });

  it('falls back to legacy planning/traces/ layout for old runs', async () => {
    const outputDir = await makeTempOutputDir();
    const legacyDir = path.join(outputDir, 'planning', 'traces');
    await fs.mkdir(legacyDir, { recursive: true });

    // Create legacy-layout files
    await fs.writeFile(path.join(legacyDir, 'scratchpad-banner-generate.md'), '# banner generate', 'utf-8');
    await fs.writeFile(path.join(legacyDir, 'banner-generated.json'), '{"ok":true}', 'utf-8');
    await fs.writeFile(path.join(legacyDir, '10a-loop-gate-report.json'), JSON.stringify({
      stageId: '10a',
      agentName: 'LoopGateAgent',
      status: 'written',
      generatedAt: '2026-03-01T00:00:00.000Z',
    }), 'utf-8');
    await fs.writeFile(path.join(legacyDir, '10a-loop-gate-scratchpad.md'), '# loop gate', 'utf-8');

    await fs.mkdir(path.join(outputDir, 'planning'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'planning', 'banner-route-metadata.json'), JSON.stringify({
      routeUsed: 'banner_generate',
    }), 'utf-8');

    await writeAgentTracesIndex(outputDir);
    const index = await readTraceIndex(outputDir);

    // Banner generate should be found via legacy paths
    const bannerGen = index.entries.find(e => e.agentName === 'BannerGenerateAgent');
    expect(bannerGen?.status).toBe('written');
    expect(bannerGen?.scratchpadPath).toBe('planning/traces/scratchpad-banner-generate.md');

    // Loop gate should be found via legacy fallback in buildStageReportEntry
    const loopGate = index.entries.find(e => e.agentName === 'LoopGateAgent');
    expect(loopGate?.status).toBe('written');
    expect(loopGate?.reportPath).toBe('planning/traces/10a-loop-gate-report.json');
    expect(loopGate?.scratchpadPath).toBe('planning/traces/10a-loop-gate-scratchpad.md');
  });
});
