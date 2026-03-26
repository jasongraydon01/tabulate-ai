import { NextRequest, NextResponse } from 'next/server';

import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { getConvexClient, mutateInternal } from '@/lib/convex';
import { api, internal } from '../../../../../../convex/_generated/api';
import type { Id } from '../../../../../../convex/_generated/dataModel';
import { ProjectConfigSchema } from '@/schemas/projectConfigSchema';
import { parseRunResult } from '@/schemas/runResultSchema';
import {
  TableLabelVocabularySchema,
  TABLE_LABEL_SLOT_ORDER,
  resolveTablePresentationConfig,
} from '@/lib/tablePresentation/labelVocabulary';
import {
  getRunTablePresentationUsedSlots,
  rebuildRunTablePresentation,
} from '@/lib/tablePresentation/rebuildService';
import { generateQExportPackage } from '@/lib/exportData/q/service';
import { generateWinCrossExportPackage } from '@/lib/exportData/wincross/service';
import type { WinCrossPreferenceSource } from '@/lib/exportData/wincross/preferenceResolver';

const CONVEX_ID_RE = /^[a-zA-Z0-9_]+$/;

function isCompletedStatus(status: string): boolean {
  return status === 'success' || status === 'partial';
}

async function resolveStoredWinCrossPreferenceSource(
  convex: ReturnType<typeof getConvexClient>,
  orgId: Id<'organizations'>,
  profileId: string | undefined,
): Promise<WinCrossPreferenceSource> {
  if (!profileId) return { kind: 'default' };

  const profile = await convex.query(api.wincrossPreferenceProfiles.getById, {
    orgId,
    profileId: profileId as Id<'wincrossPreferenceProfiles'>,
  });

  if (!profile) {
    return { kind: 'default' };
  }

  return {
    kind: 'org_profile',
    profileId: String(profile._id),
    profile: profile.profile,
    diagnostics: profile.diagnostics,
    profileName: profile.name,
  };
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    if (!projectId || !CONVEX_ID_RE.test(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'projects/table-presentation/get');
    if (rateLimited) return rateLimited;

    const convex = getConvexClient();
    const project = await convex.query(api.projects.get, {
      projectId: projectId as Id<'projects'>,
      orgId: auth.convexOrgId as Id<'organizations'>,
    });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const projectConfig = ProjectConfigSchema.parse(project.config ?? {});
    const runs = await convex.query(api.runs.getByProject, {
      projectId: projectId as Id<'projects'>,
      orgId: auth.convexOrgId as Id<'organizations'>,
    });
    const latestRun = runs[0] ?? null;
    const latestRunResult = latestRun ? parseRunResult(latestRun.result) : null;
    const r2Outputs = latestRunResult?.r2Files?.outputs ?? {};
    const usedSlots = latestRun && isCompletedStatus(latestRun.status)
      ? await getRunTablePresentationUsedSlots(r2Outputs)
      : [];

    return NextResponse.json({
      labelVocabulary: resolveTablePresentationConfig(projectConfig.tablePresentation).labelVocabulary,
      usedSlots: usedSlots.length > 0 ? usedSlots : [...TABLE_LABEL_SLOT_ORDER],
      latestRun: latestRun ? {
        runId: String(latestRun._id),
        status: latestRun.status,
        canRebuild: isCompletedStatus(latestRun.status) && Object.keys(r2Outputs).length > 0,
      } : null,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('[Table Presentation GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to load table presentation settings', details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    if (!projectId || !CONVEX_ID_RE.test(projectId)) {
      return NextResponse.json({ error: 'Invalid project ID' }, { status: 400 });
    }

    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'critical', 'projects/table-presentation/update');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'edit_project')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }

    const labelVocabulary = TableLabelVocabularySchema.parse(
      (body as Record<string, unknown>).labelVocabulary,
    );

    const convex = getConvexClient();
    const project = await convex.query(api.projects.get, {
      projectId: projectId as Id<'projects'>,
      orgId: auth.convexOrgId as Id<'organizations'>,
    });
    if (!project) {
      return NextResponse.json({ error: 'Project not found' }, { status: 404 });
    }

    const projectConfig = ProjectConfigSchema.parse(project.config ?? {});
    const nextProjectConfig = ProjectConfigSchema.parse({
      ...projectConfig,
      tablePresentation: { labelVocabulary },
    });

    await mutateInternal(internal.projects.updateConfig, {
      projectId: projectId as Id<'projects'>,
      orgId: auth.convexOrgId as Id<'organizations'>,
      config: nextProjectConfig,
    });

    const runs = await convex.query(api.runs.getByProject, {
      projectId: projectId as Id<'projects'>,
      orgId: auth.convexOrgId as Id<'organizations'>,
    });
    const latestRun = runs[0] ?? null;
    const warnings: string[] = [];
    let rebuildSummary: {
      runId: string;
      usedSlots: string[];
      updatedArtifactPaths: string[];
      rebuiltWorkbookPaths: string[];
    } | null = null;

    if (latestRun && isCompletedStatus(latestRun.status)) {
      const runConfig = ProjectConfigSchema.parse(latestRun.config ?? {});
      const nextRunConfig = ProjectConfigSchema.parse({
        ...runConfig,
        tablePresentation: { labelVocabulary },
      });
      const runResult = parseRunResult(latestRun.result);

      if (runResult?.r2Files?.outputs) {
        await mutateInternal(internal.runs.updateConfig, {
          runId: latestRun._id,
          orgId: auth.convexOrgId as Id<'organizations'>,
          config: nextRunConfig,
        });

        const rebuild = await rebuildRunTablePresentation({
          orgId: String(auth.convexOrgId),
          projectId,
          runId: String(latestRun._id),
          runConfig: nextRunConfig,
          r2Outputs: runResult.r2Files.outputs,
        });

        rebuildSummary = {
          runId: String(latestRun._id),
          usedSlots: rebuild.usedSlots,
          updatedArtifactPaths: rebuild.updatedArtifactPaths,
          rebuiltWorkbookPaths: rebuild.rebuiltWorkbookPaths,
        };

        if (rebuild.exportPackagesShouldRefresh) {
          await mutateInternal(internal.runs.clearExportPackages, {
            runId: latestRun._id,
            orgId: auth.convexOrgId as Id<'organizations'>,
          });

          try {
            if ((nextRunConfig.exportFormats ?? ['excel']).includes('q')) {
              const qResult = await generateQExportPackage({
                runId: String(latestRun._id),
                orgId: String(auth.convexOrgId),
                projectId,
                runResult: runResult as Record<string, unknown>,
                existingDescriptor: null,
              });
              await mutateInternal(internal.runs.mergeExportPackage, {
                runId: latestRun._id,
                platform: 'q',
                descriptor: {
                  ...qResult.descriptor,
                  supportSummary: qResult.manifest.supportSummary,
                  blockedCount: qResult.manifest.blockedItems.length,
                  warningCount: qResult.manifest.warnings.length,
                  primaryDownloadPath: 'q/setup-project.QScript',
                },
              });
            }
          } catch (error) {
            warnings.push(
              `Q export refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }

          try {
            if ((nextRunConfig.exportFormats ?? []).includes('wincross')) {
              const preferenceSource = await resolveStoredWinCrossPreferenceSource(
                convex,
                auth.convexOrgId as Id<'organizations'>,
                nextRunConfig.wincrossProfileId,
              );
              const wincrossResult = await generateWinCrossExportPackage({
                runId: String(latestRun._id),
                orgId: String(auth.convexOrgId),
                projectId,
                runResult: runResult as Record<string, unknown>,
                existingDescriptor: null,
                preferenceSource,
              });
              await mutateInternal(internal.runs.mergeExportPackage, {
                runId: latestRun._id,
                platform: 'wincross',
                descriptor: {
                  ...wincrossResult.descriptor,
                  supportSummary: wincrossResult.manifest.supportSummary,
                  blockedCount: wincrossResult.manifest.blockedCount,
                  warningCount: wincrossResult.manifest.warnings.length,
                  primaryDownloadPath: wincrossResult.descriptor.archivePath ?? 'wincross/export.zip',
                  parseDiagnostics: wincrossResult.diagnostics,
                },
              });
            }
          } catch (error) {
            warnings.push(
              `WinCross export refresh failed: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } else {
        warnings.push('Latest completed run does not have R2 outputs to rebuild.');
      }
    } else if (latestRun) {
      warnings.push('Latest run is not completed, so rebuild was skipped. The new labels will apply on the next completed run.');
    }

    return NextResponse.json({
      success: true,
      labelVocabulary,
      usedSlots: rebuildSummary?.usedSlots ?? [...TABLE_LABEL_SLOT_ORDER],
      rebuild: rebuildSummary,
      warnings,
    });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error('[Table Presentation PATCH] Error:', error);
    return NextResponse.json(
      { error: 'Failed to update table presentation settings', details: getApiErrorDetails(error) },
      { status: 500 },
    );
  }
}
