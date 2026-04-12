import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authkitMiddleware } from "@workos-inc/authkit-nextjs";

const workosMiddleware = authkitMiddleware({
  middlewareAuth: {
    enabled: true,
    unauthenticatedPaths: [
      "/",
      "/pricing",
      "/contact",
      "/demo",
      "/demo/status",
      "/request-access",
      "/data-privacy",
      "/auth/sign-in",
      "/auth/callback",
      "/auth/error",
      "/api/health",
      "/api/ready",
      "/api/billing/webhook",
      "/api/demo/launch",
      "/api/demo/verify",
      "/api/demo/validate-data",
      "/api/access-requests",
      "/api/contact",
      "/blog",
      "/blog/:slug",
    ],
  },
});

export function middleware(request: NextRequest) {
  // AUTH_BYPASS mode: skip all auth checks (development only)
  if (process.env.AUTH_BYPASS === "true") {
    if (process.env.NODE_ENV === "production") {
      console.error("FATAL: AUTH_BYPASS must not be enabled in production");
      return NextResponse.json(
        { error: "Server misconfiguration" },
        { status: 500 }
      );
    }
    return NextResponse.next();
  }

  // Delegate to WorkOS AuthKit middleware
  return workosMiddleware(request, {} as never);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)",
  ],
};
