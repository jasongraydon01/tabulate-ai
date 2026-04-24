import '../src/lib/loadEnv';

import { promises as fs } from 'fs';

import {
  buildRecoveryRestoreOutputDir,
  resolveRecoveryManifestPath,
} from '@/lib/worker/recoveryDev';
import { restoreDurableRecoveryWorkspace } from '@/lib/worker/recoveryPersistence';
import type { WorkerRecoveryBoundary, WorkerRecoveryManifest } from '@/lib/worker/recovery';

function parseArgs(argv: string[]): {
  inputPath: string;
  outputDir?: string;
  boundary?: WorkerRecoveryBoundary;
  checkOnly: boolean;
} {
  const positional: string[] = [];
  let outputDir: string | undefined;
  let boundary: WorkerRecoveryBoundary | undefined;
  let checkOnly = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      outputDir = argv[i + 1] ?? undefined;
      i += 1;
      continue;
    }
    if (arg === '--boundary') {
      const value = argv[i + 1] ?? '';
      if (value === 'question_id' || value === 'fork_join' || value === 'review_checkpoint' || value === 'compute') {
        boundary = value;
      } else {
        throw new Error(`Invalid --boundary "${value}"`);
      }
      i += 1;
      continue;
    }
    if (arg === '--check-only') {
      checkOnly = true;
      continue;
    }
    positional.push(arg);
  }

  const inputPath = positional[0];
  if (!inputPath) {
    throw new Error(
      'Usage: npx tsx scripts/restore-recovery-workspace.ts <manifest.json|downloaded-run-dir> [--boundary <question_id|fork_join|review_checkpoint|compute>] [--out <dir>] [--check-only]',
    );
  }

  return { inputPath, outputDir, boundary, checkOnly };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = resolveRecoveryManifestPath({
    inputPath: args.inputPath,
    boundary: args.boundary,
  });
  const manifestRaw = await fs.readFile(manifestPath, 'utf-8');
  const manifest = JSON.parse(manifestRaw) as WorkerRecoveryManifest;
  const restoreOutputDir = buildRecoveryRestoreOutputDir({
    manifest,
    explicitOutputDir: args.outputDir,
  });

  const effectiveManifest: WorkerRecoveryManifest = {
    ...manifest,
    pipelineContext: {
      ...manifest.pipelineContext,
      outputDir: restoreOutputDir,
    },
  };

  console.log(`[Recovery Restore] Manifest: ${manifestPath}`);
  console.log(`[Recovery Restore] Boundary: ${effectiveManifest.boundary}`);
  console.log(`[Recovery Restore] Resume stage: ${effectiveManifest.resumeStage}`);
  console.log(`[Recovery Restore] Original outputDir: ${manifest.pipelineContext.outputDir}`);
  console.log(`[Recovery Restore] Restore outputDir: ${effectiveManifest.pipelineContext.outputDir}`);

  if (args.checkOnly) {
    console.log('[Recovery Restore] Check-only mode: manifest resolved and output path validated.');
    return;
  }

  await restoreDurableRecoveryWorkspace(effectiveManifest);
  console.log('[Recovery Restore] Workspace restored successfully.');
}

main().catch((error) => {
  console.error('[Recovery Restore] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
