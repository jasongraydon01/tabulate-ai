import { NextResponse } from "next/server";

/**
 * Readiness probe: returns 200 if all dependencies are reachable, 503 otherwise.
 *
 * Checks: environment validation, Convex connectivity, Rscript binary, R2 bucket.
 * Results are cached for 10 seconds to avoid hammering dependencies.
 *
 * No auth required — used by Railway and Docker HEALTHCHECK.
 */
export async function GET() {
  const { checkReadiness } = await import("@/lib/startup/checkReadiness");
  const result = await checkReadiness();

  const status = result.ready ? 200 : 503;

  if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { status: result.ready ? "ready" : "not_ready" },
      { status },
    );
  }

  return NextResponse.json(
    {
      status: result.ready ? "ready" : "not_ready",
      timestamp: new Date().toISOString(),
      checks: result.checks,
    },
    { status },
  );
}
