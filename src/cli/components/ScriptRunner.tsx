/**
 * Script Runner Component
 *
 * Lists available scripts and allows running them with confirmation for long scripts.
 */

import React from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { Header, HorizontalRule } from './shared';
import { getCategoryBadge } from '../utils/scripts';
import type { ScriptInfo, ScriptState } from '../state/types';

// =============================================================================
// Types
// =============================================================================

interface ScriptRunnerProps {
  state: ScriptState;
  dataset: string;
  onRun?: (script: ScriptInfo) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

// =============================================================================
// Script Row
// =============================================================================

interface ScriptRowProps {
  script: ScriptInfo;
  isSelected: boolean;
}

function ScriptRow({ script, isSelected }: ScriptRowProps): React.ReactElement {
  const badge = getCategoryBadge(script.category);

  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined}>
        {isSelected ? '  \u25B6 ' : '    '}
      </Text>
      <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
        {script.name.padEnd(30)}
      </Text>
      {badge && (
        <>
          <Text color={badge.color}>{badge.text.padEnd(6)}</Text>
          <Text> </Text>
        </>
      )}
      {!badge && <Text>{''.padEnd(7)}</Text>}
      <Text color="gray">{script.description}</Text>
    </Box>
  );
}

// =============================================================================
// Confirmation Dialog
// =============================================================================

interface ConfirmationDialogProps {
  script: ScriptInfo;
  onConfirm: () => void;
  onCancel: () => void;
}

function ConfirmationDialog({ script, onConfirm, onCancel }: ConfirmationDialogProps): React.ReactElement {
  useInput((input, key) => {
    if (input === 'y' || input === 'Y' || key.return) {
      onConfirm();
    } else if (input === 'n' || input === 'N' || key.escape) {
      onCancel();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" padding={1}>
      <Box marginBottom={1}>
        <Text color="yellow" bold>
          Warning: Long-Running Script
        </Text>
      </Box>
      <Box marginBottom={1}>
        <Text>
          <Text color="cyan">{script.name}</Text> may take <Text color="red" bold>45-60 minutes</Text> to complete.
        </Text>
      </Box>
      <Box>
        <Text color="gray">Are you sure you want to run it? </Text>
        <Text color="green">[y]</Text>
        <Text color="gray"> yes  </Text>
        <Text color="red">[n]</Text>
        <Text color="gray"> no</Text>
      </Box>
    </Box>
  );
}

// =============================================================================
// Script Output View
// =============================================================================

interface ScriptOutputProps {
  scriptName: string;
  output: string[];
  exitCode: number | null;
}

function ScriptOutput({ scriptName, output, exitCode }: ScriptOutputProps): React.ReactElement {
  const isRunning = exitCode === null;
  const visibleLines = output.slice(-20); // Show last 20 lines

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        {isRunning ? (
          <>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text color="yellow"> Running {scriptName}...</Text>
          </>
        ) : exitCode === 0 ? (
          <Text color="green">Completed successfully</Text>
        ) : (
          <Text color="red">Failed with exit code {exitCode}</Text>
        )}
      </Box>

      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        {visibleLines.length === 0 ? (
          <Text color="gray">Waiting for output...</Text>
        ) : (
          visibleLines.map((line, index) => (
            <Text key={index} wrap="truncate">
              {line.startsWith('[stderr]') ? (
                <Text color="red">{line}</Text>
              ) : line.startsWith('[error]') ? (
                <Text color="red" bold>{line}</Text>
              ) : (
                line
              )}
            </Text>
          ))
        )}
      </Box>

      {!isRunning && (
        <Box marginTop={1}>
          <Text color="gray">Press </Text>
          <Text color="cyan">[Esc]</Text>
          <Text color="gray"> to go back</Text>
        </Box>
      )}
    </Box>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function ScriptRunner({
  state,
  dataset,
  onConfirm,
  onCancel,
}: ScriptRunnerProps): React.ReactElement {
  // Show confirmation dialog if pending
  if (state.showConfirmation && state.pendingScript) {
    return (
      <Box flexDirection="column">
        <Header title="Script Runner" />
        <Box paddingY={1}>
          <ConfirmationDialog
            script={state.pendingScript}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        </Box>
      </Box>
    );
  }

  // Show output if running or completed
  if (state.runningScript || state.exitCode !== null) {
    return (
      <Box flexDirection="column">
        <Header title="Script Runner" />
        <Box paddingY={1}>
          <ScriptOutput
            scriptName={state.runningScript || 'Script'}
            output={state.output}
            exitCode={state.exitCode}
          />
        </Box>
      </Box>
    );
  }

  // Show script list

  return (
    <Box flexDirection="column">
      <Header title="Script Runner" />

      {/* Script List */}
      <Box flexDirection="column" paddingY={1}>
        {state.scripts.length === 0 ? (
          <Text color="gray">  No scripts found in scripts/</Text>
        ) : (
          state.scripts.map((script, index) => (
            <ScriptRow
              key={script.name}
              script={script}
              isSelected={index === state.selectedIndex}
            />
          ))
        )}
      </Box>

      {/* Dataset Info */}
      <Box paddingTop={1}>
        <Text color="gray">  Dataset: </Text>
        <Text color="cyan">{dataset || 'Not configured'}</Text>
      </Box>

      {/* Key Hints */}
      <Box paddingTop={1}>
        <HorizontalRule />
      </Box>
      <Box paddingX={1}>
        <Text color="cyan">[j/k]</Text>
        <Text color="gray"> select  </Text>
        <Text color="cyan">[Enter]</Text>
        <Text color="gray"> run  </Text>
        <Text color="cyan">[Esc]</Text>
        <Text color="gray"> back  </Text>
        <Text color="cyan">[q]</Text>
        <Text color="gray"> quit</Text>
      </Box>
    </Box>
  );
}
