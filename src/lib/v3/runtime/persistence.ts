/**
 * V3 Runtime — Shared Artifact Persistence Helpers
 *
 * Common JSON persistence primitives for stage orchestrators.
 * Keeps artifact/checkpoint read-write behavior consistent across chains.
 *
 * V2 layout: artifacts are organized into phase subdirectories
 * (enrichment/, tables/, planning/, compute/) instead of a flat stages/ dir.
 * Backward-compat fallback reads from the legacy stages/ layout.
 */

import fs from 'fs/promises';
import path from 'path';

import {
  V3_STAGE_ARTIFACTS,
  V3_CHECKPOINT_FILENAME,
  isCheckpointCompatible,
  type V3PipelineCheckpoint,
} from './contracts';
import type { V3StageId } from './stageOrder';

// =============================================================================
// Legacy Mapping (backward-compat reads only)
// =============================================================================

/** Legacy flat-file artifact names from schema version 1 (stages/ layout). */
const LEGACY_STAGE_ARTIFACTS: Partial<Record<V3StageId, string>> = {
  '00':   'stages/questionid.json',
  '03':   'stages/questionid-base.json',
  '08a':  'stages/questionid-label.json',
  '09d':  'stages/questionid-message.json',
  '10a':  'stages/questionid-loop-resolved.json',
  '10':   'stages/questionid-triage.json',
  '11':   'stages/questionid-validated.json',
  '12':   'stages/questionid-final.json',
  '13b':  'stages/table-plan.json',
  '13c1': 'stages/table-plan-validated.json',
  '13c2': 'stages/table-plan-validated.json',
  '13d':  'stages/table.json',
  '20':   'stages/banner-plan.json',
  '21':   'stages/crosstab-plan.json',
  '22':   'stages/r-script-input.json',
};

/** Legacy checkpoint path from schema version 1. */
const LEGACY_CHECKPOINT_PATH = 'stages/v3-checkpoint.json';

// =============================================================================
// Path Resolution
// =============================================================================

/**
 * @deprecated Use getSubDir() instead. Kept temporarily for transition.
 * Returns the legacy stages/ directory path.
 */
export function getStagesDir(outputDir: string): string {
  return path.join(outputDir, 'stages');
}

/** Get a phase subdirectory path. */
export function getSubDir(
  outputDir: string,
  subdir: 'enrichment' | 'tables' | 'planning' | 'compute' | 'results' | 'agents',
): string {
  return path.join(outputDir, subdir);
}

export function getArtifactPath(outputDir: string, stageId: V3StageId): string | null {
  const relativePath = V3_STAGE_ARTIFACTS[stageId];
  if (!relativePath) return null;
  return path.join(outputDir, relativePath);
}

export function getCheckpointPath(outputDir: string): string {
  return path.join(outputDir, V3_CHECKPOINT_FILENAME);
}

// =============================================================================
// Write Operations
// =============================================================================

export async function writeArtifact(
  outputDir: string,
  stageId: V3StageId,
  data: unknown,
): Promise<string> {
  const artifactPath = getArtifactPath(outputDir, stageId);
  if (!artifactPath) return outputDir;

  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  await fs.writeFile(artifactPath, JSON.stringify(data, null, 2), 'utf-8');
  return artifactPath;
}

export async function writeCheckpoint(
  outputDir: string,
  checkpoint: V3PipelineCheckpoint,
): Promise<void> {
  const cpPath = getCheckpointPath(outputDir);
  await fs.mkdir(path.dirname(cpPath), { recursive: true });
  await fs.writeFile(cpPath, JSON.stringify(checkpoint, null, 2), 'utf-8');
}

// =============================================================================
// Read Operations (with backward-compat fallback)
// =============================================================================

export async function loadArtifact<T>(
  outputDir: string,
  stageId: V3StageId,
): Promise<T | null> {
  const artifactPath = getArtifactPath(outputDir, stageId);
  if (!artifactPath) return null;

  try {
    const raw = await fs.readFile(artifactPath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    // Backward-compat fallback: try legacy stages/ path
    const legacyRelative = LEGACY_STAGE_ARTIFACTS[stageId];
    if (legacyRelative) {
      try {
        const raw = await fs.readFile(path.join(outputDir, legacyRelative), 'utf-8');
        return JSON.parse(raw) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function loadCheckpoint(outputDir: string): Promise<V3PipelineCheckpoint | null> {
  // Try new path first (outputDir/checkpoint.json)
  try {
    const raw = JSON.parse(
      await fs.readFile(getCheckpointPath(outputDir), 'utf-8'),
    ) as V3PipelineCheckpoint;
    if (isCheckpointCompatible(raw)) return raw;
    return null;
  } catch {
    // Backward-compat fallback: try legacy path (stages/v3-checkpoint.json)
    // Note: schema version 1→2 bump means old checkpoints will fail
    // isCheckpointCompatible(), which is intentional — old runs can't resume
    // into the new layout.
    try {
      const raw = JSON.parse(
        await fs.readFile(path.join(outputDir, LEGACY_CHECKPOINT_PATH), 'utf-8'),
      ) as V3PipelineCheckpoint;
      if (isCheckpointCompatible(raw)) return raw;
      return null;
    } catch {
      return null;
    }
  }
}
