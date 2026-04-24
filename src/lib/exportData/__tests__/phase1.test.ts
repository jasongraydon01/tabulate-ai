import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { makeTable } from '@/lib/__tests__/fixtures';
import type { TableWithLoopFrame } from '@/schemas/verificationAgentSchema';
import {
  EXPORT_ARTIFACT_PATHS,
  EXPORT_MANIFEST_VERSION_PHASE0,
  type ExportManifestMetadata,
  buildPhase1Manifest,
  evaluateExportReadiness,
  persistPhase0Artifacts,
} from '@/lib/exportData';

function withLoopFrame(tableId: string, loopDataFrame: string): TableWithLoopFrame {
  const table = makeTable({ tableId });
  return { ...table, loopDataFrame };
}

async function makeTempOutputDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'tabulate-export-phase1-'));
}

async function writeJson(outputDir: string, relativePath: string, value: unknown): Promise<void> {
  const absolute = path.join(outputDir, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, JSON.stringify(value, null, 2), 'utf-8');
}

async function seedPhase1Inputs(outputDir: string): Promise<void> {
  await writeJson(outputDir, 'tables/07-sorted-final.json', {
    _metadata: {
      stage: 'sorted-final',
      stageNumber: 7,
      tableCount: 1,
      timestamp: new Date().toISOString(),
    },
    tables: [{
      tableId: 't1',
      questionId: 'Q1',
      tableType: 'single',
      rows: [],
      additionalFilter: "SEG %in% c('A', 'B')",
    }],
  });

  await writeJson(outputDir, 'results/tables.json', {
    metadata: {
      generatedAt: new Date().toISOString(),
      tableCount: 1,
      cutCount: 1,
    },
    tables: {
      t1: {
        tableId: 't1',
        data: {},
        columns: [],
        rows: [],
      },
    },
  });

  await writeJson(outputDir, 'crosstab/crosstab-output-raw.json', {
    bannerCuts: [{
      groupName: 'demo',
      columns: [
        { name: 'male', adjusted: 'GENDER == 1', expressionType: 'direct_variable' },
        { name: 'non_na', adjusted: '!is.na(Q1)', expressionType: 'comparison' },
      ],
    }],
  });

  await writeJson(outputDir, 'filtertranslator/filtertranslator-output-raw.json', {
    filters: [
      { ruleId: 'rule_1', filterExpression: "BRAND %in% c('A', 'B')" },
    ],
  });

  await writeJson(outputDir, 'stages/loop-summary.json', {
    totalLoopGroups: 0,
    totalIterationVars: 0,
    totalBaseVars: 0,
    groups: [],
  });
}

