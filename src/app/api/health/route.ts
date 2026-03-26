import { NextResponse } from "next/server";

/**
 * Liveness probe: returns 200 if the Node.js process is up.
 * No dependency checks — those are in /api/ready.
 *
 * No auth required — used by Docker HEALTHCHECK and monitoring.
 */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
