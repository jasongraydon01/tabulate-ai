/**
 * POST /api/runs/[runId]/review
 * Submit review decisions and resume pipeline.
 * UI reads review state from Convex subscriptions (no GET needed).
 */
import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import * as path from 'path';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api } from '../../../../../../convex/_generated/api';
import { internal } from '../../../../../../convex/_generated/api';
import {
  uploadPipelineOutputs,
  downloadReviewFiles,
  deleteReviewFiles,
  uploadRunOutputArtifact,
  type ReviewR2Keys,
} from '@/lib/r2/R2FileManager';
import {
  completePipeline,
  assertSelectableAlternatives,
  InvalidReviewDecisionError,
} from '@/lib/api/reviewCompletion';
import { formatDuration } from '@/lib/utils/formatDuration';
import {
  buildExportArtifactRefs,
  buildPhase1Manifest,
  finalizeExportMetadataWithR2Refs,
} from '@/lib/exportData';
import { ensureAbortController } from '@/lib/abortStore';
import { ReviewSubmissionSchema } from '@/schemas/crosstabDecisionSchema';
import type { GroupHint } from '@/schemas/crosstabDecisionSchema';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import type { CrosstabReviewState } from '@/lib/api/types';
import { applyRateLimit } from '@/lib/withRateLimit';
import { canPerform } from '@/lib/permissions';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { sendHeartbeat } from '@/lib/api/heartbeat';
import { sendPipelineNotification } from '@/lib/notifications/email';
import { evaluateAndPersistRunQuality } from '@/lib/evaluation/runEvaluationService';
import type { V3PipelineStage } from '@/schemas/pipelineStageSchema';
import { parseRunResult, type RunResultShape } from '@/schemas/runResultSchema';
import { loadCheckpoint } from '@/lib/v3/runtime/persistence';

type RunStatus = 'in_progress' | 'pending_review' | 'resuming' | 'success' | 'partial' | 'error' | 'cancelled';
const MISSING_CHECKPOINT_ERROR =
  'Review checkpoint was lost after a server restart. Please start a new run.';

async function fileExists(absolutePath: string): Promise<boolean> {
  try {
    await fs.access(absolutePath);
    return true;
  } catch {
    return false;
  }
}

async function updateReviewRouteRunStatus(runId: string, updates: {
  status: RunStatus;
  stage?: V3PipelineStage;
  progress?: number;
  message?: string;
  result?: RunResultShape;
  error?: string;
}): Promise<void> {
  await mutateInternal(internal.runs.updateStatus, {
    runId: runId as Id<'runs'>,
    status: updates.status,
    ...(updates.stage !== undefined && { stage: updates.stage }),
    ...(updates.progress !== undefined && { progress: updates.progress }),
    ...(updates.message !== undefined && { message: updates.message }),
    ...(updates.result !== undefined && { result: updates.result }),
    ...(updates.error !== undefined && { error: updates.error }),
  });
}

