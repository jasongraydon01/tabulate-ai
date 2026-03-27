/**
 * POST /api/demo/launch
 *
 * Public (unauthenticated) demo endpoint. Accepts wizard FormData with lead
 * capture fields, creates a demo run, sends a verification email, and kicks
 * off the pipeline with demoMode constraints (25 tables, 100 respondents).
 *
 * Rate limited by email (1 demo per email per 24 hours).
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateSessionId } from '@/lib/storage';
import { validateEnvironment } from '@/lib/env';
import {
  parseWizardFormData,
  FileSizeLimitError,
} from '@/lib/api/fileHandler';
import { mutateInternal, queryInternal } from '@/lib/convex';
import { internal } from '../../../../../convex/_generated/api';
import { ProjectConfigSchema } from '@/schemas/projectConfigSchema';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getDemoActor } from '@/lib/demo/demoOrg';
import { generateVerificationToken } from '@/lib/demo/verificationToken';
import { sendDemoVerificationEmail } from '@/lib/demo/sendDemoEmails';
import { uploadRunInputFiles } from '@/lib/r2/R2FileManager';
import {
  buildWorkerExecutionPayload,
  buildWorkerPipelineContext,
  normalizeWizardWorkerInputRefs,
} from '@/lib/worker/buildExecutionPayload';


export const maxDuration = 300; // 5 minutes
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

const ALLOWED_DATA_EXTENSIONS = ['.sav'];
const ALLOWED_DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.doc'];

const DEMO_MAX_TABLES = 25;
const DEMO_MAX_RESPONDENTS = 100;

export async function POST(request: NextRequest) {
  try {
    // IP-based rate limiting (no auth — use IP)
    const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateLimited = applyRateLimit(ip, 'demo', 'demo/launch');
    if (rateLimited) return rateLimited;

    // Reject oversized uploads early
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: `Upload too large (${Math.round(contentLength / 1024 / 1024)}MB). Maximum is 100MB.` },
        { status: 413 },
      );
    }

    // Validate environment
    const envValidation = validateEnvironment();
    if (!envValidation.valid) {
      return NextResponse.json(
        { error: 'Environment configuration invalid' },
        { status: 500 },
      );
    }

    // Parse form data
    const formData = await request.formData();

    // Honeypot check (hidden field — bots fill it, humans don't)
    const honeypot = formData.get('website') as string | null;
    if (honeypot) {
      // Silently accept but do nothing
      return NextResponse.json({ accepted: true, message: 'Check your email to confirm.' });
    }

    // Lead capture fields
    const name = (formData.get('name') as string)?.trim();
    const email = (formData.get('email') as string)?.trim().toLowerCase();
    const company = (formData.get('company') as string)?.trim() || undefined;
    const projectName = (formData.get('projectName') as string)?.trim();

    if (!name || !email || !projectName) {
      return NextResponse.json(
        { error: 'Missing required fields: name, email, and projectName' },
        { status: 400 },
      );
    }

    // Basic email format check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'Invalid email address' }, { status: 400 });
    }

    // Email-based rate limit: 1 demo per email per 24 hours (bypassed in development)
    if (process.env.NODE_ENV !== 'development') {
      const recentDemoRuns = await queryInternal(internal.demoRuns.getByEmail, { email });
      const twentyFourHoursAgo = Date.now() - 24 * 60 * 60 * 1000;
      const recentRun = recentDemoRuns.find((r: { createdAt: number }) => r.createdAt > twentyFourHoursAgo);
      if (recentRun) {
        return NextResponse.json(
          { error: 'You have already submitted a demo in the last 24 hours. Please try again later.' },
          { status: 429 },
        );
      }
    }

    // Parse and validate files
    const parsed = parseWizardFormData(formData);
    if (!parsed) {
      return NextResponse.json(
        { error: 'Missing required files: dataFile and surveyDocument are required' },
        { status: 400 },
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
    if (fileErrors.length > 0) {
      return NextResponse.json({ error: 'Invalid file format', details: fileErrors }, { status: 400 });
    }

    // Parse config
    const configRaw = formData.get('config') as string | null;
    if (!configRaw) {
      return NextResponse.json({ error: 'Missing config' }, { status: 400 });
    }

    let config;
    try {
      config = ProjectConfigSchema.parse({
        ...JSON.parse(configRaw),
        // Force demo mode constraints
        demoMode: true,
        maxRespondents: DEMO_MAX_RESPONDENTS,
        maxTables: DEMO_MAX_TABLES,
      });
    } catch (parseError) {
      return NextResponse.json(
        { error: 'Invalid config', details: parseError instanceof Error ? parseError.message : 'Config validation failed' },
        { status: 400 },
      );
    }

    // Get shared demo org
    const { orgId: demoOrgId, userId: demoUserId } = await getDemoActor();
    const sessionId = generateSessionId();
    const verificationToken = generateVerificationToken();

    // Create Convex project under demo org (no createdBy — demo is anonymous)
    const projectId = await mutateInternal(internal.projects.create, {
      orgId: demoOrgId,
      name: projectName,
      projectType: 'crosstab',
      config,
      intake: {
        dataFile: parsed.dataFile.name,
        survey: parsed.surveyFile.name,
        bannerPlan: parsed.bannerPlanFile?.name ?? null,
        messageList: null,
        bannerMode: config.bannerMode,
      },
      fileKeys: [],
      createdBy: demoUserId,
    });

    // Create Convex run
    const runId = await mutateInternal(internal.runs.create, {
      projectId,
      orgId: demoOrgId,
      config,
    });

    const runIdStr = String(runId);

    // Create demo run record
    const demoRunId = await mutateInternal(internal.demoRuns.create, {
      name,
      email,
      company,
      projectName,
      verificationToken,
      convexProjectId: projectId,
      convexRunId: runId,
    });

    console.log(`[Demo] Launch: project=${String(projectId)} run=${runIdStr} demoRun=${String(demoRunId)} email=${email}`);

    // Send verification email (fire-and-forget — don't block pipeline start)
    sendDemoVerificationEmail({
      to: email,
      name,
      projectName,
      verificationToken,
    }).catch(err => console.error('[Demo] Failed to send verification email:', err));

    const inputRefs = await uploadRunInputFiles({
      orgId: String(demoOrgId),
      projectId: String(projectId),
      runId: runIdStr,
      files: {
        dataFile: parsed.dataFile,
        surveyFile: parsed.surveyFile,
        bannerPlanFile: parsed.bannerPlanFile,
      },
    });

    const executionPayload = buildWorkerExecutionPayload({
      sessionId,
      pipelineContext: buildWorkerPipelineContext({
        dataFileName: parsed.dataFile.name,
      }),
      fileNames: {
        dataMap: parsed.dataFile.name,
        bannerPlan: parsed.bannerPlanFile?.name ?? '',
        dataFile: parsed.dataFile.name,
        survey: parsed.surveyFile.name,
        messageList: null,
      },
      inputRefs: normalizeWizardWorkerInputRefs(inputRefs),
      loopStatTestingMode: config.loopStatTestingMode,
    });

    await mutateInternal(internal.runs.enqueueForWorker, {
      runId,
      executionPayload,
    });

    return NextResponse.json({
      accepted: true,
      token: verificationToken,
      message: 'Check your email to confirm.',
    });
  } catch (error) {
    if (error instanceof FileSizeLimitError) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }
    console.error('[Demo] Launch error:', error);
    return NextResponse.json({ error: 'Demo launch failed' }, { status: 500 });
  }
}
