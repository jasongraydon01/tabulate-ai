import { api } from '../../../../convex/_generated/api';
import type { Id } from '../../../../convex/_generated/dataModel';
import { getConvexClient } from '@/lib/convex';

export function isAnalysisComputeAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export async function assertAnalysisRunNotCancelled(params: {
  runId: string;
  orgId: string;
  abortSignal?: AbortSignal;
}): Promise<void> {
  if (params.abortSignal?.aborted) {
    throw new DOMException('Analysis compute run cancelled', 'AbortError');
  }

  try {
    const liveRun = await getConvexClient().query(api.runs.get, {
      runId: params.runId as Id<'runs'>,
      orgId: params.orgId as Id<'organizations'>,
    });
    if (liveRun?.cancelRequested || liveRun?.status === 'cancelled') {
      throw new DOMException('Analysis compute run cancelled', 'AbortError');
    }
  } catch (error) {
    if (isAnalysisComputeAbortError(error)) throw error;
  }
}
