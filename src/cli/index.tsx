#!/usr/bin/env node
/**
 * TabulateAI CLI Entry Point
 *
 * Usage:
 *   hawktab                Show interactive menu (default)
 *   hawktab run [dataset]  Run the pipeline
 *   hawktab demo           Show UI in demo mode (no pipeline)
 *   hawktab help           Show help
 *
 * Options:
 *   --no-ui              Run without interactive UI (plain output)
 *   --format=standard|stacked Excel format (default: standard)
 *   --display=frequency|counts|both Display mode (default: frequency)
 *   --concurrency=N      Override parallel limit
 *   --stop-after-verification Stop before R/Excel generation
 */

// Load environment variables BEFORE any other imports that might need them
import '../lib/loadEnv';

import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import { format as formatString } from 'util';
import { Writable } from 'stream';
import { readFile } from 'fs/promises';
import { App } from './App';
import { getPipelineEventBus } from '../lib/events';
import { runPipeline, DEFAULT_DATASET } from '../lib/pipeline';
import type { ExcelFormat, DisplayMode } from '../lib/excel/ExcelFormatter';
import { parseRegroupConfigJson, parseRegroupEnabledFlag, type RegroupConfigOverride } from '../lib/tables/regroupConfig';

// =============================================================================
// CLI Definition
// =============================================================================

const cli = meow(
  `
  Usage
    $ hawktab              Show interactive menu
    $ hawktab run [dataset]  Run the pipeline
    $ hawktab demo         Show UI in demo mode (no pipeline)
    $ hawktab help         Show this help

  Options
    --no-ui              Run without interactive UI (plain output mode)
    --format=FORMAT      Excel format: standard (default) or stacked
    --display=MODE       Display mode: frequency (default), counts, or both
    --concurrency=N      Override parallel processing limit (default: 3)
    --stop-after-verification  Stop pipeline before R/Excel generation
    --stat-thresholds=X,Y  Significance thresholds (e.g., 0.05,0.10 for dual confidence)
    --stat-min-base=N    Minimum base size for significance testing (default: 0)
    --regroup-config=PATH  JSON file with regroup override object
    --regroup-enabled=BOOL Quick regroup enabled override (true|false)

  Examples
    $ hawktab
    $ hawktab run
    $ hawktab run data/my-dataset
    $ hawktab run --format=standard --display=both
    $ hawktab run --stat-thresholds=0.05,0.10 --stat-min-base=30
    $ hawktab run --regroup-enabled=false
    $ hawktab run --no-ui
    $ hawktab demo
`,
  {
    importMeta: import.meta,
    flags: {
      noUi: {
        type: 'boolean',
        default: false,
      },
      format: {
        type: 'string',
        default: 'standard',
      },
      display: {
        type: 'string',
        default: 'frequency',
      },
      concurrency: {
        type: 'number',
        default: 3,
      },
      stopAfterVerification: {
        type: 'boolean',
        default: false,
      },
      statThresholds: {
        type: 'string',
        default: '',
      },
      statMinBase: {
        type: 'number',
        default: -1,  // -1 means use env default
      },
      regroupConfig: {
        type: 'string',
        default: '',
      },
      regroupEnabled: {
        type: 'string',
        default: '',
      },
    },
  }
);

// =============================================================================
// Main
// =============================================================================

// =============================================================================
// Console Suppression for UI Mode
// =============================================================================

const originalConsole = {
  log: console.log,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

const originalStdoutWrite = process.stdout.write.bind(process.stdout);
const originalStderrWrite = process.stderr.write.bind(process.stderr);

function emitSystemLogLines(bus: ReturnType<typeof getPipelineEventBus>, level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
  const lines = message.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines) {
    const match = line.match(/^\[([^\]]+)\]\s*/);
    const stageName = match ? match[1] : undefined;
    const cleaned = match ? line.slice(match[0].length) : line;
    const derivedLevel =
      cleaned.toLowerCase().includes('stderr') && level === 'info' ? 'warn' : level;
    bus.emitSystemLog(derivedLevel, cleaned, stageName);
  }
}