async function resolveResumeCheckpoint(params: {
  outputDir: string;
  reviewState: CrosstabReviewState;
  runResult: ReturnType<typeof parseRunResult>;
}): Promise<{ checkpoint: NonNullable<CrosstabReviewState['v3Checkpoint']>; source: 'reviewState' | 'artifact' | 'convex' } | null> {
  const { outputDir, reviewState, runResult } = params;

  if (reviewState.v3Checkpoint) {
    return { checkpoint: reviewState.v3Checkpoint, source: 'reviewState' };
  }

  const artifactCheckpoint = await loadCheckpoint(outputDir);
  if (artifactCheckpoint) {
    return { checkpoint: artifactCheckpoint, source: 'artifact' };
  }

  if (runResult?.v3Checkpoint) {
    return { checkpoint: runResult.v3Checkpoint, source: 'convex' };
  }

  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  let outerRunId: string | undefined;
  try {
    const { runId: rawRunId } = await params;
    outerRunId = rawRunId;

    if (!rawRunId || !/^[a-zA-Z0-9_.-]+$/.test(rawRunId)) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }
    const runId = rawRunId; // narrowed to string for the rest of the try block

    // Authenticate
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'high', 'runs/review');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'submit_review')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get run from Convex (orgId enforced at query level)
    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });

    if (!run) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Parse and validate request body
    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = ReviewSubmissionSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid decisions payload', details: getApiErrorDetails(parsed.error) },
        { status: 400 }
      );
    }
    const decisions = parsed.data.decisions;
    const groupHints: GroupHint[] = parsed.data.groupHints ?? [];
    const abortSignal = ensureAbortController(runId);

    // Get pipelineId from run result
    const runResult = parseRunResult(run.result);
    const pipelineId = runResult?.pipelineId;
    const outputDir = runResult?.outputDir;

    if (!pipelineId || !outputDir) {
      return NextResponse.json(
        { error: 'Run does not have pipeline context (pipelineId/outputDir missing)' },
        { status: 400 }
      );
    }

    // Validate outputDir resolves under the expected outputs directory
    const resolvedOutput = path.resolve(outputDir);
    const allowedBase = path.resolve(process.cwd(), 'outputs');
    if (!resolvedOutput.startsWith(allowedBase + path.sep) && resolvedOutput !== allowedBase) {
      return NextResponse.json({ error: 'Invalid output path' }, { status: 400 });
    }

    // Read review state from disk, with R2 fallback for container restart recovery
    const reviewStatePath = path.join(outputDir, 'crosstab-review-state.json');
    let reviewState: CrosstabReviewState;
    let recoveredFromR2 = false;
    let recoveredOutputDir = outputDir;
    // Runtime-validate reviewR2Keys shape from v.any() Convex field
    const reviewR2Keys = runResult?.reviewR2Keys as ReviewR2Keys | undefined;

    try {
      reviewState = JSON.parse(await fs.readFile(reviewStatePath, 'utf-8'));
    } catch {
      // Local file missing — try R2 recovery
      if (reviewR2Keys?.reviewState) {
        console.log('[Review API] Local review state missing — attempting R2 recovery');
        try {
          recoveredOutputDir = path.join(process.cwd(), 'outputs', '_recovered', runId);
          await downloadReviewFiles(reviewR2Keys, recoveredOutputDir);

          const recoveredPath = path.join(recoveredOutputDir, 'crosstab-review-state.json');
          reviewState = JSON.parse(await fs.readFile(recoveredPath, 'utf-8'));
          // Update outputDir reference in review state to point to recovered location
          reviewState.outputDir = recoveredOutputDir;
          recoveredFromR2 = true;
          console.log('[Review API] Successfully recovered review state from R2');
        } catch (r2Err) {
          console.error('[Review API] R2 recovery failed:', r2Err);
          const isReviewRun = run.status === 'pending_review';
          return NextResponse.json(
            { error: isReviewRun
                ? 'Review state was lost after a server restart. Please start a new run.'
                : 'Review state not found - pipeline may not require review' },
            { status: isReviewRun ? 409 : 404 }
          );
        }
      } else {
        const isReviewRun = run.status === 'pending_review';
        return NextResponse.json(
          { error: isReviewRun
              ? 'Review state was lost after a server restart. Please start a new run.'
              : 'Review state not found - pipeline may not require review' },
          { status: isReviewRun ? 409 : 404 }
        );
      }
    }

    if (reviewState.status !== 'awaiting_review') {
      return NextResponse.json(
        { error: `Cannot submit review - status is ${reviewState.status}` },
        { status: 400 }
      );
    }

    try {
      assertSelectableAlternatives(decisions, reviewState.flaggedColumns);
    } catch (validationError) {
      if (validationError instanceof InvalidReviewDecisionError) {
        return NextResponse.json({ error: validationError.message }, { status: 400 });
      }
      throw validationError;
    }

    const activeOutputDir = recoveredFromR2 ? recoveredOutputDir : outputDir;
    const checkpointRecovery = await resolveResumeCheckpoint({
      outputDir: activeOutputDir,
      reviewState,
      runResult,
    });

    if (!checkpointRecovery) {
      return NextResponse.json(
        { error: MISSING_CHECKPOINT_ERROR },
        { status: 409 }
      );
    }

    reviewState.v3Checkpoint = checkpointRecovery.checkpoint;
    console.log(`[Review API] Resuming with checkpoint from ${checkpointRecovery.source}`);

    console.log(`[Review API] wizardConfig in review state: present=${reviewState.wizardConfig !== undefined}, displayMode=${reviewState.wizardConfig?.displayMode ?? 'undefined'}, separateWorkbooks=${reviewState.wizardConfig?.separateWorkbooks ?? 'undefined'}`);
    console.log(`[Review API] Processing review for run ${runId} with ${decisions.length} decisions`);

    // Save decisions to review state on disk
    reviewState.status = 'approved';
    reviewState.decisions = decisions;
    await fs.writeFile(
      path.join(activeOutputDir, 'crosstab-review-state.json'),
      JSON.stringify(reviewState, null, 2)
    );

    // Update Convex: mark run as resuming
    await updateReviewRouteRunStatus(runId, {
      status: 'resuming',
      stage: 'applying_review',
      progress: 55,
      message: 'Applying review decisions...',
    });

    // Decisions are applied inside completePipeline() (within ConsoleCapture scope)
    // so hint re-run logs are captured in pipeline.log
    const totalFlaggedColumns = reviewState.flaggedColumns.length;
    console.log(`[Review API] Passing ${decisions.length} decisions for ${totalFlaggedColumns} flagged columns to pipeline`);

    // V3 runtime: both chains (canonical + planning) complete before review.
    // No Path B polling needed — call completePipeline directly.
    {
      await updateReviewRouteRunStatus(runId, {
        status: 'resuming',
        stage: 'compute',
        progress: 55,
        message: 'Running compute chain and generating output...',
      });

      let result;
      try {
        result = await completePipeline(
          activeOutputDir,
          pipelineId,
          reviewState.crosstabResult,
          null,
          reviewState,
          decisions,
          runId,
          abortSignal,
          groupHints,
          String(run.projectId),
          String(run.orgId),
        );
      } catch (pipeErr) {
        const isCancelled =
          (pipeErr instanceof DOMException && pipeErr.name === 'AbortError') ||
          (pipeErr instanceof Error && (pipeErr.message.includes('AbortError') || pipeErr.message.includes('cancelled')));
        if (isCancelled) {
          await updateReviewRouteRunStatus(runId, {
            status: 'cancelled',
            stage: 'cancelled',
            progress: 100,
            message: 'Pipeline cancelled by user',
          });
          return NextResponse.json({
            success: false,
            runId,
            status: 'cancelled',
            message: 'Pipeline cancelled by user',
          });
        }
        // Keep R2 review files on non-cancel failure so the user can retry.
        // They will be cleaned up on the next successful completion or via TTL.
        throw pipeErr;
      }

      // Upload outputs to R2
      const convexOrgId = String(auth.convexOrgId);
      const projectId = String(run.projectId);
      let r2Outputs: Record<string, string> | undefined;
      let r2UploadFailed = false;
      try {
        const manifest = await uploadPipelineOutputs(convexOrgId, projectId, runId, activeOutputDir);
        r2Outputs = manifest.outputs;
        r2UploadFailed = manifest.uploadReport.failed.length > 0;
        console.log(`[Review API] Uploaded ${Object.keys(r2Outputs).length} outputs to R2`);
        if (r2UploadFailed) {
          console.warn(
            `[Review API] ${manifest.uploadReport.failed.length} artifact upload(s) failed for run ${runId}`,
          );
          Sentry.captureMessage('R2 artifact upload partially failed after retries (review path)', {
            level: 'warning',
            tags: { run_id: runId },
            extra: {
              failedCount: manifest.uploadReport.failed.length,
              failedArtifacts: manifest.uploadReport.failed.map(f => f.relativePath),
              successCount: Object.keys(r2Outputs).length,
            },
          });
        }
      } catch (r2Error) {
        r2UploadFailed = true;
        console.error('[Review API] R2 upload failed — downloads will be unavailable:', r2Error);
        Sentry.captureException(r2Error, {
          tags: { run_id: runId },
          extra: { context: 'R2 pipeline output upload failed completely after retries (review path)' },
        });
      }

      // Clean up R2 review state files (non-fatal)
      if (reviewR2Keys) {
        try {
          await deleteReviewFiles(reviewR2Keys);
          console.log('[Review API] Cleaned up R2 review files');
        } catch (cleanupErr) {
          console.warn('[Review API] R2 review file cleanup failed (non-fatal):', cleanupErr);
        }
      }

      // Clean up recovered directory (non-fatal, ephemeral disk handles this on redeploy)
      if (recoveredFromR2 && recoveredOutputDir !== outputDir) {
        fs.rm(recoveredOutputDir, { recursive: true }).catch(() => { /* best-effort */ });
      }

      // Keep heartbeat alive while R2 work completes (heartbeat stopped when completePipeline returned)
      await sendHeartbeat(runId);

      // Downgrade to 'partial' if pipeline succeeded but R2 upload failed (files can't be downloaded)
      const terminalStatus = result.status === 'success' && r2UploadFailed ? 'partial' : result.status;
      const terminalMessage = result.status === 'success' && r2UploadFailed
        ? `Generated ${result.tableCount ?? 0} tables but file upload failed — contact support.`
        : result.message;

      let exportArtifacts = result.exportArtifacts;
      let exportReadiness = result.exportReadiness;
      const exportErrors = [...(result.exportErrors ?? [])];
      if (r2Outputs) {
        try {
          const metadataPath = path.join(activeOutputDir, 'export', 'export-metadata.json');
          if (await fileExists(metadataPath)) {
            await finalizeExportMetadataWithR2Refs(activeOutputDir, r2Outputs);
            const refreshedManifest = await buildPhase1Manifest(activeOutputDir);
            const refreshedMetadataBuffer = await fs.readFile(metadataPath);
            r2Outputs['export/export-metadata.json'] = await uploadRunOutputArtifact({
              orgId: String(run.orgId),
              projectId: String(run.projectId),
              runId,
              relativePath: 'export/export-metadata.json',
              body: refreshedMetadataBuffer,
              contentType: 'application/json',
              existingOutputs: r2Outputs,
            });
            exportArtifacts = buildExportArtifactRefs(refreshedManifest.metadata);
            exportReadiness = refreshedManifest.metadata.readiness;
          }
        } catch (exportFinalizeErr) {
          exportErrors.push({
            format: 'shared',
            stage: 'contract_build',
            message: exportFinalizeErr instanceof Error ? exportFinalizeErr.message : String(exportFinalizeErr),
            retryable: true,
            timestamp: new Date().toISOString(),
          });
        }
      }

      const qualityEval = await evaluateAndPersistRunQuality({
        runId,
        outputDir: activeOutputDir,
        orgId: String(run.orgId),
        projectId: String(run.projectId),
      });

      // Update Convex with terminal status
      const terminalResult: RunResultShape = {
        ...(runResult ?? {}),
        formatVersion: 3,
        pipelineId,
        downloadUrl: terminalStatus === 'success'
          ? `/api/runs/${encodeURIComponent(runId)}/download/crosstabs.xlsx`
          : undefined,
        r2Files: r2Outputs ? { inputs: {}, outputs: r2Outputs } : runResult?.r2Files,
        reviewState: undefined, // Clear review state from result
        summary: {
          tables: result.tableCount ?? 0,
          cuts: result.cutCount ?? 0,
          bannerGroups: result.bannerGroups ?? 0,
          durationMs: result.durationMs ?? 0,
        },
        pipelineDecisions: result.pipelineDecisions,
        decisionsSummary: result.decisionsSummary,
        ...(exportArtifacts ? { exportArtifacts: exportArtifacts as unknown as RunResultShape['exportArtifacts'] } : {}),
        ...(exportReadiness ? { exportReadiness: exportReadiness as RunResultShape['exportReadiness'] } : {}),
        ...(exportErrors.length > 0 ? { exportErrors } : {}),
        quality: qualityEval.quality as RunResultShape['quality'],
      };

      await updateReviewRouteRunStatus(runId, {
        status: terminalStatus,
        stage: 'complete',
        progress: 100,
        message: terminalMessage,
        result: terminalResult,
        ...(terminalStatus === 'error' ? { error: terminalMessage } : {}),
      });

      // Record billing usage on first successful run for this project
      if (terminalStatus === 'success' || terminalStatus === 'partial') {
        try {
          const { recordProjectUsage } = await import('@/lib/billing/recordProjectUsage');
          await recordProjectUsage({
            projectId: String(run.projectId),
            orgId: String(auth.convexOrgId),
          });
        } catch (err) {
          console.warn('[Review] Billing usage recording failed (non-blocking):', err);
        }
      }

      // Send email notification (fire-and-forget)
      const launchedBy = (run as Record<string, unknown>).launchedBy as string | undefined;
      sendPipelineNotification({
        runId,
        status: terminalStatus as 'success' | 'partial' | 'error',
        launchedBy,
        convexProjectId: String(run.projectId),
        convexOrgId: String(auth.convexOrgId),
        tableCount: result.tableCount,
        durationFormatted: result.durationMs ? formatDuration(result.durationMs) : undefined,
        errorMessage: terminalStatus === 'error' ? terminalMessage : undefined,
      }).catch(() => { /* swallowed */ });

      return NextResponse.json({
        success: result.success,
        runId,
        status: terminalStatus,
        message: terminalMessage,
        ...(result.reviewDiff ? { reviewDiff: { summary: result.reviewDiff.summary } } : {}),
      });
    }
  } catch (error) {
    console.error('[Review API POST] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof InvalidReviewDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Mark run as errored immediately so the UI doesn't show a stuck spinner
    if (outerRunId) {
      try {
        await updateReviewRouteRunStatus(outerRunId, {
          status: 'error',
          stage: 'error',
          progress: 100,
          message: 'Unexpected failure during review completion',
          error: 'Unexpected failure during review completion',
        });
      } catch { /* last resort — Convex may be unreachable */ }
    }
    return NextResponse.json(
      { error: 'Failed to process review', details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}
