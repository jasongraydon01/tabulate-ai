import '../src/lib/loadEnv';

import { promises as fs } from 'fs';
import path from 'path';
import pLimit from 'p-limit';

import { downloadFile, listAllFiles } from '@/lib/r2/r2';
import {
  extractRunArtifactPrefix,
  localPathForRunArtifact,
} from '@/lib/r2/runArtifactDownload';

function parseArgs(argv: string[]): { runPath: string; outputDir: string } {
  const positional: string[] = [];
  let outputDir: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out') {
      outputDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    positional.push(arg);
  }

  const runPath = positional[0];
  if (!runPath) {
    throw new Error(
      'Usage: npx tsx scripts/pull-run-artifacts.ts <org/project/runs/runId> [--out <dir>]',
    );
  }

  const { runId } = extractRunArtifactPrefix(runPath);
  return {
    runPath,
    outputDir: outputDir
      ? path.resolve(outputDir)
      : path.resolve(process.cwd(), 'outputs', '_r2-downloads', runId),
  };
}

async function main(): Promise<void> {
  const { runPath, outputDir } = parseArgs(process.argv.slice(2));
  const { prefix, orgId, projectId, runId } = extractRunArtifactPrefix(runPath);

  console.log(`[R2 Pull] Resolving run prefix ${prefix}`);
  const keys = (await listAllFiles(prefix)).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) {
    throw new Error(`No R2 objects found under prefix ${prefix}`);
  }

  await fs.mkdir(outputDir, { recursive: true });
  console.log(`[R2 Pull] Downloading ${keys.length} artifact(s) to ${outputDir}`);

  const limit = pLimit(8);
  await Promise.all(
    keys.map((key) =>
      limit(async () => {
        const localPath = localPathForRunArtifact(outputDir, prefix, key);
        const body = await downloadFile(key);
        await fs.mkdir(path.dirname(localPath), { recursive: true });
        await fs.writeFile(localPath, body);
      }),
    ),
  );

  const manifest = {
    downloadedAt: new Date().toISOString(),
    orgId,
    projectId,
    runId,
    prefix,
    outputDir,
    fileCount: keys.length,
    keys,
  };
  await fs.writeFile(
    path.join(outputDir, '_download-manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8',
  );

  console.log(`[R2 Pull] Download complete: ${keys.length} artifact(s)`);
  console.log(`[R2 Pull] Manifest: ${path.join(outputDir, '_download-manifest.json')}`);
}

main().catch((error) => {
  console.error('[R2 Pull] Failed:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
