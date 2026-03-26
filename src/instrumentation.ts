import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");

    // Fail-fast startup validation: check critical env vars before serving requests.
    // Dynamic import keeps the module tree small for edge runtime.
    const { validateStartupEnvironment } = await import(
      "./lib/startup/validateStartupEnvironment"
    );
    const result = validateStartupEnvironment();

    if (!result.valid) {
      const msg = `[Startup] Environment validation failed:\n${result.errors.map((e) => `  - ${e}`).join("\n")}`;
      if (process.env.NODE_ENV === "production") {
        console.error(msg);
        throw new Error(msg);
      } else {
        console.warn(msg);
      }
    }

    if (result.warnings.length > 0) {
      console.warn(
        `[Startup] Environment warnings:\n${result.warnings.map((w) => `  - ${w}`).join("\n")}`,
      );
    }

    if (result.valid && result.warnings.length === 0) {
      console.log("[Startup] Environment validation passed");
    }

    // Best-effort startup sweep: clean temp dirs older than 24 hours.
    // Non-blocking — does not delay server readiness.
    import("./lib/storage/TempDirManager").then(({ cleanupStaleTempDirs }) => {
      cleanupStaleTempDirs().catch(() => {
        // Sweep failure is non-fatal — logged inside cleanupStaleTempDirs
      });
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
