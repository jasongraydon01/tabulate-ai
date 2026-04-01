import os from 'os';
import * as path from 'path';
import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  downloadFile: vi.fn(),
  deleteFile: vi.fn(),
  getSignedDownloadUrl: vi.fn(),
  buildKey: vi.fn((orgId: string, projectId: string, subpath: string, filename: string) => (
    `${orgId}/${projectId}/${subpath}/${filename}`
  )),
}));

vi.mock('@/lib/r2/r2', () => ({
  uploadFile: mocks.uploadFile,
  downloadFile: mocks.downloadFile,
  deleteFile: mocks.deleteFile,
  getSignedDownloadUrl: mocks.getSignedDownloadUrl,
  buildKey: mocks.buildKey,
}));

import {
  buildExportPackageBasePath,
  buildRunArtifactBasePath,
  buildRunArtifactKey,
  deleteReviewFiles,
  downloadReviewFiles,
  uploadPipelineOutputs,
  uploadReviewFile,
} from '@/lib/r2/R2FileManager';

describe('R2FileManager', () => {
  let tempDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'r2-file-manager-'));
    mocks.uploadFile.mockResolvedValue(undefined);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('uses the canonical org/project/run prefix for pipeline, review, and export artifacts', async () => {
    await fs.mkdir(path.join(tempDir, 'results'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'pipeline-summary.json'), '{"status":"success"}', 'utf8');
    await fs.writeFile(path.join(tempDir, 'results', 'crosstabs.xlsx'), 'xlsx', 'utf8');

    const manifest = await uploadPipelineOutputs('org-1', 'project-1', 'run-1', tempDir, {
      projectName: 'Acme Study',
      runTimestamp: '2026-03-20T12:34:56.000Z',
    });

    expect(buildRunArtifactBasePath('org-1', 'project-1', 'run-1')).toBe('org-1/project-1/runs/run-1');
    expect(buildRunArtifactKey('org-1', 'project-1', 'run-1', 'results/crosstabs.xlsx')).toBe(
      'org-1/project-1/runs/run-1/results/crosstabs.xlsx',
    );
    expect(buildExportPackageBasePath('org-1', 'project-1', 'run-1', 'q', 'pkg-1')).toBe(
      'org-1/project-1/runs/run-1/exports/q/pkg-1',
    );
    expect(manifest.baseKeyPath).toBe('org-1/project-1/runs/run-1');
    expect(manifest.outputs['results/crosstabs.xlsx']).toBe(
      'org-1/project-1/runs/run-1/results/crosstabs.xlsx',
    );
    expect(mocks.uploadFile).toHaveBeenCalledWith(
      'org-1/project-1/runs/run-1/manifest.json',
      expect.any(Buffer),
      'application/json',
    );

    const reviewStatePath = path.join(tempDir, 'crosstab-review-state.json');
    await fs.writeFile(reviewStatePath, '{"status":"awaiting_review"}', 'utf8');
    const reviewKey = await uploadReviewFile(
      'org-1',
      'project-1',
      'run-1',
      reviewStatePath,
      'crosstab-review-state.json',
    );
    expect(reviewKey).toBe('org-1/project-1/runs/run-1/review/crosstab-review-state.json');
  });

  it('reports optional-missing files separately from upload failures', async () => {
    await fs.mkdir(path.join(tempDir, 'results'), { recursive: true });
    await fs.writeFile(path.join(tempDir, 'pipeline-summary.json'), '{"status":"success"}', 'utf8');
    await fs.writeFile(path.join(tempDir, 'results', 'crosstabs.xlsx'), 'xlsx', 'utf8');

    mocks.uploadFile.mockImplementation(async (key: string) => {
      if (key.endsWith('/results/crosstabs.xlsx')) {
        throw new Error('simulated upload failure');
      }
    });

    const manifest = await uploadPipelineOutputs('org-1', 'project-1', 'run-1', tempDir);

    expect(manifest.outputs['results/crosstabs.xlsx']).toBeUndefined();
    expect(manifest.uploadReport.failed).toContainEqual({
      relativePath: 'results/crosstabs.xlsx',
      stage: 'upload',
      error: 'simulated upload failure',
    });
    expect(manifest.uploadReport.missingOptional).toContain('results/crosstabs-weighted.xlsx');
    expect(manifest.uploadReport.failed.some((entry) => entry.relativePath === 'results/crosstabs-weighted.xlsx')).toBe(false);
  });

  it('restores the stage 21 crosstab plan during review recovery', async () => {
    mocks.downloadFile.mockResolvedValue(Buffer.from('{"ok":true}', 'utf8'));

    const downloaded = await downloadReviewFiles(
      {
        v3CrosstabPlan: 'org-1/project-1/runs/run-1/review/planning/21-crosstab-plan.json',
      },
      tempDir,
    );

    const restoredPath = path.join(tempDir, 'planning', '21-crosstab-plan.json');
    expect(downloaded.v3CrosstabPlan).toBe(restoredPath);
    await expect(fs.readFile(restoredPath, 'utf8')).resolves.toBe('{"ok":true}');
  });

  it('only deletes transient review artifacts after completion', async () => {
    await deleteReviewFiles({
      reviewState: 'org-1/project-1/runs/run-1/crosstab-review-state.json',
      pathBResult: 'org-1/project-1/runs/run-1/stages/path-b-result.json',
      v3CrosstabPlan: 'org-1/project-1/runs/run-1/planning/21-crosstab-plan.json',
      v3TableEnriched: 'org-1/project-1/runs/run-1/tables/13e-table-enriched.json',
      v3QuestionIdFinal: 'org-1/project-1/runs/run-1/enrichment/12-questionid-final.json',
      v3Checkpoint: 'org-1/project-1/runs/run-1/checkpoint.json',
      pipelineSummary: 'org-1/project-1/runs/run-1/pipeline-summary.json',
      dataFileSav: 'org-1/project-1/runs/run-1/dataFile.sav',
      spssInput: 'org-1/project-1/runs/run-1/inputs/source.sav',
    });

    expect(mocks.deleteFile).toHaveBeenCalledTimes(2);
    expect(mocks.deleteFile).toHaveBeenCalledWith('org-1/project-1/runs/run-1/crosstab-review-state.json');
    expect(mocks.deleteFile).toHaveBeenCalledWith('org-1/project-1/runs/run-1/stages/path-b-result.json');
    expect(mocks.deleteFile).not.toHaveBeenCalledWith('org-1/project-1/runs/run-1/planning/21-crosstab-plan.json');
    expect(mocks.deleteFile).not.toHaveBeenCalledWith('org-1/project-1/runs/run-1/tables/13e-table-enriched.json');
    expect(mocks.deleteFile).not.toHaveBeenCalledWith('org-1/project-1/runs/run-1/checkpoint.json');
    expect(mocks.deleteFile).not.toHaveBeenCalledWith('org-1/project-1/runs/run-1/dataFile.sav');
  });
});
