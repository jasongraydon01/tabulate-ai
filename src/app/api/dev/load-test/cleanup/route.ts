/**
 * POST /api/dev/load-test/cleanup
 *
 * Soft-deletes all projects matching a name prefix, along with their runs.
 * Best-effort R2 cleanup.
 *
 * Admin-only, dev-mode only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { deletePrefix } from '@/lib/r2/r2';
import { api, internal } from '../../../../../../convex/_generated/api';
import { LOAD_TEST_SEPARATOR, type LoadTestCleanupResult } from '@/lib/loadTest/types';

const CleanupRequestSchema = z.object({
  namePrefix: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\s\-\/.]+$/),
});

export async function POST(request: NextRequest) {
  // Dev-only gate
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'high', 'dev/load-test/cleanup');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'delete_project')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const parsed = CleanupRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { namePrefix } = parsed.data;
    const prefix = `${namePrefix}${LOAD_TEST_SEPARATOR}`;

    // Find matching projects
    const convex = getConvexClient();
    const allProjects = await convex.query(api.projects.listByOrg, {
      orgId: auth.convexOrgId,
    });

    const matchingProjects = allProjects.filter(p =>
      p.name.startsWith(prefix)
    );

    if (matchingProjects.length === 0) {
      const result: LoadTestCleanupResult = {
        projectsDeleted: 0,
        projectNames: [],
      };
      return NextResponse.json(result);
    }

    const deletedNames: string[] = [];
    const orgId = auth.convexOrgId;

    for (const project of matchingProjects) {
      try {
        // Delete runs first
        await mutateInternal(internal.runs.deleteByProject, {
          projectId: project._id,
          orgId,
        });

        // Soft-delete project
        await mutateInternal(internal.projects.softDelete, {
          projectId: project._id,
          orgId,
        });

        deletedNames.push(project.name);

        // Best-effort R2 cleanup
        const r2Prefix = `${String(orgId)}/${String(project._id)}/`;
        try {
          await deletePrefix(r2Prefix);
        } catch (r2Err) {
          console.warn(`[LoadTest/cleanup] R2 cleanup failed for ${project.name}:`, r2Err);
        }
      } catch (err) {
        console.error(`[LoadTest/cleanup] Failed to delete ${project.name}:`, err);
      }
    }

    console.log(`[LoadTest/cleanup] Deleted ${deletedNames.length} projects with prefix "${prefix}"`);

    const result: LoadTestCleanupResult = {
      projectsDeleted: deletedNames.length,
      projectNames: deletedNames,
    };

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error('[LoadTest/cleanup] Error:', error);
    return NextResponse.json(
      { error: 'Cleanup failed' },
      { status: 500 },
    );
  }
}
