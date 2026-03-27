import path from 'path';
import { describe, expect, it } from 'vitest';

import {
  extractRunArtifactPrefix,
  localPathForRunArtifact,
} from '@/lib/r2/runArtifactDownload';

describe('runArtifactDownload', () => {
  it('extracts org, project, and run ids from a raw run prefix', () => {
    expect(
      extractRunArtifactPrefix('jh7f/org123/runs/run456'),
    ).toEqual({
      orgId: 'jh7f',
      projectId: 'org123',
      runId: 'run456',
      prefix: 'jh7f/org123/runs/run456',
    });
  });

  it('extracts the real R2 prefix from a longer pasted path', () => {
    expect(
      extractRunArtifactPrefix('tabulate-ai-dev/jh7fzd78wf7dqjrqnqgeyzwfgs83n1aw/jn704zsk1je919zeqhyxmwh6v983px55/runs/jx7bvvd2pnyfytnerhfyy1dk0583qkx9/'),
    ).toEqual({
      orgId: 'jh7fzd78wf7dqjrqnqgeyzwfgs83n1aw',
      projectId: 'jn704zsk1je919zeqhyxmwh6v983px55',
      runId: 'jx7bvvd2pnyfytnerhfyy1dk0583qkx9',
      prefix: 'jh7fzd78wf7dqjrqnqgeyzwfgs83n1aw/jn704zsk1je919zeqhyxmwh6v983px55/runs/jx7bvvd2pnyfytnerhfyy1dk0583qkx9',
    });
  });

  it('maps an R2 key under the local output directory', () => {
    expect(
      localPathForRunArtifact(
        '/tmp/run-download',
        'org/project/runs/run-1',
        'org/project/runs/run-1/planning/21-crosstab-plan.json',
      ),
    ).toBe(path.join('/tmp/run-download', 'planning', '21-crosstab-plan.json'));
  });
});
