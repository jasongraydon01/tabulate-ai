// Single API endpoint for complete crosstab processing workflow

/**
 * @deprecated Phase 3.3 — Replaced by POST /api/projects/launch.
 * The new endpoint accepts the wizard payload (no dataMap required, full config).
 * This endpoint is preserved for backward compatibility only.
 *
 * POST /api/process-crosstab
 * Purpose: Single entrypoint for upload → full pipeline processing
 * Creates Convex project + run, then fires pipeline in background.
 * UI subscribes to run status via Convex (no polling).
 */
import { NextRequest, NextResponse } from 'next/server';
import { generateSessionId } from '../../../lib/storage';
import { logAgentExecution } from '../../../lib/tracing';
import { validateEnvironment } from '../../../lib/env';
import { parseUploadFormData, validateUploadedFiles, saveFilesToStorage, sanitizeDatasetName, FileSizeLimitError } from '../../../lib/api/fileHandler';
import { runPipelineFromUpload } from '../../../lib/api/pipelineOrchestrator';
import { requireConvexAuth, AuthenticationError } from '../../../lib/requireConvexAuth';
import { mutateInternal } from '../../../lib/convex';
import { internal } from '../../../../convex/_generated/api';
import { createAbortController } from '../../../lib/abortStore';
import {
  persistSystemError,
  getGlobalSystemOutputDir,
} from '../../../lib/errors/ErrorPersistence';
import { applyRateLimit } from '../../../lib/withRateLimit';
import { getApiErrorDetails } from '../../../lib/api/errorDetails';

// Legacy route gate — disabled in production by default (Phase 8.5)
const LEGACY_DISABLED_RESPONSE = NextResponse.json(
  { error: 'This endpoint has been retired. Use POST /api/projects/launch instead.' },
  { status: 410 },
);

const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

export async function POST(request: NextRequest) {
  if (process.env.ENABLE_LEGACY_SESSION_ROUTES !== 'true') return LEGACY_DISABLED_RESPONSE;

  const startTime = Date.now();
  const sessionId = generateSessionId();

  try {
    // Authenticate and get Convex IDs
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'critical', 'process-crosstab');
    if (rateLimited) return rateLimited;

    console.warn('[API:process-crosstab] DEPRECATED: config not passed — displayMode/separateWorkbooks will use defaults. Use /api/projects/launch instead.');

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
    const parsed = parseUploadFormData(formData);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Missing required files: dataMap, bannerPlan, and dataFile are required' },
        { status: 400 }
      );
    }

    // Run input guardrails
    const guardrailResult = await validateUploadedFiles({
      dataMap: parsed.dataMapFile,
      bannerPlan: parsed.bannerPlanFile,
      dataFile: parsed.dataFile,
    });
    if (!guardrailResult.success) {
      return NextResponse.json(
        { error: 'File validation failed', details: guardrailResult.errors, warnings: guardrailResult.warnings },
        { status: 400 }
      );
    }

    const datasetName = sanitizeDatasetName(parsed.dataFile.name);

    // Create Convex project first (need projectId for R2 key structure)
    const projectId = await mutateInternal(internal.projects.create, {
      orgId: auth.convexOrgId,
      name: datasetName,
      projectType: 'crosstab',
      config: {
        loopStatTestingMode: parsed.loopStatTestingMode,
      },
      intake: {
        dataMap: parsed.dataMapFile.name,
        bannerPlan: parsed.bannerPlanFile.name,
        dataFile: parsed.dataFile.name,
        survey: parsed.surveyFile?.name ?? null,
      },
      fileKeys: [],
      createdBy: auth.convexUserId,
    });

    // Save files to temporary storage (no longer uploading inputs to R2)
    const savedPaths = await saveFilesToStorage(parsed, sessionId, {
      orgId: String(auth.convexOrgId),
      projectId: String(projectId),
    });

    // Create Convex run
    const runId = await mutateInternal(internal.runs.create, {
      projectId,
      orgId: auth.convexOrgId,
      config: {
        loopStatTestingMode: parsed.loopStatTestingMode,
      },
      launchedBy: auth.convexUserId,
    });

    const runIdStr = String(runId);

    // Create AbortController for this run
    const abortSignal = createAbortController(runIdStr);

    // Log successful file upload
    const fileCount = parsed.surveyFile ? 4 : 3;
    logAgentExecution(sessionId, 'FileUploadProcessor',
      { fileCount, sessionId },
      { saved: true },
      Date.now() - startTime
    );

    // Kick off background processing and return immediately
    runPipelineFromUpload({
      runId: runIdStr,
      sessionId,
      convexOrgId: String(auth.convexOrgId),
      convexProjectId: String(projectId),
      launchedBy: String(auth.convexUserId),
      fileNames: {
        dataMap: parsed.dataMapFile.name,
        bannerPlan: parsed.bannerPlanFile.name,
        dataFile: parsed.dataFile.name,
        survey: parsed.surveyFile?.name ?? null,
      },
      savedPaths,
      abortSignal,
      loopStatTestingMode: parsed.loopStatTestingMode,
    }).catch((error) => {
      console.error('[API] Unhandled pipeline error:', error);
    });

    return NextResponse.json({
      accepted: true,
      runId: runIdStr,
      projectId: String(projectId),
      sessionId,
    });

  } catch (error) {
    console.error('[API] Early processing error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof FileSizeLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    try {
      await persistSystemError({
        outputDir: getGlobalSystemOutputDir(),
        dataset: '',
        pipelineId: '',
        stageNumber: 0,
        stageName: 'API',
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
        error: 'Data processing failed',
        sessionId,
        details: getApiErrorDetails(error),
      },
      { status: 500 }
    );
  }
}

// Handle other HTTP methods
export async function GET() {
  try {
    const auth = await requireConvexAuth();
    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'low', 'process-crosstab');
    if (rateLimited) return rateLimited;
  } catch {
    // Fall through — return 405 regardless so we don't leak auth details on a disallowed method
  }
  return NextResponse.json(
    {
      error: 'Method not allowed',
      message: 'This endpoint only accepts POST requests with file uploads'
    },
    { status: 405 }
  );
}
