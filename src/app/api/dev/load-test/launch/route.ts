/**
 * POST /api/dev/load-test/launch
 *
 * Launches multiple pipeline runs for load testing by POSTing to the real
 * /api/projects/launch endpoint — one request per dataset, fired according
 * to the concurrency setting. This tests the exact same code path real users hit.
 *
 * Admin-only, dev-mode only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import pLimit from 'p-limit';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { canPerform } from '@/lib/permissions';
import { applyRateLimit } from '@/lib/withRateLimit';
import { downloadFile } from '@/lib/r2/r2';
import { getContentTypeForFile } from '@/lib/loadTest/helpers';
import {
  LOAD_TEST_SEPARATOR,
  type TestDatasetManifest,
  type TestDatasetEntry,
  type LoadTestLaunchResult,
  type LoadTestLaunchedProject,
  type LoadTestLaunchError,
} from '@/lib/loadTest/types';

// Allow longer timeouts for batch launch setup
export const maxDuration = 300;

const LaunchRequestSchema = z.object({
  datasets: z.array(z.string()).min(1).max(20),
  concurrency: z.union([z.literal(1), z.literal(3), z.literal(5), z.literal(10), z.literal(15)]),
  namePrefix: z.string().min(1).max(100).regex(/^[a-zA-Z0-9\s\-\/.]+$/),
  config: z.object({
    format: z.enum(['standard', 'stacked']).optional(),
    displayMode: z.enum(['frequency', 'counts', 'both']).optional(),
    theme: z.string().optional(),
  }).optional(),
});

export async function POST(request: NextRequest) {
  // Dev-only gate
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'high', 'dev/load-test/launch');
    if (rateLimited) return rateLimited;

    if (!canPerform(auth.role, 'delete_project')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse and validate request body
    const body = await request.json();
    const parsed = LaunchRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid request', details: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }

    const { datasets: requestedDatasets, concurrency, namePrefix, config: launchConfig } = parsed.data;

    // Download manifest
    let manifest: TestDatasetManifest;
    try {
      const manifestBuffer = await downloadFile('dev-test/manifest.json');
      manifest = JSON.parse(manifestBuffer.toString('utf-8'));
    } catch {
      return NextResponse.json(
        { error: 'Could not read manifest. Run the upload script first.' },
        { status: 500 },
      );
    }

    // Resolve requested datasets against manifest
    const datasetMap = new Map<string, TestDatasetEntry>();
    for (const entry of manifest.datasets) {
      datasetMap.set(entry.name, entry);
    }

    // Forward auth headers so internal requests authenticate correctly
    const cookieHeader = request.headers.get('cookie') ?? '';
    const launchUrl = new URL('/api/projects/launch', request.url);

    // Launch datasets with concurrency control
    const limit = pLimit(concurrency);
    const launched: LoadTestLaunchedProject[] = [];
    const errors: LoadTestLaunchError[] = [];
    let rateLimitRejections = 0;

    const promises = requestedDatasets.map((datasetName) =>
      limit(async () => {
        try {
          // Validate dataset exists in manifest
          const entry = datasetMap.get(datasetName);
          if (!entry) {
            errors.push({ dataset: datasetName, error: `Dataset "${datasetName}" not found in manifest` });
            return;
          }

          const savFile = entry.files.find(f => f.role === 'sav');
          const surveyFile = entry.files.find(f => f.role === 'survey');
          const bannerFile = entry.files.find(f => f.role === 'banner');

          if (!savFile || !surveyFile) {
            errors.push({ dataset: datasetName, error: 'Missing required .sav or survey file' });
            return;
          }

          // Download files from R2
          const savBuffer = await downloadFile(savFile.r2Key);
          const surveyBuffer = await downloadFile(surveyFile.r2Key);
          const bannerBuffer = bannerFile ? await downloadFile(bannerFile.r2Key) : null;

          // Build FormData matching parseWizardFormData expectations
          // Convert Node.js Buffers to Uint8Array for Blob compatibility
          const formData = new FormData();
          formData.set(
            'dataFile',
            new Blob([new Uint8Array(savBuffer)], { type: getContentTypeForFile(savFile.filename) }),
            savFile.filename,
          );
          formData.set(
            'surveyDocument',
            new Blob([new Uint8Array(surveyBuffer)], { type: getContentTypeForFile(surveyFile.filename) }),
            surveyFile.filename,
          );

          if (bannerBuffer && bannerFile) {
            formData.set(
              'bannerPlan',
              new Blob([new Uint8Array(bannerBuffer)], { type: getContentTypeForFile(bannerFile.filename) }),
              bannerFile.filename,
            );
          }

          const projectName = `${namePrefix}${LOAD_TEST_SEPARATOR}${datasetName}`;
          formData.set('projectName', projectName);

          const config = {
            projectSubType: 'standard',
            bannerMode: bannerFile ? 'upload' : 'auto_generate',
            format: launchConfig?.format ?? 'standard',
            displayMode: launchConfig?.displayMode ?? 'frequency',
            theme: launchConfig?.theme ?? 'classic',
          };
          formData.set('config', JSON.stringify(config));

          // POST to the real launch endpoint
          const res = await fetch(launchUrl, {
            method: 'POST',
            body: formData,
            headers: { cookie: cookieHeader },
          });

          // Track rate-limit rejections
          if (res.status === 429) {
            rateLimitRejections++;
            errors.push({ dataset: datasetName, error: 'Rate limited (429)' });
            return;
          }

          const data = await res.json();

          if (!res.ok) {
            errors.push({ dataset: datasetName, error: data.error || `HTTP ${res.status}` });
            return;
          }

          launched.push({
            dataset: datasetName,
            projectId: data.projectId,
            runId: data.runId,
            projectName,
          });

          console.log(`[LoadTest] Launched ${projectName} (run: ${data.runId})`);
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          errors.push({ dataset: datasetName, error: errorMsg });
          console.error(`[LoadTest] Failed to launch ${datasetName}:`, errorMsg);
        }
      })
    );

    await Promise.all(promises);

    const result: LoadTestLaunchResult = {
      launched,
      errors,
      totalLaunched: launched.length,
      totalErrors: errors.length,
      rateLimitRejections,
    };

    return NextResponse.json(result, { status: 202 });
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.error('[LoadTest/launch] Error:', error);
    return NextResponse.json(
      { error: 'Load test launch failed' },
      { status: 500 },
    );
  }
}
