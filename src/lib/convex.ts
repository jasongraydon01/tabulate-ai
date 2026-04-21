import { ConvexHttpClient } from "convex/browser";

let client: ConvexHttpClient | null = null;
let clientProxy: ConvexHttpClient | null = null;
let clientSignature: string | null = null;

const TRANSIENT_CONVEX_ERROR_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_SOCKET',
  'fetch failed',
  'network error',
];

type ConvexCallArgs = unknown[];

function getClientConfig(): { url: string; deployKey?: string } {
  const url = process.env.CONVEX_URL;
  if (!url) {
    throw new Error(
      "CONVEX_URL is not set. Create a Convex project and add CONVEX_URL to .env.local"
    );
  }

  const deployKey = process.env.CONVEX_DEPLOY_KEY;
  if (!deployKey && process.env.NODE_ENV === 'production') {
    throw new Error(
      "CONVEX_DEPLOY_KEY is not set. All mutations require deploy key auth. " +
      "Add CONVEX_DEPLOY_KEY to your environment variables."
    );
  }

  if (!deployKey && process.env.NODE_ENV !== 'production') {
    console.warn(
      "[convex] CONVEX_DEPLOY_KEY is not set — internalMutation calls will fail. " +
      "Add it to .env.local for local development."
    );
  }

  return { url, deployKey };
}

function getClientSignatureForConfig(config: { url: string; deployKey?: string }): string {
  return `${config.url}::${config.deployKey ?? ''}`;
}

function collectErrorStrings(error: unknown): string[] {
  const collected: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;

  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current);
    const record = current as Record<string, unknown>;

    for (const key of ['code', 'name', 'message', 'syscall', 'hostname']) {
      const value = record[key];
      if (typeof value === 'string' && value.length > 0) {
        collected.push(value);
      }
    }

    current = record['cause'];
  }

  if (typeof error === 'string') {
    collected.push(error);
  }

  return collected;
}

export function isTransientConvexError(error: unknown): boolean {
  const haystack = collectErrorStrings(error).join(' ');
  if (!haystack) return false;

  return TRANSIENT_CONVEX_ERROR_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function clearCachedClient(): void {
  client = null;
  clientProxy = null;
  clientSignature = null;
}

function createRawClient(config: { url: string; deployKey?: string }): ConvexHttpClient {
  const nextClient = new ConvexHttpClient(config.url);
  if (config.deployKey) {
    (nextClient as unknown as { setAdminAuth(token: string): void }).setAdminAuth(config.deployKey);
  }
  return nextClient;
}

async function invokeClientMethod<T>(
  targetClient: ConvexHttpClient,
  methodName: 'query' | 'mutation',
  args: ConvexCallArgs,
): Promise<T> {
  const method = targetClient[methodName] as unknown as (...callArgs: ConvexCallArgs) => Promise<T>;
  return method.apply(targetClient, args);
}

async function runQueryWithRecovery<T>(
  targetClient: ConvexHttpClient,
  config: { url: string; deployKey?: string },
  args: ConvexCallArgs,
): Promise<T> {
  try {
    return await invokeClientMethod<T>(targetClient, 'query', args);
  } catch (error) {
    if (!isTransientConvexError(error)) {
      throw error;
    }

    if (client === targetClient) {
      clearCachedClient();
    }

    console.warn(
      `[convex] Transient query failure. Recreating client and retrying once: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );

    const retryClient = createRawClient(config);
    return invokeClientMethod<T>(retryClient, 'query', args);
  }
}

async function runMutationWithRecovery<T>(
  targetClient: ConvexHttpClient,
  args: ConvexCallArgs,
): Promise<T> {
  try {
    return await invokeClientMethod<T>(targetClient, 'mutation', args);
  } catch (error) {
    if (isTransientConvexError(error) && client === targetClient) {
      clearCachedClient();
      console.warn(
        `[convex] Transient mutation failure. Cleared cached client for the next attempt: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    throw error;
  }
}

function createClientProxy(
  rawClient: ConvexHttpClient,
  config: { url: string; deployKey?: string },
): ConvexHttpClient {
  return new Proxy(rawClient, {
    get(target, prop, receiver) {
      if (prop === 'query') {
        return ((...args: ConvexCallArgs) => runQueryWithRecovery(target, config, args)) as ConvexHttpClient['query'];
      }

      if (prop === 'mutation') {
        return ((...args: ConvexCallArgs) => runMutationWithRecovery(target, args)) as ConvexHttpClient['mutation'];
      }

      const value = Reflect.get(target, prop, receiver);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  }) as ConvexHttpClient;
}

function ensureClient(): ConvexHttpClient {
  const config = getClientConfig();
  const nextSignature = getClientSignatureForConfig(config);

  if (!client || !clientProxy || clientSignature !== nextSignature) {
    client = createRawClient(config);
    clientProxy = createClientProxy(client, config);
    clientSignature = nextSignature;
  }

  return clientProxy;
}

/**
 * Server-side ConvexHttpClient singleton.
 * Use in API routes and server components.
 */
export function getConvexClient(): ConvexHttpClient {
  return ensureClient();
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

/** Exposed for testing — resets the cached Convex client. */
export function _resetConvexClientForTests(): void {
  clearCachedClient();
}
