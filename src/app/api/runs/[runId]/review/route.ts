/**
 * POST /api/runs/[runId]/review
 * Submit review decisions and resume pipeline.
 * UI reads review state from Convex subscriptions (no GET needed).
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import * as path from 'path';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api } from '../../../../../../convex/_generated/api';
import { internal } from '../../../../../../convex/_generated/api';
import {
  downloadReviewFiles,
  type ReviewR2Keys,
} from '@/lib/r2/R2FileManager';
import {
  assertSelectableAlternatives,
  InvalidReviewDecisionError,
} from '@/lib/api/reviewCompletion';
import { ReviewSubmissionSchema } from '@/schemas/crosstabDecisionSchema';
import type { GroupHint } from '@/schemas/crosstabDecisionSchema';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import type { CrosstabReviewState } from '@/lib/api/types';
import { applyRateLimit } from '@/lib/withRateLimit';
import { canPerform } from '@/lib/permissions';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { parseRunResult } from '@/schemas/runResultSchema';
import { loadCheckpoint } from '@/lib/v3/runtime/persistence';
import { persistDurableRecoveryBoundary } from '@/lib/worker/recoveryPersistence';
import {
  areRunArtifactsExpired,
  RUN_ARTIFACTS_EXPIRED_MESSAGE,
} from '@/lib/runs/artifactRetention';

const MISSING_CHECKPOINT_ERROR =
  'Review checkpoint was lost after a server restart. Please start a new run.';

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
  try {
    const { runId: rawRunId } = await params;

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

    if (areRunArtifactsExpired(run)) {
      return NextResponse.json({ error: RUN_ARTIFACTS_EXPIRED_MESSAGE }, { status: 410 });
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

    // Save decisions to the durable review state. The worker will own the
    // actual long-running resume after this request returns.
    reviewState.status = 'approved';
    reviewState.decisions = decisions;
    reviewState.groupHints = groupHints;
    reviewState.outputDir = outputDir;
    await fs.writeFile(
      path.join(activeOutputDir, 'crosstab-review-state.json'),
      JSON.stringify(reviewState, null, 2)
    );

    const pipelineContext = run.recoveryManifest?.pipelineContext ?? {
      pipelineId,
      datasetName: runResult?.dataset ?? path.basename(path.dirname(outputDir)),
      outputDir,
    };

    const reviewRecoveryManifest = await persistDurableRecoveryBoundary({
      runId,
      orgId: String(auth.convexOrgId),
      projectId: String(run.projectId),
      outputDir: activeOutputDir,
      pipelineContext,
      boundary: 'review_checkpoint',
    });

    if (!reviewRecoveryManifest.isComplete) {
      return NextResponse.json(
        {
          error:
            'Review was saved locally but the durable recovery checkpoint is incomplete. ' +
            `Missing artifacts: ${reviewRecoveryManifest.missingArtifacts.join(', ')}`,
        },
        { status: 409 },
      );
    }

    await mutateInternal(internal.runs.enqueueReviewResume, {
      runId: runId as Id<'runs'>,
      resumeFromStage: 'applying_review',
    });

    if (recoveredFromR2 && recoveredOutputDir !== outputDir) {
      fs.rm(recoveredOutputDir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
    }

    return NextResponse.json({
      success: true,
      runId,
      status: 'queued',
      message: 'Review saved. Worker resume queued.',
    });
  } catch (error) {
    console.error('[Review API POST] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof InvalidReviewDecisionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json(
      { error: 'Failed to process review', details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}
