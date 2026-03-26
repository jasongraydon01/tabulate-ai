import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
  requireConvexAuth: vi.fn(async () => ({
    convexOrgId: 'org-1',
    convexUserId: 'user-1',
    role: 'admin',
  })),
}));

vi.mock('@/lib/requireConvexAuth', () => ({
  requireConvexAuth: mocks.requireConvexAuth,
  AuthenticationError: class AuthenticationError extends Error {},
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
}));

vi.mock('@/lib/convex', () => ({
  getConvexClient: () => ({ query: mocks.query }),
  mutateInternal: mocks.mutateInternal,
}));

describe('WinCross profile routes', () => {
  let ListGET: typeof import('@/app/api/orgs/wincross-profiles/route').GET;
  let ListPOST: typeof import('@/app/api/orgs/wincross-profiles/route').POST;
  let DeleteRoute: typeof import('@/app/api/orgs/wincross-profiles/[profileId]/route').DELETE;
  let DefaultRoute: typeof import('@/app/api/orgs/wincross-profiles/[profileId]/default/route').PATCH;

  beforeEach(async () => {
    if (!ListGET) {
      ({ GET: ListGET, POST: ListPOST } = await import('@/app/api/orgs/wincross-profiles/route'));
      ({ DELETE: DeleteRoute } = await import('@/app/api/orgs/wincross-profiles/[profileId]/route'));
      ({ PATCH: DefaultRoute } = await import('@/app/api/orgs/wincross-profiles/[profileId]/default/route'));
    }
    vi.clearAllMocks();
  });

  it('lists profiles for the current org', async () => {
    mocks.query.mockResolvedValueOnce([
      { _id: 'profile-1', name: 'Standard', isDefault: true },
    ]);

    const response = await ListGET();
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.profiles).toEqual([
      { _id: 'profile-1', name: 'Standard', isDefault: true },
    ]);
  });

  it('creates a profile from uploaded .job file', async () => {
    mocks.mutateInternal.mockResolvedValueOnce('profile-1');
    mocks.query.mockResolvedValueOnce({
      _id: 'profile-1',
      name: 'Standard',
      isDefault: true,
      profile: { version: '25.0' },
    });

    const formData = new FormData();
    formData.set('name', 'Standard');
    formData.set('description', 'Primary client profile');
    formData.set('isDefault', 'true');
    formData.set(
      'file',
      new File(
        [Buffer.from('[VERSION]\n25.0\n[PREFERENCES]\n0,0,0,0,0\nOS,OR,OV,O%\nTotal^TN^1\n', 'utf8')],
        'standard.job',
        { type: 'text/plain' },
      ),
    );

    const response = await ListPOST(
      new NextRequest('http://localhost/api/orgs/wincross-profiles', {
        method: 'POST',
        body: formData,
      }),
    );
    const payload = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(1);
    expect(mocks.mutateInternal.mock.calls[0][1]).toMatchObject({
      orgId: 'org-1',
      name: 'Standard',
      sourceFileName: 'standard.job',
      isDefault: true,
      createdBy: 'user-1',
    });
    expect(payload.profile).toMatchObject({
      _id: 'profile-1',
      name: 'Standard',
    });
  });

  it('deletes a profile', async () => {
    const response = await DeleteRoute(
      new NextRequest('http://localhost/api/orgs/wincross-profiles/profile-1', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ profileId: 'profile_1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org-1',
        profileId: 'profile_1',
      }),
    );
  });

  it('sets the default profile', async () => {
    const response = await DefaultRoute(
      new NextRequest('http://localhost/api/orgs/wincross-profiles/profile-1/default', {
        method: 'PATCH',
      }),
      { params: Promise.resolve({ profileId: 'profile_1' }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.mutateInternal).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        orgId: 'org-1',
        profileId: 'profile_1',
      }),
    );
  });
});
