/**
 * Stages Manifest — Human-friendly summary of pipeline stage execution.
 *
 * Generates `stages.json` from existing checkpoint data. No new data
 * collection — this is a read-only aggregation of what the checkpoint
 * and stage order already know.
 */

import fs from 'fs/promises';
import path from 'path';

import { loadCheckpoint } from './persistence';
import { V3_STAGE_ORDER, V3_STAGE_NAMES, V3_STAGE_PHASES, type V3StageId } from './stageOrder';
import { V3_STAGE_ARTIFACTS } from './contracts';

interface StageManifestEntry {
  stageId: string;
  name: string;
  phase: string;
  status: 'completed' | 'skipped' | 'pending';
  durationMs: number | null;
  completedAt: string | null;
  artifactPath: string | null;
}

interface StagesManifest {
  generatedAt: string;
  stageCount: number;
  completedCount: number;
  stages: StageManifestEntry[];
}

export async function writeStagesManifest(outputDir: string): Promise<void> {
  const checkpoint = await loadCheckpoint(outputDir);

  const completedMap = new Map<string, { durationMs: number; completedAt: string; artifactPath: string | null }>();
  if (checkpoint) {
    for (const stage of checkpoint.completedStages) {
      completedMap.set(stage.completedStage, {
        durationMs: stage.durationMs,
        completedAt: stage.completedAt,
        artifactPath: stage.artifactPath,
      });
    }
  }

  const stages: StageManifestEntry[] = V3_STAGE_ORDER.map((stageId: V3StageId) => {
    const completed = completedMap.get(stageId);
    return {
      stageId,
      name: V3_STAGE_NAMES[stageId],
      phase: V3_STAGE_PHASES[stageId],
      status: completed ? 'completed' : 'pending',
      durationMs: completed?.durationMs ?? null,
      completedAt: completed?.completedAt ?? null,
      artifactPath: completed?.artifactPath ?? V3_STAGE_ARTIFACTS[stageId] ?? null,
    };
  });

  const manifest: StagesManifest = {
    generatedAt: new Date().toISOString(),
    stageCount: stages.length,
    completedCount: completedMap.size,
    stages,
  };

  await fs.writeFile(
    path.join(outputDir, 'stages.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );
}
