import path from 'path';

export interface RunArtifactPrefix {
  orgId: string;
  projectId: string;
  runId: string;
  prefix: string;
}

function normalizeInputPath(input: string): string[] {
  return input
    .trim()
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
}

export function extractRunArtifactPrefix(input: string): RunArtifactPrefix {
  const segments = normalizeInputPath(input);
  const runsIndex = segments.lastIndexOf('runs');

  if (runsIndex < 2 || runsIndex + 1 >= segments.length) {
    throw new Error(
      'Expected a run artifact path containing orgId/projectId/runs/runId.',
    );
  }

  const orgId = segments[runsIndex - 2];
  const projectId = segments[runsIndex - 1];
  const runId = segments[runsIndex + 1];

  return {
    orgId,
    projectId,
    runId,
    prefix: `${orgId}/${projectId}/runs/${runId}`,
  };
}

export function localPathForRunArtifact(outputDir: string, prefix: string, key: string): string {
  if (!key.startsWith(prefix)) {
    throw new Error(`Key ${key} does not start with prefix ${prefix}`);
  }

  const relativePath = key.slice(prefix.length).replace(/^\/+/, '');
  if (!relativePath) {
    throw new Error(`Key ${key} resolves to an empty relative path.`);
  }

  return path.join(outputDir, relativePath);
}