function suppressConsole(): void {
  // Route console output to the event bus so UI can render logs.
  const bus = getPipelineEventBus();
  const emit = (level: 'info' | 'warn' | 'error' | 'debug', args: unknown[]) => {
    const message = formatString(...args);
    emitSystemLogLines(bus, level, message);
  };

  console.log = (...args: unknown[]) => emit('info', args);
  console.info = (...args: unknown[]) => emit('info', args);
  console.warn = (...args: unknown[]) => emit('warn', args);
  console.error = (...args: unknown[]) => {
    emit('error', args);
    // Preserve original error output if event bus is disabled (non-UI mode)
    if (!bus.isEnabled()) {
      originalConsole.error(...args);
    }
  };
}

function installStdoutCapture(): typeof process.stdout {
  const bus = getPipelineEventBus();
  const isInkWrite = { current: false };

  const inkStdout = new Writable({
    write(chunk, encoding, callback) {
      isInkWrite.current = true;
      originalStdoutWrite(chunk as Buffer, encoding as BufferEncoding);
      isInkWrite.current = false;
      callback();
    },
  });

  const captureWrite = (
    level: 'info' | 'warn' | 'error',
    originalWrite: typeof process.stdout.write
  ) => {
    return (chunk: string | Buffer, encoding?: BufferEncoding | ((err?: Error) => void), callback?: (err?: Error) => void): boolean => {
      if (!bus.isEnabled()) {
        return originalWrite(chunk as never, encoding as never, callback as never);
      }

      if (typeof encoding === 'function') {
        callback = encoding;
        encoding = undefined;
      }

      if (isInkWrite.current) {
        return originalWrite(chunk as never, encoding as never, callback as never);
      }

      const text = Buffer.isBuffer(chunk)
        ? chunk.toString(encoding || 'utf8')
        : chunk;
      emitSystemLogLines(bus, level, text);
      callback?.();
      return true;
    };
  };

  process.stdout.write = captureWrite('info', originalStdoutWrite);
  process.stderr.write = captureWrite('error', originalStderrWrite);

  // Cast to WriteStream — Ink doesn't use TTY-specific methods, but its
  // typings require it.  The Writable we hand it only proxies raw writes.
  return inkStdout as unknown as typeof process.stdout;
}

// =============================================================================
// Main
// =============================================================================

