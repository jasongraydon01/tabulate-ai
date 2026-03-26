/**
 * Environment Loading Utility
 *
 * Loads .env.local and other Next.js environment files.
 * Uses createRequire to work around Node 22 ESM/CJS interop issues with @next/env.
 *
 * Usage:
 *   import '@/lib/loadEnv';  // Just import - side effect loads env
 *
 * Or for scripts outside src/:
 *   import '../src/lib/loadEnv';
 */

import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { loadEnvConfig } = require('@next/env');

// Load environment variables from .env, .env.local, etc.
loadEnvConfig(process.cwd());
