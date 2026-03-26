import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { makeTable } from '@/lib/__tests__/fixtures';
import type { LoopGroupMapping } from '@/lib/validation/LoopCollapser';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';
import {
  EXPORT_ARTIFACT_PATHS,
  buildJobRoutingManifest,
  buildTableRoutingArtifact,
  ensureWideSavFallback,
  finalizeExportMetadataWithR2Refs,
  persistPhase0Artifacts,
} from '@/lib/exportData';

function withLoopFrame(tableId: string, loopDataFrame: string): TableWithLoopFrame {
  const table = makeTable({ tableId });
  return { ...table, loopDataFrame };
}

async function makeTempOutputDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tabulate-export-phase0-'));
}

async function seedRequiredInputArtifacts(
  outputDir: string,
  options?: { includeLoopSummary?: boolean },
): Promise<void> {
  const includeLoopSummary = options?.includeLoopSummary ?? true;
  const filesToSeed: Record<string, unknown> = {
    'tables/07-sorted-final.json': { _metadata: { stage: 'sorted-final', stageNumber: 7, tableCount: 2, timestamp: new Date().toISOString() }, tables: [] },
    'results/tables.json': { metadata: {}, tables: {} },
    'crosstab/crosstab-output-raw.json': { bannerCuts: [] },
  };
  if (includeLoopSummary) {
    filesToSeed['stages/loop-summary.json'] = { totalLoopGroups: 0, totalIterationVars: 0, totalBaseVars: 0, groups: [] };
  }

  for (const [relativePath, value] of Object.entries(filesToSeed)) {
    const absolutePath = path.join(outputDir, relativePath);
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, JSON.stringify(value, null, 2), 'utf-8');
  }
}

