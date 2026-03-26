import { describe, expect, it } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { writeTableSnapshot } from '../writeTableSnapshot';

describe('writeTableSnapshot', () => {
  it('supports stage suffix naming for 04b-enhanced snapshots', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'snapshot-test-'));
    const tables = [{ tableId: 'q1' }];

    await writeTableSnapshot(outputDir, 4, 'enhanced', tables, {
      stageSuffix: 'b',
      previousStage: 'filter-applicator',
    });

    const snapshotPath = path.join(outputDir, 'tables', '04b-enhanced.json');
    const raw = await fs.readFile(snapshotPath, 'utf-8');
    const parsed = JSON.parse(raw) as {
      _metadata: { stageNumber: number; stageSuffix?: string; previousStage?: string };
      tables: unknown[];
    };

    expect(parsed._metadata.stageNumber).toBe(4);
    expect(parsed._metadata.stageSuffix).toBe('b');
    expect(parsed._metadata.previousStage).toBe('filter-applicator');
    expect(parsed.tables).toHaveLength(1);
  });
});
