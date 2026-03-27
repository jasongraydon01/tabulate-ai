/**
 * POST /api/projects/launch
 *
 * New project launch endpoint (Phase 3.3).
 * Accepts wizard FormData: dataFile, surveyDocument, optional bannerPlan/messageList,
 * config (JSON), projectName. Creates Convex project + run, saves files, fires pipeline.
 *
 * Replaces /api/process-crosstab for the wizard flow.
 */

import * as Sentry from '@sentry/nextjs';
import { NextRequest, NextResponse } from 'next/server';
import { generateSessionId } from '@/lib/storage';
import { validateEnvironment } from '@/lib/env';
import {
  parseWizardFormData,
  saveWizardFilesToStorage,
  FileSizeLimitError,
} from '@/lib/api/fileHandler';
import { runPipelineFromUpload, type PipelineRunParams } from '@/lib/api/pipelineOrchestrator';
import pLimit from 'p-limit';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { getConvexClient, mutateInternal, queryInternal } from '@/lib/convex';
import { api, internal } from '../../../../../convex/_generated/api';
import { createAbortController } from '@/lib/abortStore';
import {
  deriveLegacyProjectSubType,
  deriveMethodologyFromLegacy,
  ProjectConfigSchema,
} from '@/schemas/projectConfigSchema';
import {
  persistSystemError,
  getGlobalSystemOutputDir,
} from '@/lib/errors/ErrorPersistence';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails } from '@/lib/api/errorDetails';
import { getPostHogClient } from '@/lib/posthog-server';
import { hasActiveSubscriptionStatus } from '@/lib/billing/subscriptionStatus';
import { isInternalAccessUser } from '@/lib/internalOperators';

// Allow large .sav file uploads and long-running validation
export const maxDuration = 300; // 5 minutes
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

// Limit concurrent pipeline runs to prevent resource starvation.
// Each run spawns an R process that uses significant CPU/memory.
const pipelineLimit = pLimit(3);

const ALLOWED_DATA_EXTENSIONS = ['.sav'];
const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.doc'];
const ALLOWED_MESSAGE_LIST_EXTENSIONS = ['.xlsx', '.xls', '.csv'];

