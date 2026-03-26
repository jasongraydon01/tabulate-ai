import { PostHog } from 'posthog-node';

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog {
  if (!posthogClient) {
    const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
    if (!key) {
      // Return a no-op client so callers don't crash when the key is missing
      // (e.g., CLI scripts, local dev without PostHog configured)
      return new Proxy({} as PostHog, {
        get: (_target, prop) => {
          if (prop === 'capture' || prop === 'identify' || prop === 'shutdown') {
            return () => {};
          }
          return undefined;
        },
      });
    }
    posthogClient = new PostHog(key, {
      host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      flushAt: 1, // Flush immediately since server-side functions can be short-lived
      flushInterval: 0,
    });
    if (process.env.NODE_ENV === 'development') {
      posthogClient.debug(true);
    }
  }
  return posthogClient;
}

export async function shutdownPostHog() {
  if (posthogClient) {
    await posthogClient.shutdown();
  }
}