describe('exportData contract', () => {
  it('builds deterministic table routing and job routing (job-per-data-model)', () => {
    const routing = buildTableRoutingArtifact([
      withLoopFrame('t3', 'stacked_loop_1'),
      withLoopFrame('t1', ''),
      withLoopFrame('t2', 'stacked_loop_1'),
    ]);

    expect(routing.totalTables).toBe(3);
    expect(routing.tableToDataFrameRef).toEqual({
      t1: 'wide',
      t2: 'stacked_loop_1',
      t3: 'stacked_loop_1',
    });
    expect(routing.countsByDataFrameRef).toEqual({
      wide: 1,
      stacked_loop_1: 2,
    });

    const jobManifest = buildJobRoutingManifest(routing);
    expect(jobManifest.totalJobs).toBe(2);
    expect(jobManifest.totalTables).toBe(3);
    expect(jobManifest.jobs.map((j) => j.jobId)).toEqual(['wide.job', 'stacked_loop_1.job']);
    expect(jobManifest.tableToJobId).toEqual({
      t1: 'wide.job',
      t2: 'stacked_loop_1.job',
      t3: 'stacked_loop_1.job',
    });
  });

  it('normalizes missing and duplicate table IDs before routing', () => {
    const baseA = makeTable({ tableId: '', questionId: 'S6' });
    const baseB = makeTable({ tableId: '', questionId: 'S6' });
    const baseC = makeTable({ tableId: ' custom-id ', questionId: 'Q1' });

    const routing = buildTableRoutingArtifact([
      { ...baseA, loopDataFrame: '' },
      { ...baseB, loopDataFrame: '' },
      { ...baseC, loopDataFrame: '' },
    ]);

    expect(routing.tableToDataFrameRef).toEqual({
      'custom-id': 'wide',
      table_S6: 'wide',
      table_S6_2: 'wide',
    });
    expect(routing.totalTables).toBe(3);
    expect(routing.countsByDataFrameRef).toEqual({ wide: 3 });
  });

  it('persists phase 0 artifacts and finalizes metadata with r2 refs', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');
    await fs.writeFile(path.join(outputDir, 'export/data/stacked_loop_1.sav'), 'stacked', 'utf-8');

    const loopMappings: LoopGroupMapping[] = [{
      skeleton: 'A-N-_-N',
      stackedFrameName: 'stacked_loop_1',
      iterations: ['1', '2'],
      variables: [{
        baseName: 'A1',
        label: 'A1 label',
        iterationColumns: { '1': 'A1_1', '2': 'A1_2' },
      }],
    }];

    const tablesWithLoopFrame: TableWithLoopFrame[] = [
      withLoopFrame('t1', ''),
      withLoopFrame('t2', 'stacked_loop_1'),
    ];

    const persisted = await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame,
      loopMappings,
      weightVariable: 'wt',
      hasDualWeightOutputs: true,
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
      convexRefs: { runId: 'run1', projectId: 'project1', orgId: 'org1', pipelineId: 'pipe1' },
    });

    expect(persisted.metadata.weighting.mode).toBe('both');
    expect(persisted.metadata.availableDataFiles.every((f) => f.exists)).toBe(true);

    const requiredArtifacts = [
      EXPORT_ARTIFACT_PATHS.metadata,
      EXPORT_ARTIFACT_PATHS.tableRouting,
      EXPORT_ARTIFACT_PATHS.jobRoutingManifest,
      EXPORT_ARTIFACT_PATHS.loopPolicy,
      'agents/loop-semantics/loop-semantics-policy.json',
    ];
    for (const relativePath of requiredArtifacts) {
      await expect(fs.access(path.join(outputDir, relativePath))).resolves.toBeUndefined();
    }

    const finalized = await finalizeExportMetadataWithR2Refs(outputDir, {
      'export/export-metadata.json': 'r2/export/export-metadata.json',
      'export/support-report.json': 'r2/export/support-report.json',
      'export/table-routing.json': 'r2/export/table-routing.json',
      'export/job-routing-manifest.json': 'r2/export/job-routing-manifest.json',
      'export/loop-semantics-policy.json': 'r2/export/loop-semantics-policy.json',
      'export/data/wide.sav': 'r2/export/data/wide.sav',
      'export/data/stacked_loop_1.sav': 'r2/export/data/stacked_loop_1.sav',
    });

    expect(finalized.r2Refs.finalized).toBe(true);
    expect(finalized.r2Refs.artifacts['export/export-metadata.json']).toBe('r2/export/export-metadata.json');
    const wideFile = finalized.availableDataFiles.find((f) => f.dataFrameRef === 'wide');
    expect(wideFile?.r2Key).toBe('r2/export/data/wide.sav');
  });

  it('copies wide.sav from runtime sav when export wide is missing', async () => {
    const outputDir = await makeTempOutputDir();
    await fs.writeFile(path.join(outputDir, 'dataFile.sav'), 'runtime', 'utf-8');

    const copied = await ensureWideSavFallback(outputDir);
    expect(copied).toBe(true);

    const widePath = path.join(outputDir, 'export/data/wide.sav');
    await expect(fs.readFile(widePath, 'utf-8')).resolves.toBe('runtime');
  });

  it('synthesizes loop-summary when missing without warning on non-loop runs', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir, { includeLoopSummary: false });
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');

    const persisted = await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', '')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    const loopSummaryPath = path.join(outputDir, 'stages/loop-summary.json');
    const loopSummary = JSON.parse(await fs.readFile(loopSummaryPath, 'utf-8')) as {
      totalLoopGroups: number;
      totalIterationVars: number;
      totalBaseVars: number;
      groups: unknown[];
    };

    expect(loopSummary).toEqual({
      totalLoopGroups: 0,
      totalIterationVars: 0,
      totalBaseVars: 0,
      groups: [],
    });
    expect(persisted.metadata.warnings).not.toContain(
      'Loop summary artifact was missing at completion and was synthesized for export contract determinism.',
    );
    expect(persisted.metadata.warnings.some((warning) => warning.includes('loopPolicy'))).toBe(false);
  });

  it('warns when loop-summary is synthesized for loop runs', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir, { includeLoopSummary: false });
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');
    await fs.writeFile(path.join(outputDir, 'export/data/stacked_loop_1.sav'), 'stacked', 'utf-8');

    const persisted = await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [
        withLoopFrame('t1', ''),
        withLoopFrame('t2', 'stacked_loop_1'),
      ],
      loopMappings: [{
        skeleton: 'Q1_-N',
        stackedFrameName: 'stacked_loop_1',
        iterations: ['1', '2'],
        variables: [{
          baseName: 'Q1',
          label: 'Q1',
          iterationColumns: { '1': 'Q1_1', '2': 'Q1_2' },
        }],
      }],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    expect(persisted.metadata.warnings).toContain(
      'Loop summary artifact was missing at completion and was synthesized for export contract determinism.',
    );
  });

  it('prefers enriched sorted-final tables for routing when they include companion NET tables', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');
    await fs.writeFile(
      path.join(outputDir, 'tables/13e-table-enriched.json'),
      JSON.stringify({
        _metadata: { stage: 'table-enriched', stageNumber: 13 },
        tables: [
          makeTable({ tableId: 't1' }),
          makeTable({ tableId: 't1__net_summary', sourceTableId: 't1' }),
        ],
      }, null, 2),
      'utf-8',
    );

    const persisted = await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', '')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    expect(persisted.tableRouting.totalTables).toBe(2);
    expect(Object.keys(persisted.tableRouting.tableToDataFrameRef)).toEqual([
      't1',
      't1__net_summary',
    ]);
    expect(persisted.jobRoutingManifest.totalTables).toBe(2);
    expect(persisted.jobRoutingManifest.tableToJobId['t1__net_summary']).toBe('wide.job');
  });

  it('persists deterministic verbose datamap pointer when verbose artifacts exist', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');
    await fs.writeFile(path.join(outputDir, 'survey-verbose-2026-02-01T00-00-00-000Z.json'), '[]', 'utf-8');
    await fs.writeFile(path.join(outputDir, 'survey-verbose-2026-02-02T00-00-00-000Z.json'), '[]', 'utf-8');

    const persisted = await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', '')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    expect(persisted.metadata.artifactPaths.inputs.verboseDataMap).toBe(
      'survey-verbose-2026-02-02T00-00-00-000Z.json',
    );
  });

  it('includes data files referenced by routing even if loop mappings are absent', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');
    await fs.writeFile(path.join(outputDir, 'export/data/stacked_loop_9.sav'), 'stacked', 'utf-8');

    const persisted = await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', 'stacked_loop_9')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    expect(persisted.metadata.availableDataFiles.map((file) => file.dataFrameRef)).toEqual([
      'wide',
      'stacked_loop_9',
    ]);
    expect(persisted.metadata.availableDataFiles.find((file) => file.dataFrameRef === 'stacked_loop_9')?.exists).toBe(true);
  });

  it('warns when a job-routed stacked data file is missing at completion', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');

    const persisted = await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', 'stacked_loop_1')],
      loopMappings: [{
        skeleton: 'Q1_-N',
        stackedFrameName: 'stacked_loop_1',
        iterations: ['1', '2'],
        variables: [{
          baseName: 'Q1',
          label: 'Q1',
          iterationColumns: { '1': 'Q1_1', '2': 'Q1_2' },
        }],
      }],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    expect(persisted.metadata.warnings).toContain(
      'Job-routed export data files missing at completion: export/data/stacked_loop_1.sav',
    );
  });

  it('marks r2 finalization incomplete when metadata key was not uploaded', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', '')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    const finalized = await finalizeExportMetadataWithR2Refs(outputDir, {
      'export/table-routing.json': 'r2/export/table-routing.json',
      'export/data/wide.sav': 'r2/export/data/wide.sav',
    });

    expect(finalized.r2Refs.finalized).toBe(false);
    expect(finalized.warnings).toContain('R2 finalization incomplete: export metadata artifact key was not uploaded.');
  });

  it('marks r2 finalization incomplete when required job data file refs are missing', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');
    await fs.writeFile(path.join(outputDir, 'export/data/stacked_loop_1.sav'), 'stacked', 'utf-8');

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [
        withLoopFrame('t1', ''),
        withLoopFrame('t2', 'stacked_loop_1'),
      ],
      loopMappings: [{
        skeleton: 'Q1_-N',
        stackedFrameName: 'stacked_loop_1',
        iterations: ['1', '2'],
        variables: [{
          baseName: 'Q1',
          label: 'Q1',
          iterationColumns: { '1': 'Q1_1', '2': 'Q1_2' },
        }],
      }],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    const finalized = await finalizeExportMetadataWithR2Refs(outputDir, {
      'export/export-metadata.json': 'r2/export/export-metadata.json',
      'export/support-report.json': 'r2/export/support-report.json',
      'export/table-routing.json': 'r2/export/table-routing.json',
      'export/job-routing-manifest.json': 'r2/export/job-routing-manifest.json',
      'export/loop-semantics-policy.json': 'r2/export/loop-semantics-policy.json',
      'export/data/wide.sav': 'r2/export/data/wide.sav',
    });

    expect(finalized.r2Refs.finalized).toBe(false);
    expect(finalized.warnings).toContain(
      'R2 finalization missing required data file refs: export/data/stacked_loop_1.sav',
    );
  });

  it('marks r2 finalization incomplete when wide.sav is missing even if jobs are stacked-only', async () => {
    const outputDir = await makeTempOutputDir();
    await seedRequiredInputArtifacts(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/stacked_loop_1.sav'), 'stacked', 'utf-8');

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', 'stacked_loop_1')],
      loopMappings: [{
        skeleton: 'Q1_-N',
        stackedFrameName: 'stacked_loop_1',
        iterations: ['1', '2'],
        variables: [{
          baseName: 'Q1',
          label: 'Q1',
          iterationColumns: { '1': 'Q1_1', '2': 'Q1_2' },
        }],
      }],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    const finalized = await finalizeExportMetadataWithR2Refs(outputDir, {
      'export/export-metadata.json': 'r2/export/export-metadata.json',
      'export/support-report.json': 'r2/export/support-report.json',
      'export/table-routing.json': 'r2/export/table-routing.json',
      'export/job-routing-manifest.json': 'r2/export/job-routing-manifest.json',
      'export/loop-semantics-policy.json': 'r2/export/loop-semantics-policy.json',
      'export/data/stacked_loop_1.sav': 'r2/export/data/stacked_loop_1.sav',
    });

    expect(finalized.r2Refs.finalized).toBe(false);
    expect(finalized.warnings).toContain(
      'R2 finalization blocked by missing local data files: export/data/wide.sav',
    );
    expect(finalized.warnings).toContain(
      'R2 finalization missing required data file refs: export/data/wide.sav',
    );
  });
});
