import '../src/lib/loadEnv';

import { mutateInternal } from '@/lib/convex';
import { internal } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';

function parseArgs(argv: string[]): { runId: string } {
  const runId = argv[0];
  if (!runId) {
    throw new Error('Usage: npx tsx scripts/retry-run-from-checkpoint.ts <runId>');
  }
  return { runId };
}

async function main(): Promise<void> {
  const { runId } = parseArgs(process.argv.slice(2));
  await mutateInternal(internal.runs.enqueueCheckpointRetry, {
    runId: runId as Id<'runs'>,
  });
  console.log(`[Checkpoint Retry] Queued retry for run ${runId}`);
}

main().catch((error) => {
  console.error(
    '[Checkpoint Retry] Failed:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
