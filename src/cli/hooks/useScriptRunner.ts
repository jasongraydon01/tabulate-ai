/**
 * useScriptRunner Hook
 *
 * Manages subprocess execution for running test scripts.
 */

import { useCallback, useRef } from 'react';
import { spawn, ChildProcess } from 'child_process';
import type { ScriptInfo } from '../state/types';

// =============================================================================
// Types
// =============================================================================

export interface UseScriptRunnerOptions {
  onOutput: (line: string) => void;
  onComplete: (exitCode: number) => void;
  onStart: (scriptName: string) => void;
}

export interface ScriptRunnerHandle {
  run: (script: ScriptInfo) => void;
  stop: () => void;
  isRunning: boolean;
}

// =============================================================================
// Hook
// =============================================================================

export function useScriptRunner({
  onOutput,
  onComplete,
  onStart,
}: UseScriptRunnerOptions): ScriptRunnerHandle {
  const processRef = useRef<ChildProcess | null>(null);
  const isRunningRef = useRef(false);

  const run = useCallback((script: ScriptInfo) => {
    if (isRunningRef.current) {
      return;
    }

    isRunningRef.current = true;
    onStart(script.name);

    // Run the script with npx tsx
    const child = spawn('npx', ['tsx', script.path], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    processRef.current = child;

    // Handle stdout
    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          onOutput(line);
        }
      }
    });

    // Handle stderr
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line.trim()) {
          onOutput(`[stderr] ${line}`);
        }
      }
    });

    // Handle exit
    child.on('close', (code) => {
      isRunningRef.current = false;
      processRef.current = null;
      onComplete(code ?? 1);
    });

    // Handle error
    child.on('error', (err) => {
      isRunningRef.current = false;
      processRef.current = null;
      onOutput(`[error] ${err.message}`);
      onComplete(1);
    });
  }, [onOutput, onComplete, onStart]);

  const stop = useCallback(() => {
    if (processRef.current) {
      processRef.current.kill('SIGTERM');
      processRef.current = null;
      isRunningRef.current = false;
    }
  }, []);

  return {
    run,
    stop,
    get isRunning() {
      return isRunningRef.current;
    },
  };
}
