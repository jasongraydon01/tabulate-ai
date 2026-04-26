import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildAnalysisComputeFingerprint } from '@/lib/analysis/computeLane/fingerprint';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  mutateInternal: vi.fn(),
  loadAnalysisParentRunArtifacts: vi.fn(),
}));

vi.mock('@/lib/requireConvexAuth', () => ({
  requireConvexAuth: vi.fn(async () => ({
    convexOrgId: 'org-1',
    convexUserId: 'user-1',
    role: 'admin',
  })),
}));

vi.mock('@/lib/withRateLimit', () => ({
  applyRateLimit: vi.fn(() => null),
}));

vi.mock('@/lib/convex', () => ({
  getConvexClient: () => ({ query: mocks.query }),
  mutateInternal: mocks.mutateInternal,
}));

vi.mock('@/lib/analysis/computeLane/artifactLoader', () => ({
  loadAnalysisParentRunArtifacts: mocks.loadAnalysisParentRunArtifacts,
}));

const frozenBannerGroup = {
  groupName: 'Region',
  columns: [{ name: 'North', original: 'REGION=1' }],
};

const frozenValidatedGroup = {
  groupName: 'Region',
  columns: [{
    name: 'North',
    adjusted: 'REGION == 1',
    confidence: 0.95,
    reasoning: 'Direct match',
    userSummary: 'Matched directly.',
    alternatives: [],
    uncertainties: [],
    expressionType: 'direct_variable' as const,
  }],
};

const baseArtifactKeys = {
  bannerPlan: 'r2/planning/20-banner-plan.json',
  crosstabPlan: 'r2/planning/21-crosstab-plan.json',
  questionIdFinal: 'r2/enrichment/12-questionid-final.json',
  tableEnriched: 'r2/tables/13e-table-enriched.json',
  tableCanonical: undefined,
  dataFileSav: 'r2/dataFile.sav',
};

function makeParentArtifacts(artifactKeys = baseArtifactKeys) {
  return {
    outputs: {
      'planning/20-banner-plan.json': artifactKeys.bannerPlan,
      'planning/21-crosstab-plan.json': artifactKeys.crosstabPlan,
      'enrichment/12-questionid-final.json': artifactKeys.questionIdFinal,
      'tables/13e-table-enriched.json': artifactKeys.tableEnriched,
      'dataFile.sav': artifactKeys.dataFileSav,
    },
    parentPipelineId: 'parent-pipeline',
    parentDatasetName: 'study',
    bannerPlan: { bannerCuts: [] },
    crosstabPlan: { bannerCuts: [] },
    artifactKeys,
  };
}

function makeJob(fingerprint: string) {
  return {
    _id: 'job-1',
    orgId: 'org-1',
    projectId: 'project-1',
    parentRunId: 'run-1',
    sessionId: 'session-1',
    requestText: 'Add region',
    fingerprint,
    reviewFlags: {
      requiresClarification: false,
      requiresReview: false,
      reasons: [],
      averageConfidence: 0.95,
      policyFallbackDetected: false,
    },
    frozenBannerGroup,
    frozenValidatedGroup,
  };
}

describe('analysis compute confirm route', () => {
  let POST: typeof import('@/app/api/runs/[runId]/analysis/compute/jobs/[jobId]/confirm/route').POST;

  beforeEach(async () => {
    if (!POST) {
      ({ POST } = await import('@/app/api/runs/[runId]/analysis/compute/jobs/[jobId]/confirm/route'));
    }
    vi.clearAllMocks();
  });

  it('rejects confirmation when parent artifact keys changed since preflight', async () => {
    const fingerprint = buildAnalysisComputeFingerprint({
      parentRunId: 'run-1',
      parentArtifactKeys: baseArtifactKeys,
      requestText: 'Add region',
      frozenBannerGroup,
      frozenValidatedGroup,
    });

    mocks.query
      .mockResolvedValueOnce({ _id: 'run-1', status: 'success', config: {}, result: {} })
      .mockResolvedValueOnce(makeJob(fingerprint))
      .mockResolvedValueOnce({ _id: 'project-1', name: 'Study' });
    mocks.loadAnalysisParentRunArtifacts.mockResolvedValueOnce(makeParentArtifacts({
      ...baseArtifactKeys,
      crosstabPlan: 'r2/planning/21-crosstab-plan-v2.json',
    }));

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/analysis/compute/jobs/job-1/confirm', {
        method: 'POST',
        body: JSON.stringify({ fingerprint }),
      }),
      { params: Promise.resolve({ runId: 'run-1', jobId: 'job-1' }) },
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'Parent run artifacts changed; rerun preflight' });
    expect(mocks.mutateInternal).not.toHaveBeenCalled();
  });

  it('uses the atomic confirm-and-enqueue mutation for a fresh confirmation', async () => {
    const fingerprint = buildAnalysisComputeFingerprint({
      parentRunId: 'run-1',
      parentArtifactKeys: baseArtifactKeys,
      requestText: 'Add region',
      frozenBannerGroup,
      frozenValidatedGroup,
    });

    mocks.query
      .mockResolvedValueOnce({ _id: 'run-1', status: 'success', config: {}, result: {} })
      .mockResolvedValueOnce(makeJob(fingerprint))
      .mockResolvedValueOnce({ _id: 'project-1', name: 'Study' });
    mocks.loadAnalysisParentRunArtifacts.mockResolvedValueOnce(makeParentArtifacts());
    mocks.mutateInternal
      .mockResolvedValueOnce({ childRunId: 'child-run-1', alreadyQueued: false })
      .mockResolvedValueOnce('message-1');

    const response = await POST(
      new NextRequest('http://localhost/api/runs/run-1/analysis/compute/jobs/job-1/confirm', {
        method: 'POST',
        body: JSON.stringify({ fingerprint }),
      }),
      { params: Promise.resolve({ runId: 'run-1', jobId: 'job-1' }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      accepted: true,
      childRunId: 'child-run-1',
      alreadyQueued: false,
    });
    expect(mocks.mutateInternal).toHaveBeenCalledTimes(2);
    expect(mocks.mutateInternal.mock.calls[0][1]).toMatchObject({
      parentRunId: 'run-1',
      analysisComputeJobId: 'job-1',
      expectedFingerprint: fingerprint,
      queueClass: 'project',
    });
    expect(mocks.mutateInternal.mock.calls[0][1].executionPayload.analysisExtension).toMatchObject({
      kind: 'banner_extension',
      fingerprint,
      frozenBannerGroup,
      frozenValidatedGroup,
    });
  });
});
