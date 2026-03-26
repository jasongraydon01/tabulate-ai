// This file configures the initialization of Sentry on the client.
// The added config here will be used whenever a users loads a page in their browser.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";
import { scrubSentryEvent } from "@/lib/observability/sentry-scrub";

const isProd = process.env.NODE_ENV === "production";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

  environment: process.env.NODE_ENV || "development",

  // Add optional integrations for additional features
  integrations: [Sentry.replayIntegration()],

  // Sample 100% in dev, 20% in production
  tracesSampleRate: isProd ? 0.2 : 1.0,

  // Enable logs to be sent to Sentry
  enableLogs: true,

  // Session replay: 10% of sessions, 100% on error
  replaysSessionSampleRate: isProd ? 0.1 : 0.5,
  replaysOnErrorSampleRate: 1.0,

  // Only send PII in development
  sendDefaultPii: !isProd,

  // Pipeline cancellation is not an error
  ignoreErrors: ["AbortError"],

  // Strip sensitive data before sending
  beforeSend: scrubSentryEvent,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
