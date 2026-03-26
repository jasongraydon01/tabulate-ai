import { randomUUID } from 'crypto';

/**
 * Generate a cryptographically random verification token for demo runs.
 * Uses Node's built-in crypto.randomUUID() — URL-safe, collision-resistant.
 */
export function generateVerificationToken(): string {
  return randomUUID();
}
