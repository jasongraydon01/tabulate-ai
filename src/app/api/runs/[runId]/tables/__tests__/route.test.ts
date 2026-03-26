import { describe, expect, it } from 'vitest';

import { GET as getTables } from '@/app/api/runs/[runId]/tables/route';
import { POST as postExclude } from '@/app/api/runs/[runId]/tables/exclude/route';
import { POST as postRegenerate } from '@/app/api/runs/[runId]/tables/regenerate/route';
import { GET as getRevisions } from '@/app/api/runs/[runId]/tables/[tableId]/revisions/route';

describe('legacy review tables API routes', () => {
  it('returns 404 for GET /api/runs/[runId]/tables', async () => {
    const response = await getTables();

    expect(response.status).toBe(404);
  });

  it('returns 404 for POST /api/runs/[runId]/tables/exclude', async () => {
    const response = await postExclude();

    expect(response.status).toBe(404);
  });

  it('returns 404 for POST /api/runs/[runId]/tables/regenerate', async () => {
    const response = await postRegenerate();

    expect(response.status).toBe(404);
  });

  it('returns 404 for GET /api/runs/[runId]/tables/[tableId]/revisions', async () => {
    const response = await getRevisions();

    expect(response.status).toBe(404);
  });
});
