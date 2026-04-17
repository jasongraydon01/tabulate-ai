import { spawn, type ChildProcess } from 'node:child_process';
import process from 'node:process';

type ManagedProcess = {
  name: string;
  command: string;
  args: string[];
  env?: NodeJS.ProcessEnv;
  child?: ChildProcess;
};

const isWindows = process.platform === 'win32';

const managedProcesses: ManagedProcess[] = [
  {
    name: 'convex',
    command: isWindows ? 'npx.cmd' : 'npx',
    args: ['convex', 'dev'],
  },
  {
    name: 'web',
    command: isWindows ? 'npx.cmd' : 'npx',
    args: ['next', 'dev', '--turbopack'],
  },
  {
    name: 'worker',
    command: isWindows ? 'npx.cmd' : 'npx',
    args: ['tsx', 'scripts/worker.ts'],
    env: {
      ...process.env,
      // Keep local queue pickup snappy without changing the standalone worker default.
      PIPELINE_WORKER_POLL_MS: process.env.PIPELINE_WORKER_POLL_MS ?? '1000',
    },
  },
];

const RESET = '\u001b[0m';
const COLORS = ['\u001b[36m', '\u001b[35m', '\u001b[33m'];

let shuttingDown = false;
let exitCode = 0;
let closedProcessCount = 0;

function prefixLines(name: string, color: string, chunk: Buffer | string): string[] {
  return chunk
    .toString()
    .split(/\r?\n/)
    .filter((line) => line.length > 0)
    .map((line) => `${color}[${name}]${RESET} ${line}`);
}

function writeChunk(
  name: string,
  color: string,
  chunk: Buffer | string,
  target: NodeJS.WriteStream
): void {
  const lines = prefixLines(name, color, chunk);
  if (lines.length === 0) {
    return;
  }

  target.write(`${lines.join('\n')}\n`);
}

function terminateProcess(child: ChildProcess | undefined): void {
  if (!child?.pid || child.killed) {
    return;
  }

  if (isWindows) {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
    });
    taskkill.unref();
    return;
  }

  child.kill('SIGTERM');
}

function finalizeIfComplete(): void {
  if (closedProcessCount === managedProcesses.length) {
    process.exit(exitCode);
  }
}

function shutdown(nextExitCode = 0): void {
  if (shuttingDown) {
    exitCode = exitCode || nextExitCode;
    return;
  }

  shuttingDown = true;
  exitCode = nextExitCode;

  for (const managed of managedProcesses) {
    terminateProcess(managed.child);
  }

  setTimeout(() => {
    for (const managed of managedProcesses) {
      if (managed.child?.exitCode === null && managed.child?.signalCode === null) {
        if (isWindows) {
          terminateProcess(managed.child);
        } else {
          managed.child.kill('SIGKILL');
        }
      }
    }
  }, 5_000).unref();

  finalizeIfComplete();
}

function spawnManagedProcess(managed: ManagedProcess, color: string): void {
  const child = spawn(managed.command, managed.args, {
    cwd: process.cwd(),
    env: managed.env ?? process.env,
    stdio: ['inherit', 'pipe', 'pipe'],
  });

  managed.child = child;

  child.stdout?.on('data', (chunk) => {
    writeChunk(managed.name, color, chunk, process.stdout);
  });

  child.stderr?.on('data', (chunk) => {
    writeChunk(managed.name, color, chunk, process.stderr);
  });

  child.on('error', (error) => {
    writeChunk(
      managed.name,
      color,
      `Failed to start: ${error.message}`,
      process.stderr
    );
    shutdown(1);
  });

  child.on('close', (code, signal) => {
    closedProcessCount += 1;

    if (!shuttingDown) {
      const reason =
        signal !== null
          ? `stopped with signal ${signal}`
          : `exited with code ${code ?? 1}`;
      writeChunk(managed.name, color, reason, process.stderr);
      shutdown(code ?? 1);
      return;
    }

    finalizeIfComplete();
  });
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

managedProcesses.forEach((managed, index) => {
  spawnManagedProcess(managed, COLORS[index] ?? RESET);
});
