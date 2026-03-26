/**
 * GET + POST /api/runs/[runId]/feedback
 * Read and submit feedback for a pipeline run.
 * Stores feedback both in Convex (real-time) and on disk (for pipeline analysis).
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api } from '../../../../../../convex/_generated/api';
import { internal } from '../../../../../../convex/_generated/api';
import {
  PipelineFeedbackFileSchema,
  PipelineFeedbackSummarySchema,
  SubmitPipelineFeedbackRequestSchema,
  type PipelineFeedbackFile,
  type PipelineFeedbackSummary,
} from '@/schemas/pipelineFeedbackSchema';
import { findPipelineDir } from '@/lib/api/reviewCompletion';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { parseRunResult } from '@/schemas/runResultSchema';

function buildSummary(file: PipelineFeedbackFile | null): PipelineFeedbackSummary {
  if (!file || file.entries.length === 0) {
    return PipelineFeedbackSummarySchema.parse({
      hasFeedback: false,
      entryCount: 0,
      lastSubmittedAt: '',
      lastRating: 0,
    });
  }

  const last = file.entries[file.entries.length - 1];
  return PipelineFeedbackSummarySchema.parse({
    hasFeedback: true,
    entryCount: file.entries.length,
    lastSubmittedAt: last.createdAt,
    lastRating: last.rating,
  });
}

async function readFeedbackFile(feedbackPath: string): Promise<PipelineFeedbackFile | null> {
  try {
    const raw = await fs.readFile(feedbackPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return PipelineFeedbackFileSchema.parse(parsed);
  } catch {
    return null;
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }

    const auth = await requireConvexAuth();

    const rateLimitedGet = applyRateLimit(String(auth.convexOrgId), 'low', 'runs/feedback');
    if (rateLimitedGet) return rateLimitedGet;

    // Get run from Convex
    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });

    if (!run) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Try Convex feedback first
    const runResult = parseRunResult(run.result);
    const convexFeedback = runResult?.feedback;

    if (convexFeedback && convexFeedback.length > 0) {
      return NextResponse.json({
        runId,
        feedback: convexFeedback,
        summary: {
          hasFeedback: true,
          entryCount: convexFeedback.length,
          lastSubmittedAt: convexFeedback[convexFeedback.length - 1]?.createdAt || '',
          lastRating: convexFeedback[convexFeedback.length - 1]?.rating || 0,
        },
      });
    }

    // Fallback: try disk-based feedback via pipelineId
    const pipelineId = runResult?.pipelineId as string | undefined;
    if (pipelineId) {
      const pipelineInfo = await findPipelineDir(pipelineId);
      if (pipelineInfo) {
        const feedbackPath = path.join(pipelineInfo.path, 'feedback.json');
        const feedbackFile = await readFeedbackFile(feedbackPath);
        const summary = buildSummary(feedbackFile);

        return NextResponse.json({
          runId,
          pipelineId,
          dataset: pipelineInfo.dataset,
          feedback: feedbackFile,
          summary,
        });
      }
    }

    return NextResponse.json({
      runId,
      feedback: null,
      summary: { hasFeedback: false, entryCount: 0, lastSubmittedAt: '', lastRating: 0 },
    });
  } catch (error) {
    console.error('[Feedback API GET] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Failed to get feedback', details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  try {
    const { runId } = await params;

    if (!runId || !/^[a-zA-Z0-9_.-]+$/.test(runId)) {
      return NextResponse.json({ error: 'Run ID is required' }, { status: 400 });
    }

    const auth = await requireConvexAuth();

    const rateLimitedPost = applyRateLimit(String(auth.convexOrgId), 'low', 'runs/feedback');
    if (rateLimitedPost) return rateLimitedPost;

    if (!canPerform(auth.role, 'submit_review')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Get run from Convex
    const convex = getConvexClient();
    const run = await convex.query(api.runs.get, {
      runId: runId as Id<"runs">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });

    if (!run) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // Parse and validate request
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const parsed = SubmitPipelineFeedbackRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request body', details: parsed.error.flatten() }, { status: 400 });
    }

    const rating = parsed.data.rating;
    const notes = parsed.data.notes;
    const tableIds = parsed.data.tableIds
      .map(t => String(t).trim())
      .filter(Boolean);

    const hasAnySignal = (notes.trim().length > 0) || rating > 0 || tableIds.length > 0;
    if (!hasAnySignal) {
      return NextResponse.json(
        { error: 'Feedback must include at least one of: notes, rating, or table IDs' },
        { status: 400 }
      );
    }

    const now = new Date().toISOString();
    const entry = {
      id: `feedback-${randomUUID()}`,
      createdAt: now,
      rating,
      notes,
      tableIds,
    };

    // Write to Convex (real-time)
    await mutateInternal(internal.runs.addFeedbackEntry, {
      runId: runId as Id<"runs">,
      entry,
    });

    // Also write to disk if pipelineId is available (for pipeline analysis)
    const runResult = parseRunResult(run.result);
    const pipelineId = runResult?.pipelineId;
    if (pipelineId) {
      const pipelineInfo = await findPipelineDir(pipelineId);
      if (pipelineInfo) {
        const feedbackPath = path.join(pipelineInfo.path, 'feedback.json');
        try {
          const existing = await readFeedbackFile(feedbackPath);
          const feedbackFile: PipelineFeedbackFile = existing ?? {
            pipelineId,
            dataset: pipelineInfo.dataset,
            createdAt: now,
            updatedAt: now,
            entries: [],
          };

          feedbackFile.entries.push(entry);
          feedbackFile.updatedAt = now;

          const validated = PipelineFeedbackFileSchema.parse(feedbackFile);
          await fs.writeFile(feedbackPath, JSON.stringify(validated, null, 2), 'utf-8');
        } catch (diskError) {
          console.warn('[Feedback API] Disk write failed (non-fatal):', diskError);
        }
      }
    }

    return NextResponse.json({
      success: true,
      runId,
      entry,
    });
  } catch (error) {
    console.error('[Feedback API POST] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Failed to submit feedback', details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}