async function main(): Promise<void> {
  const [command, datasetFolder] = cli.input;

  // Show interactive menu if no command provided (new default behavior)
  if (!command) {
    // Enable event bus for when user starts pipeline from menu
    const bus = getPipelineEventBus();
    bus.enable();

    suppressConsole();
    const inkStdout = installStdoutCapture();

    // Track if pipeline has been started
    let pipelineStarted = false;

    const { waitUntilExit, unmount } = render(
      <App
        initialMode="menu"
        onExit={() => {
          unmount();
          process.exit(0);
        }}
        onStartPipeline={() => {
          if (pipelineStarted) return;
          pipelineStarted = true;

          // Start pipeline with default options
          runPipeline(DEFAULT_DATASET, {
            format: 'standard',
            displayMode: 'frequency',
            stopAfterVerification: false,
            concurrency: 3,
            quiet: true,
          })
            .then((result) => {
              if (!result.success) {
                console.error(`\nPipeline failed: ${result.error}`);
              }
            })
            .catch((error) => {
              console.error('\nUnexpected error:', error);
            });
        }}
      />
    , { stdout: inkStdout });

    await waitUntilExit();
    return;
  }

  // Show help
  if (command === 'help' || command === '--help' || command === '-h') {
    cli.showHelp();
    return;
  }

  // Handle demo command - show UI without running pipeline
  if (command === 'demo') {
    suppressConsole();
    const inkStdout = installStdoutCapture();

    const { waitUntilExit, unmount } = render(
      <App
        initialMode="pipeline"
        onExit={() => {
          unmount();
          process.exit(0);
        }}
      />
    , { stdout: inkStdout });

    await waitUntilExit();
    return;
  }

  if (command !== 'run') {
    console.error(`Unknown command: ${command}`);
    console.error('Use "hawktab" for interactive menu, "hawktab run [dataset]", or "hawktab help"');
    process.exit(1);
  }

  // Determine dataset folder (default if not provided)
  const dataset = datasetFolder || DEFAULT_DATASET;

  const regroupingOverride = await (async () => {
    let fromFile: RegroupConfigOverride = {};
    if (cli.flags.regroupConfig) {
      const raw = await readFile(cli.flags.regroupConfig, 'utf-8');
      fromFile = parseRegroupConfigJson(JSON.parse(raw));
    }

    const enabledFromFlag = parseRegroupEnabledFlag(cli.flags.regroupEnabled);
    const merged: RegroupConfigOverride = {
      ...fromFile,
      ...(enabledFromFlag !== undefined ? { enabled: enabledFromFlag } : {}),
    };

    return Object.keys(merged).length > 0 ? merged : undefined;
  })();

  // Parse options
  const format = (cli.flags.format === 'stacked' ? 'stacked' : 'standard') as ExcelFormat;
  const displayMode = (['frequency', 'counts', 'both'].includes(cli.flags.display)
    ? cli.flags.display
    : 'frequency') as DisplayMode;
  const concurrency = cli.flags.concurrency || 3;
  const stopAfterVerification = cli.flags.stopAfterVerification;

  // Parse stat testing options (CLI overrides env)
  type StatTestingOverride = { thresholds?: number[]; minBase?: number };
  const statTesting: StatTestingOverride = {};
  if (cli.flags.statThresholds) {
    const parsed = cli.flags.statThresholds
      .split(',')
      .map((s: string) => parseFloat(s.trim()))
      .filter((n: number) => !isNaN(n) && n > 0 && n < 1);
    if (parsed.length > 0) {
      statTesting.thresholds = parsed.sort((a: number, b: number) => a - b);
    }
  }
  if (cli.flags.statMinBase >= 0) {
    statTesting.minBase = cli.flags.statMinBase;
  }

  // Check for --no-ui flag
  if (cli.flags.noUi) {
    // Run in plain output mode (no UI, just console output)
    console.log('Running pipeline in plain output mode...\n');

    const result = await runPipeline(dataset, {
      format,
      displayMode,
      stopAfterVerification,
      concurrency,
      quiet: false, // Show console output
      statTesting: Object.keys(statTesting).length > 0 ? statTesting : undefined,
      regrouping: regroupingOverride,
    });

    if (!result.success) {
      console.error(`\nPipeline failed: ${result.error}`);
      process.exit(1);
    }

    process.exit(0);
  }

  // Enable event bus for UI mode
  const bus = getPipelineEventBus();
  bus.enable();

  // Suppress console output so it doesn't interfere with the UI
  // The pipeline emits events that the UI displays instead
  suppressConsole();
  const inkStdout = installStdoutCapture();

  // Create a promise that resolves when the App is ready to receive events
  let resolveReady: () => void;
  const readyPromise = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });

  // Render the Ink app
  const { waitUntilExit, unmount } = render(
    <App
      initialMode="pipeline"
      dataset={dataset}
      onExit={() => {
        unmount();
        process.exit(0);
      }}
      onReady={() => {
        resolveReady();
      }}
    />
  , { stdout: inkStdout });

  // Wait for App to be ready before starting pipeline
  // This ensures the event bus subscription is set up first
  await readyPromise;

  // Run the pipeline - now the UI is subscribed and ready for events
  runPipeline(dataset, {
    format,
    displayMode,
    stopAfterVerification,
    concurrency,
    quiet: true, // Suppress console output in UI mode
    statTesting: Object.keys(statTesting).length > 0 ? statTesting : undefined,
    regrouping: regroupingOverride,
  })
    .then((result) => {
      if (!result.success) {
        // Let the UI show the error, don't exit immediately
        console.error(`\nPipeline failed: ${result.error}`);
      }
      // Keep the UI running so user can see final state
      // They can press 'q' to exit
    })
    .catch((error) => {
      console.error('\nUnexpected error:', error);
      unmount();
      process.exit(1);
    });

  // Wait for the app to exit (user presses 'q')
  await waitUntilExit();
}

// Run main
main().catch((error) => {
  console.error('CLI Error:', error);
  process.exit(1);
});

// =============================================================================
// Export for programmatic usage
// =============================================================================

export { App } from './App';
export * from '../lib/events';
export { runPipeline } from '../lib/pipeline';
