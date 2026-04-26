import { describe, expect, it } from 'vitest';

import { isAnalysisComputeRun, isProjectDefaultCandidate, selectPrimaryProjectRun } from '../selectPrimaryRun';

describe('selectPrimaryProjectRun', () => {
  it('skips failed analysis compute child runs when selecting the project-level run', () => {
    const runs = [
      {
        _id: 'child-run',
        status: 'error',
        origin: 'analysis_compute',
        parentRunId: 'parent-run',
        analysisComputeJobId: 'job-1',
        lineageKind: 'banner_extension',
      },
      {
        _id: 'parent-run',
        status: 'success',
      },
    ];

    expect(selectPrimaryProjectRun(runs)?._id).toBe('parent-run');
    expect(isAnalysisComputeRun(runs[0])).toBe(true);
    expect(isProjectDefaultCandidate(runs[0])).toBe(false);
  });

  it('allows completed analysis compute child runs to become the project default', () => {
    const runs = [
      {
        _id: 'child-run',
        status: 'success',
        origin: 'analysis_compute',
        parentRunId: 'parent-run',
        analysisComputeJobId: 'job-1',
        lineageKind: 'banner_extension',
      },
      {
        _id: 'parent-run',
        status: 'success',
      },
    ];

    expect(selectPrimaryProjectRun(runs)?._id).toBe('child-run');
    expect(isProjectDefaultCandidate(runs[0])).toBe(true);
  });

  it('falls back to the first run when no primary project run exists', () => {
    const runs = [{ _id: 'child-run', origin: 'analysis_compute' }];

    expect(selectPrimaryProjectRun(runs)?._id).toBe('child-run');
  });
});
