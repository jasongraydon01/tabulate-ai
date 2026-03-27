import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function readFile(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

describe('marketing auth-aware routes', () => {
  it('marks the marketing layout as dynamic so auth-aware CTAs are not statically cached', async () => {
    expect(readFile('src/app/(marketing)/layout.tsx')).toContain("export const dynamic = 'force-dynamic';");
  });

  it('marks the landing page as dynamic so session-aware CTAs stay current', async () => {
    expect(readFile('src/app/(marketing)/page.tsx')).toContain("export const dynamic = 'force-dynamic';");
  });

  it('marks the pricing page as dynamic so billing CTAs reflect the current session', async () => {
    expect(readFile('src/app/(marketing)/pricing/page.tsx')).toContain("export const dynamic = 'force-dynamic';");
  });
});