export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const sessionId = generateSessionId();
  let authUserId: string | null = null;

  try {
    // Authenticate and get Convex IDs
    const auth = await requireConvexAuth();
    authUserId = String(auth.convexUserId);

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'critical', 'projects/launch');
    if (rateLimited) return rateLimited;

    // Role check — only admin/member can create projects
    if (!canPerform(auth.role, 'create_project')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Subscription check — must have an active subscription to create projects
    const subscription = await queryInternal(internal.subscriptions.getByOrgInternal, {
      orgId: auth.convexOrgId,
    });
    if (!isInternalAccessUser(auth.email) && (!subscription || !hasActiveSubscriptionStatus(subscription.status))) {
      return NextResponse.json(
        { error: 'No active billing plan', action: 'redirect_to_pricing' },
        { status: 402 },
      );
    }

    // Reject oversized uploads early
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Upload too large (${Math.round(contentLength / 1024 / 1024)}MB). Maximum is 100MB.` },
        { status: 413 }
      );
    }

    // Validate environment configuration
    const envValidation = validateEnvironment();
    if (!envValidation.valid) {
      return NextResponse.json(
        { error: 'Environment configuration invalid', details: envValidation.errors },
        { status: 500 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const parsed = parseWizardFormData(formData);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Missing required files: dataFile and surveyDocument are required' },
        { status: 400 }
      );
    }

    // Validate file formats
    const fileErrors: string[] = [];
    const dataExt = '.' + parsed.dataFile.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_DATA_EXTENSIONS.includes(dataExt)) {
      fileErrors.push(`Data file must be .sav (got ${dataExt})`);
    }
    const surveyExt = '.' + parsed.surveyFile.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(surveyExt)) {
      fileErrors.push(`Survey document must be PDF or DOCX (got ${surveyExt})`);
    }
    if (parsed.bannerPlanFile) {
      const bannerExt = '.' + parsed.bannerPlanFile.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_DOCUMENT_EXTENSIONS.includes(bannerExt)) {
        fileErrors.push(`Banner plan must be PDF or DOCX (got ${bannerExt})`);
      }
    }
    if (parsed.messageListFile) {
      const msgExt = '.' + parsed.messageListFile.name.split('.').pop()?.toLowerCase();
      if (!ALLOWED_MESSAGE_LIST_EXTENSIONS.includes(msgExt)) {
        fileErrors.push(`Message list must be Excel or CSV (got ${msgExt})`);
      }
    }
    if (fileErrors.length > 0) {
      return NextResponse.json(
        { error: 'Invalid file format', details: fileErrors },
        { status: 400 }
      );
    }

    // Parse and validate config
    const configRaw = formData.get('config') as string | null;
    const projectName = formData.get('projectName') as string | null;

    if (!configRaw || !projectName) {
      return NextResponse.json(
        { error: 'Missing required fields: config and projectName' },
        { status: 400 }
      );
    }

    let config;
    try {
      config = ProjectConfigSchema.parse(JSON.parse(configRaw));
    } catch (parseError) {
      return NextResponse.json(
        {
          error: 'Invalid config',
          details: parseError instanceof Error ? parseError.message : 'Config validation failed',
        },
        { status: 400 }
      );
    }

    // Check for duplicate project name within this org
    const convex = getConvexClient();
    const existingProjects = await convex.query(api.projects.listByOrg, {
      orgId: auth.convexOrgId,
    });
    const nameTaken = existingProjects.some(
      (p) => p.name.toLowerCase() === projectName.toLowerCase(),
    );
    if (nameTaken) {
      return NextResponse.json(
        { error: `A project named "${projectName}" already exists. Please choose a different name.` },
        { status: 409 },
      );
    }

    // Create Convex project
    const legacyProjectType = deriveLegacyProjectSubType(config);
    const { studyMethodology, analysisMethod } = deriveMethodologyFromLegacy(config);

    const projectId = await mutateInternal(internal.projects.create, {
      orgId: auth.convexOrgId,
      name: projectName,
      projectType: 'crosstab',
      config,
      intake: {
        dataFile: parsed.dataFile.name,
        survey: parsed.surveyFile.name,
        bannerPlan: parsed.bannerPlanFile?.name ?? null,
        messageList: parsed.messageListFile?.name ?? null,
        bannerMode: config.bannerMode,
      },
      fileKeys: [],
      createdBy: auth.convexUserId,
    });

    // Save files to temporary storage (no longer uploading inputs to R2)
    const savedPaths = await saveWizardFilesToStorage(parsed, sessionId, {
      orgId: String(auth.convexOrgId),
      projectId: String(projectId),
    });

    // Create Convex run with full config
    const runId = await mutateInternal(internal.runs.create, {
      projectId,
      orgId: auth.convexOrgId,
      config,
      launchedBy: auth.convexUserId,
    });

    const runIdStr = String(runId);

    // Create AbortController for this run
    const abortSignal = createAbortController(runIdStr);

    console.log(`[Launch] Project ${String(projectId)} run ${runIdStr} created in ${Date.now() - startTime}ms`);

    // Track successful project launch (server-side)
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: String(auth.convexUserId),
      event: 'project_launch_success',
      properties: {
        project_id: String(projectId),
        run_id: runIdStr,
        session_id: sessionId,
        org_id: String(auth.convexOrgId),
        project_type: legacyProjectType,
        study_methodology: studyMethodology,
        analysis_method: analysisMethod,
        is_wave_study: config.isWaveStudy ?? false,
        export_formats: config.exportFormats ?? ['excel'],
        has_wincross_profile_id: !!config.wincrossProfileId,
        banner_mode: config.bannerMode,
        has_weight_variable: !!config.weightVariable,
        data_file_name: parsed.dataFile.name,
        survey_file_name: parsed.surveyFile.name,
        has_banner_plan: !!parsed.bannerPlanFile,
        setup_duration_ms: Date.now() - startTime,
      },
    });

    // Build PipelineRunParams — synthesize the legacy SavedFilePaths shape.
    // dataMapPath === spssPath since .sav IS the datamap in wizard flow.
    // bannerPlanPath is the real path or empty string (orchestrator guards empty paths).
    const pipelineParams: PipelineRunParams = {
      runId: runIdStr,
      sessionId,
      convexOrgId: String(auth.convexOrgId),
      convexProjectId: String(projectId),
      launchedBy: String(auth.convexUserId),
      fileNames: {
        dataMap: parsed.dataFile.name, // .sav acts as datamap
        bannerPlan: parsed.bannerPlanFile?.name ?? '',
        dataFile: parsed.dataFile.name,
        survey: parsed.surveyFile.name,
      },
      savedPaths: {
        dataMapPath: savedPaths.spssPath, // .sav IS the datamap
        bannerPlanPath: savedPaths.bannerPlanPath ?? '',
        spssPath: savedPaths.spssPath,
        surveyPath: savedPaths.surveyPath,
        messageListPath: savedPaths.messageListPath ?? undefined,
        r2Keys: savedPaths.r2Keys ? {
          dataMap: savedPaths.r2Keys.spss,
          bannerPlan: savedPaths.r2Keys.bannerPlan ?? '',
          spss: savedPaths.r2Keys.spss,
          survey: savedPaths.r2Keys.survey ?? null,
        } : undefined,
      },
      abortSignal,
      loopStatTestingMode: config.loopStatTestingMode,
      config,
    };

    // Kick off background processing (concurrency-limited to 3 simultaneous runs)
    pipelineLimit(() => runPipelineFromUpload(pipelineParams)).catch((error) => {
      console.error('[Launch] Unhandled pipeline error:', error);
      // Ensure unhandled pipeline errors reach Sentry (the internal try/catch
      // in pipelineOrchestrator covers most cases, but this is the safety net)
      Sentry.captureException(error, {
        tags: { pipeline_id: sessionId, run_id: runIdStr },
      });
    });

    return NextResponse.json({
      accepted: true,
      runId: runIdStr,
      projectId: String(projectId),
      sessionId,
    });
  } catch (error) {
    console.error('[Launch] Error:', error);

    // Track launch error (server-side)
    const posthog = getPostHogClient();
    posthog.capture({
      distinctId: authUserId || 'anonymous',
      event: 'project_launch_error',
      properties: {
        session_id: sessionId,
        error_type: error instanceof AuthenticationError ? 'authentication' :
                    error instanceof FileSizeLimitError ? 'file_size_limit' : 'unknown',
        error_class: error instanceof Error ? error.constructor.name : 'NonError',
      },
    });

    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof FileSizeLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    const errorMsg = error instanceof Error ? error.message : String(error);

    try {
      await persistSystemError({
        outputDir: getGlobalSystemOutputDir(),
        dataset: '',
        pipelineId: '',
        stageNumber: 0,
        stageName: 'Launch',
        severity: 'fatal',
        actionTaken: 'failed_pipeline',
        error,
        meta: { sessionId },
      });
    } catch {
      // ignore
    }
    return NextResponse.json(
      {
        error: 'Project launch failed',
        sessionId,
        details: getApiErrorDetails(errorMsg),
      },
      { status: 500 }
    );
  }
}
