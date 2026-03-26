import { ConvexHttpClient } from "convex/browser";

let client: ConvexHttpClient | null = null;

/**
 * Server-side ConvexHttpClient singleton.
 * Use in API routes and server components.
 */
export function getConvexClient(): ConvexHttpClient {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error(
      "CONVEX_URL is not set. Create a Convex project and add CONVEX_URL to .env.local"
    );
  }

  if (!client) {
    client = new ConvexHttpClient(url);

    // Authenticate with deploy key for internalMutation access.
    // Required after converting all mutations to internalMutation (H7 hardening).
    const deployKey = process.env.CONVEX_DEPLOY_KEY;
    if (deployKey) {
      (client as unknown as { setAdminAuth(token: string): void }).setAdminAuth(deployKey);
    } else if (process.env.NODE_ENV === 'production') {
      throw new Error(
        "CONVEX_DEPLOY_KEY is not set. All mutations require deploy key auth. " +
        "Add CONVEX_DEPLOY_KEY to your environment variables."
      );
    } else {
      console.warn(
        "[convex] CONVEX_DEPLOY_KEY is not set — internalMutation calls will fail. " +
        "Add it to .env.local for local development."
      );
    }
  }

  return client;
}

/**
 * Type-erased mutation caller for internal mutations.
 *
 * ConvexHttpClient.mutation() is typed for "public" visibility only, but when
 * authenticated with a deploy key (setAdminAuth), it can call internal functions
 * at runtime. This helper avoids `as any` casts at every call site.
 *
 * Usage:
 * ```ts
 * await mutateInternal(internal.runs.updateStatus, { runId, status: 'success' });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function mutateInternal(ref: any, args: any): Promise<any> {
  const convex = getConvexClient();
  return convex.mutation(ref, args);
}

/**
 * Type-erased query caller for internal queries.
 *
 * Same pattern as mutateInternal — the deploy key (setAdminAuth) grants access
 * to internalQuery functions at runtime. Use this for queries that have been
 * converted from public query() to internalQuery() for security hardening.
 *
 * Usage:
 * ```ts
 * const user = await queryInternal(internal.users.get, { userId });
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function queryInternal(ref: any, args: any): Promise<any> {
  const convex = getConvexClient();
  return convex.query(ref, args);
}
