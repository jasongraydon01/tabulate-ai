import fs from 'fs';
import path from 'path';

function looksLikeRepoRoot(candidate: string): boolean {
  try {
    return fs.existsSync(path.join(candidate, 'package.json'))
      && fs.existsSync(path.join(candidate, 'src'));
  } catch {
    return false;
  }
}

function findRepoRoot(start: string): string | null {
  let current = path.resolve(start);

  while (true) {
    if (looksLikeRepoRoot(current)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function getWorkspaceRoot(): string {
  const candidates = [
    process.env.TABULATE_AI_ROOT,
    process.env.INIT_CWD,
    process.env.PWD,
    process.cwd(),
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const resolved = findRepoRoot(candidate);
    if (resolved) {
      return resolved;
    }
  }

  return path.resolve(process.cwd());
}

export function getOutputsBaseDir(): string {
  return path.join(getWorkspaceRoot(), 'outputs');
}

export function isPathInsideOutputsBase(targetPath: string): boolean {
  const resolvedTarget = path.resolve(targetPath);
  const outputsBase = getOutputsBaseDir();
  const relative = path.relative(outputsBase, resolvedTarget);

  return (
    resolvedTarget !== outputsBase
    && relative !== ''
    && relative !== '.'
    && !relative.startsWith('..')
    && !path.isAbsolute(relative)
  );
}
