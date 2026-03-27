import { mutateInternal } from '@/lib/convex';
import { internal } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { createAbortController } from '@/lib/abortStore';
import { runPipelineFromUpload, type PipelineRunParams } from '@/lib/api/pipelineOrchestrator';
import { runQueuedReviewResume } from '@/lib/api/reviewCompletion';
import type { ProjectConfig } from '@/schemas/projectConfigSchema';

import { hydrateRunInputsToSession } from './hydrateRunInputs';
import { restoreDurableRecoveryWorkspace } from './recoveryPersistence';
import type { ClaimedWorkerRun } from './types';

export async function runClaimedWorkerRun(
  claimedRun: ClaimedWorkerRun,
  workerId: string,
): Promise<void> {
  const abortSignal = createAbortController(claimedRun.runId);

  try {
    if (claimedRun.recoveryManifest && !claimedRun.recoveryManifest.isComplete) {
      throw new Error(
        `Run ${claimedRun.runId} cannot resume: durable recovery checkpoint is incomplete.`,
      );
    }

    if (claimedRun.recoveryManifest?.isComplete) {
      await restoreDurableRecoveryWorkspace(claimedRun.recoveryManifest);
    }

    if (claimedRun.recoveryManifest?.boundary === 'review_checkpoint') {
      await runQueuedReviewResume({
        runId: claimedRun.runId,
        workerId,
        outputDir: claimedRun.executionPayload.pipelineContext.outputDir,
        pipelineId: claimedRun.executionPayload.pipelineContext.pipelineId,
        projectId: claimedRun.projectId,
        orgId: claimedRun.orgId,
        abortSignal,
      });
      return;
    }

    const { savedPaths } = await hydrateRunInputsToSession(claimedRun.executionPayload);
    const pipelineParams: PipelineRunParams = {
      runId: claimedRun.runId,
      sessionId: claimedRun.executionPayload.sessionId,
      workerId,
      convexOrgId: claimedRun.orgId,
      convexProjectId: claimedRun.projectId,
      launchedBy: claimedRun.launchedBy,
      pipelineContext: claimedRun.executionPayload.pipelineContext,
      fileNames: {
        dataMap: claimedRun.executionPayload.fileNames.dataMap,
        bannerPlan: claimedRun.executionPayload.fileNames.bannerPlan,
        dataFile: claimedRun.executionPayload.fileNames.dataFile,
        survey: claimedRun.executionPayload.fileNames.survey,
      },
      savedPaths,
      abortSignal,
      loopStatTestingMode: claimedRun.executionPayload.loopStatTestingMode,
      config: claimedRun.config as ProjectConfig,
    };

    await runPipelineFromUpload(pipelineParams);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await mutateInternal(internal.runs.releaseRun, {
      runId: claimedRun.runId as Id<'runs'>,
      workerId,
      reason: error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'failed',
      message,
    });
    throw error;
  }
}
