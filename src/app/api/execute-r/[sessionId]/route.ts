/**
 * GET /api/execute-r/[sessionId]
 * Purpose: Execute the generated R script to produce CSV results
 * Reads: r/master.R
 * Writes: results/*.csv files
 *
 * @deprecated Legacy endpoint — no org ownership verification on session data.
 * The main pipeline uses Convex-backed runs with proper org scoping.
 * Remove once all clients migrate to the Convex pipeline flow.
 */
import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { requireConvexAuth, AuthenticationError } from '@/lib/requireConvexAuth';
import { applyRateLimit } from '@/lib/withRateLimit';
import { getApiErrorDetails, shouldExposeApiErrorDetails } from '@/lib/api/errorDetails';

const execFileAsync = promisify(execFile);
const includeErrorDetails = shouldExposeApiErrorDetails();

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  // Legacy route gate — disabled in production by default (Phase 8.5)
  if (process.env.ENABLE_LEGACY_SESSION_ROUTES !== 'true') {
    return NextResponse.json({ error: 'This endpoint has been retired' }, { status: 410 });
  }

  try {
    const auth = await requireConvexAuth();

    const rateLimited = applyRateLimit(String(auth.convexOrgId), 'high', 'execute-r');
    if (rateLimited) return rateLimited;

    const { sessionId } = await params;
    console.warn(`[execute-r] DEPRECATED: Legacy session endpoint called for ${sessionId}. No org ownership verification.`);

    // Validate sessionId — strict allowlist to prevent path traversal and shell injection
    if (!/^output-[a-zA-Z0-9_-]+$/.test(sessionId)) {
      return NextResponse.json({ error: 'Invalid sessionId' }, { status: 400 });
    }

    const sessionPath = path.join(process.cwd(), 'temp-outputs', sessionId);
    const rScriptPath = path.join(sessionPath, 'r', 'master.R');
    const resultsDir = path.join(sessionPath, 'results');

    // Check if R script exists
    try {
      await fs.access(rScriptPath);
    } catch {
      return NextResponse.json({ error: 'R script not found. Generate R scripts first.' }, { status: 404 });
    }

    // Ensure results directory exists
    await fs.mkdir(resultsDir, { recursive: true });

    console.log(`[R Execution] Starting R script execution for session: ${sessionId}`);
    
    // Execute R script - try different R locations
    let rCommand = 'Rscript';

    // Check for R in common locations (using execFile — no shell)
    const rPaths = [
      '/opt/homebrew/bin/Rscript',  // Homebrew on Apple Silicon
      '/usr/local/bin/Rscript',      // Homebrew on Intel Mac
      '/usr/bin/Rscript',             // System R
      'Rscript'                       // In PATH
    ];

    for (const rPath of rPaths) {
      try {
        await execFileAsync(rPath, ['--version'], { timeout: 1000 });
        rCommand = rPath;
        console.log(`[R Execution] Found R at: ${rPath}`);
        break;
      } catch {
        // Try next path
      }
    }

    try {
      // Use execFile with argument array — no shell interpolation
      const { stdout, stderr } = await execFileAsync(
        rCommand,
        [rScriptPath],
        {
          cwd: sessionPath,           // replaces `cd "${sessionPath}" &&`
          maxBuffer: 10 * 1024 * 1024, // 10MB buffer
          timeout: 60000               // 60 second timeout
        }
      );

      if (stderr && !stderr.includes('Warning')) {
        console.error('[R Execution] R stderr:', stderr);
      }
      
      console.log('[R Execution] R stdout:', stdout);

      // Check what CSV files were generated
      const resultFiles = await fs.readdir(resultsDir);
      const csvFiles = resultFiles.filter(f => f.endsWith('.csv'));

      if (csvFiles.length === 0) {
        return NextResponse.json({
          warning: 'R script executed but no CSV files were generated',
          ...(includeErrorDetails && { stdout, stderr }),
        }, { status: 500 });
      }

      console.log(`[R Execution] Generated ${csvFiles.length} CSV files`);

      return NextResponse.json({
        success: true,
        sessionId,
        results: {
          csvFiles: csvFiles.map(f => `results/${f}`),
          count: csvFiles.length
        },
        ...(includeErrorDetails && {
          execution: {
            stdout: stdout.substring(0, 1000),
            stderr: stderr ? stderr.substring(0, 1000) : null
          },
        }),
        message: `Successfully generated ${csvFiles.length} crosstab tables`
      });

    } catch (execError) {
      console.error('[R Execution] Failed to execute R script:', execError);
      
      const errorMessage = execError instanceof Error ? execError.message : String(execError);
      const errorObj = execError as { stdout?: string; stderr?: string };
      
      // Check if R is installed
      if (errorMessage.includes('command not found') || errorMessage.includes('Rscript')) {
        return NextResponse.json({
          error: 'R is not installed or not in PATH',
          details: 'Please ensure R is installed and Rscript is available in your system PATH',
          installGuide: 'Visit https://www.r-project.org/ to install R'
        }, { status: 500 });
      }

      return NextResponse.json({
        error: 'Failed to execute R script',
        ...(includeErrorDetails && {
          details: getApiErrorDetails(errorMessage),
          stdout: errorObj.stdout?.substring(0, 1000),
          stderr: errorObj.stderr?.substring(0, 1000),
        }),
      }, { status: 500 });
    }

  } catch (error) {
    console.error('[R Execution] Error:', error);
    if (error instanceof AuthenticationError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.json(
      {
        error: 'Failed to execute R script',
        details: getApiErrorDetails(error),
      },
      { status: 500 }
    );
  }
}