describe('phase 1 export manifest', () => {
  it('builds support report, integrity checksums, and readiness metadata', async () => {
    const outputDir = await makeTempOutputDir();
    await seedPhase1Inputs(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', '')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    const firstBuild = await buildPhase1Manifest(outputDir);
    const secondBuild = await buildPhase1Manifest(outputDir);

    expect(firstBuild.metadata.manifestVersion).toBe('phase1.v1');
    expect(firstBuild.metadata.support).toBeDefined();
    expect(firstBuild.metadata.integrity?.algorithm).toBe('sha256');
    expect(firstBuild.metadata.integrity?.artifactChecksums[EXPORT_ARTIFACT_PATHS.supportReport]).toBeDefined();
    expect(firstBuild.metadata.readiness?.local.ready).toBe(true);
    expect(firstBuild.metadata.readiness?.reexport.ready).toBe(false);
    expect(firstBuild.metadata.readiness?.reexport.reasonCodes).toContain('r2_not_finalized');
    expect(firstBuild.supportReport.expressionSummary.total).toBeGreaterThan(0);
    expect(firstBuild.supportReport.summary.q.warning).toBeGreaterThan(0);
    expect(firstBuild.metadata.idempotency?.jobs).toEqual(secondBuild.metadata.idempotency?.jobs);
  });

  it('marks readiness as checksum mismatch after artifact tampering', async () => {
    const outputDir = await makeTempOutputDir();
    await seedPhase1Inputs(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', '')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    await buildPhase1Manifest(outputDir);
    await writeJson(outputDir, EXPORT_ARTIFACT_PATHS.tableRouting, {
      generatedAt: new Date().toISOString(),
      totalTables: 999,
      tableToDataFrameRef: { tampered: 'wide' },
      countsByDataFrameRef: { wide: 999 },
    });

    const rebuilt = await buildPhase1Manifest(outputDir);
    expect(rebuilt.metadata.readiness?.local.ready).toBe(false);
    expect(rebuilt.metadata.readiness?.local.reasonCodes).toContain('checksum_mismatch');

    const rebuiltAgain = await buildPhase1Manifest(outputDir);
    expect(rebuiltAgain.metadata.readiness?.local.ready).toBe(false);
    expect(rebuiltAgain.metadata.readiness?.local.reasonCodes).toContain('checksum_mismatch');
  });

  it('fails readiness when sorted-final, routing, and support artifacts diverge', async () => {
    const outputDir = await makeTempOutputDir();
    await seedPhase1Inputs(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', '')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    await buildPhase1Manifest(outputDir);

    await writeJson(outputDir, 'tables/07-sorted-final.json', {
      _metadata: {
        stage: 'sorted-final',
        stageNumber: 7,
        tableCount: 1,
        timestamp: new Date().toISOString(),
      },
      tables: [{
        tableId: '',
        questionId: 'Q1',
        tableType: 'single',
        rows: [],
      }],
    });

    const rebuilt = await buildPhase1Manifest(outputDir);
    expect(rebuilt.metadata.readiness?.local.ready).toBe(false);
    expect(rebuilt.metadata.readiness?.local.reasonCodes).toContain('artifact_consistency_mismatch');
    expect((rebuilt.metadata.readiness?.local.details ?? []).join(' ')).toContain('empty tableId');
    expect((rebuilt.metadata.readiness?.local.details ?? []).join(' ')).toContain('table-routing');
  });

  it('requires wide.sav even when all jobs route to stacked data', async () => {
    const outputDir = await makeTempOutputDir();
    await seedPhase1Inputs(outputDir);
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

    const built = await buildPhase1Manifest(outputDir);
    expect(built.metadata.readiness?.local.ready).toBe(false);
    expect(built.metadata.readiness?.local.reasonCodes).toContain('missing_required_data_file');
    expect((built.metadata.readiness?.local.details ?? []).join(' ')).toContain('export/data/wide.sav');
  });

  it('rejects phase0 manifests in forward-only mode', async () => {
    const outputDir = await makeTempOutputDir();
    await seedPhase1Inputs(outputDir);
    await fs.mkdir(path.join(outputDir, 'export/data'), { recursive: true });
    await fs.writeFile(path.join(outputDir, 'export/data/wide.sav'), 'wide', 'utf-8');

    await persistPhase0Artifacts({
      outputDir,
      tablesWithLoopFrame: [withLoopFrame('t1', '')],
      loopMappings: [],
      sourceSavUploadedName: 'input.sav',
      sourceSavRuntimeName: 'dataFile.sav',
    });

    const metadataPath = path.join(outputDir, EXPORT_ARTIFACT_PATHS.metadata);
    const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as { manifestVersion: string };
    metadata.manifestVersion = EXPORT_MANIFEST_VERSION_PHASE0;
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8');

    await expect(buildPhase1Manifest(outputDir)).rejects.toMatchObject({
      reasonCodes: ['not_exportable_requires_rerun'],
    });

    const readiness = evaluateExportReadiness(
      JSON.parse(await fs.readFile(metadataPath, 'utf-8')) as ExportManifestMetadata,
    );
    expect(readiness.local.ready).toBe(false);
    expect(readiness.local.reasonCodes).toContain('not_exportable_requires_rerun');
  });
});
