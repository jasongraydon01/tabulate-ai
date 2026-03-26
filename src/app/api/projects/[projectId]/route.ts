/**
 * DELETE /api/projects/[projectId]
 * Hard-delete a project, its runs, and clean up R2 files.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api, internal } from '../../../../../convex/_generated/api';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { deletePrefix } from '@/lib/r2/r2';
import { getPostHogClient } from '@/lib/posthog-server';
import type { Id } from '../../../../../convex/_generated/dataModel';

/** Convex IDs are alphanumeric with possible underscores */
const CONVEX_ID_RE = /^[a-zA-Z0-9_]+$/;

/** Run statuses that indicate an active pipeline */
const ACTIVE_RUN_STATUSES = new Set(['in_progress', 'pending_review', 'resuming']);

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await params;

    // 1. Input validation
    if (!projectId || !CONVEX_ID_RE.test(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    // 2. Auth
    const auth = await requireConvexAuth();

    // 3. Rate limit (critical — destructive + cascading)
    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'critical', 'projects/delete');
    if (rateLimited) return rateLimited;

    // 4. Role check
    if (!canPerform(auth.role, 'delete_project')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 5. Org ownership verification
    const convex = getConvexClient();
    const project = await convex.query(api.projects.get, {
      projectId: projectId as Id<"projects">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });
    if (!project) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    // 6. Guard: block deletion if the project has active pipeline runs
    const runs = await convex.query(api.runs.getByProject, {
      projectId: projectId as Id<"projects">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });
    const activeRuns = runs.filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
    if (activeRuns.length > 0) {
      return NextResponse.json(
        { error: 'Cannot delete a project with active pipeline runs. Cancel or wait for completion first.' },
        { status: 409 }
      );
    }

    // 7. Hard-delete all runs FIRST (so if this fails, the project remains visible)
    const runsDeleted = await mutateInternal(internal.runs.deleteByProject, {
      projectId: projectId as Id<"projects">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });

    // 8. Hard-delete the project (after runs are gone)
    await mutateInternal(internal.projects.hardDelete, {
      projectId: projectId as Id<"projects">,
      orgId: auth.convexOrgId as Id<"organizations">,
    });

    // 9. R2 cleanup (best-effort, non-fatal)
    let r2Result = { deleted: 0, errors: 0 };
    try {
      const prefix = `${String(auth.convexOrgId)}/${projectId}/`;
      r2Result = await deletePrefix(prefix);
    } catch (err) {
      console.error('[Delete Project] R2 cleanup failed (non-fatal):', err);
    }

    // 10. Track event
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: String(auth.convexUserId),
      event: 'project_deleted',
      properties: {
        project_id: projectId,
        project_name: project.name,
        org_id: String(auth.convexOrgId),
        runs_deleted: runsDeleted,
        r2_files_deleted: r2Result.deleted,
        r2_errors: r2Result.errors,
      },
    });

    return NextResponse.json({
      success: true,
      runsDeleted,
      r2FilesDeleted: r2Result.deleted,
    });
  } catch (error) {
    console.error('[Delete Project] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      { error: 'Failed to delete project', details: getApiErrorDetails(error) },
      { status: 500 }
    );
  }
}
