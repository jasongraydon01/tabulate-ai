import { createHash } from 'crypto';

/**
 * Stable JSON stringify that sorts object keys recursively.
 * Used for deterministic hashing and snapshot comparisons.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortObject(value));
}

export function deterministicHash(value: unknown): string {
  const normalized = stableStringify(value);
  return createHash('sha256').update(normalized).digest('hex');
}

export function allocateStableId(
  desiredId: string,
  usedIds: Set<string>,
  collisions: string[],
): string {
  if (!usedIds.has(desiredId)) {
    usedIds.add(desiredId);
    return desiredId;
  }

  collisions.push(desiredId);
  let version = 2;
  let candidate = `${desiredId}_v${version}`;

  while (usedIds.has(candidate)) {
    version += 1;
    candidate = `${desiredId}_v${version}`;
  }

  usedIds.add(candidate);
  return candidate;
}

/**
 * Reorders objects by key so deterministic equality checks do not depend
 * on JS runtime object insertion order.
 */
function sortObject(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortObject);
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, sortObject(val)]);
    return Object.fromEntries(entries);
  }

  return value;
}
