/**
 * History Browser Component
 *
 * Browse previous pipeline runs and their artifacts.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Header, HorizontalRule } from './shared';
import type { HistoryState, PipelineRun, HistoryArtifact } from '../state/types';

// =============================================================================
// Types
// =============================================================================

interface HistoryBrowserProps {
  state: HistoryState;
  currentDataset: string;
  onDrillDown?: () => void;
  onOpenInFinder?: (path: string) => void;
}

// =============================================================================
// Formatting Helpers
// =============================================================================

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

function formatDuration(ms: number): string {
  if (ms === 0) return '-';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function formatCost(cost: number): string {
  if (cost === 0) return '-';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

// =============================================================================
// Run Row
// =============================================================================

interface RunRowProps {
  run: PipelineRun;
  isSelected: boolean;
}

function RunRow({ run, isSelected }: RunRowProps): React.ReactElement {
  const date = formatDate(run.timestamp);
  const duration = formatDuration(run.durationMs);
  const cost = formatCost(run.costUsd);

  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined}>
        {isSelected ? '  \u25B6 ' : '    '}
      </Text>
      <Text color={isSelected ? 'yellow' : undefined}>{date}</Text>
      <Text>   </Text>
      <Text color="cyan">{duration.padEnd(10)}</Text>
      <Text color="green">{cost.padEnd(8)}</Text>
      <Text color="yellow">{String(run.tableCount).padEnd(4)} tables</Text>
      <Text>  </Text>
      {run.status === 'completed' ? (
        <Text color="green">{'\u2713'} completed</Text>
      ) : (
        <Text color="red">{'\u2717'} failed</Text>
      )}
    </Box>
  );
}

// =============================================================================
// Artifact Row
// =============================================================================

interface ArtifactRowProps {
  artifact: HistoryArtifact;
  isSelected: boolean;
}

function ArtifactRow({ artifact, isSelected }: ArtifactRowProps): React.ReactElement {
  const icon = artifact.isDirectory ? '\uD83D\uDCC1' : '\uD83D\uDCC4'; // folder or document icon

  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined}>
        {isSelected ? '  \u25B6 ' : '    '}
      </Text>
      <Text>{icon} </Text>
      <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
        {artifact.name.padEnd(28)}
      </Text>
      <Text color="gray">{artifact.description}</Text>
    </Box>
  );
}

// =============================================================================
// Content Viewer
// =============================================================================

interface ContentViewerProps {
  content: string;
  scrollOffset: number;
}

function ContentViewer({ content, scrollOffset }: ContentViewerProps): React.ReactElement {
  const lines = content.split('\n');
  const visibleLines = lines.slice(scrollOffset, scrollOffset + 20);
  const totalLines = lines.length;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color="gray">
          Lines {scrollOffset + 1}-{Math.min(scrollOffset + 20, totalLines)} of {totalLines}
        </Text>
      </Box>
      <Box flexDirection="column" borderStyle="single" borderColor="gray" padding={1}>
        {visibleLines.map((line, index) => (
          <Text key={index} wrap="truncate">
            {line || ' '}
          </Text>
        ))}
      </Box>
    </Box>
  );
}

// =============================================================================
// Runs List
// =============================================================================

interface RunsListProps {
  runs: PipelineRun[];
  selectedIndex: number;
  dataset: string;
}

function RunsList({ runs, selectedIndex, dataset }: RunsListProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Header title="Pipeline History" subtitle={dataset} />

      <Box flexDirection="column" paddingY={1}>
        {runs.length === 0 ? (
          <Text color="gray">  No pipeline runs found for this dataset</Text>
        ) : (
          runs.map((run, index) => (
            <RunRow key={run.path} run={run} isSelected={index === selectedIndex} />
          ))
        )}
      </Box>

      <HorizontalRule />
      <Box paddingX={1}>
        <Text color="cyan">[j/k]</Text>
        <Text color="gray"> select  </Text>
        <Text color="cyan">[Enter]</Text>
        <Text color="gray"> view run  </Text>
        <Text color="cyan">[Esc]</Text>
        <Text color="gray"> back  </Text>
        <Text color="cyan">[q]</Text>
        <Text color="gray"> quit</Text>
      </Box>
    </Box>
  );
}

// =============================================================================
// Artifacts List
// =============================================================================

interface ArtifactsListProps {
  artifacts: HistoryArtifact[];
  selectedIndex: number;
  runTimestamp: Date | null;
}

function ArtifactsList({ artifacts, selectedIndex, runTimestamp }: ArtifactsListProps): React.ReactElement {
  const subtitle = runTimestamp ? `Run: ${formatDate(runTimestamp)}` : 'Run Details';

  return (
    <Box flexDirection="column">
      <Header title="Run Details" subtitle={subtitle} showBack />

      <Box flexDirection="column" paddingY={1}>
        {artifacts.length === 0 ? (
          <Text color="gray">  No artifacts found</Text>
        ) : (
          artifacts.map((artifact, index) => (
            <ArtifactRow key={artifact.path} artifact={artifact} isSelected={index === selectedIndex} />
          ))
        )}
      </Box>

      <HorizontalRule />
      <Box paddingX={1}>
        <Text color="cyan">[j/k]</Text>
        <Text color="gray"> select  </Text>
        <Text color="cyan">[Enter]</Text>
        <Text color="gray"> view  </Text>
        <Text color="cyan">[o]</Text>
        <Text color="gray"> open in Finder  </Text>
        <Text color="cyan">[Esc]</Text>
        <Text color="gray"> back</Text>
      </Box>
    </Box>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function HistoryBrowser({
  state,
  currentDataset,
}: HistoryBrowserProps): React.ReactElement {
  // Viewer mode
  if (state.level === 'viewer' && state.viewerContent) {
    return (
      <Box flexDirection="column">
        <Header title="File Viewer" showBack />
        <Box paddingY={1}>
          <ContentViewer content={state.viewerContent} scrollOffset={state.viewerScrollOffset} />
        </Box>
        <HorizontalRule />
        <Box paddingX={1}>
          <Text color="cyan">[j/k]</Text>
          <Text color="gray"> scroll  </Text>
          <Text color="cyan">[Esc]</Text>
          <Text color="gray"> back  </Text>
          <Text color="cyan">[q]</Text>
          <Text color="gray"> quit</Text>
        </Box>
      </Box>
    );
  }

  // Artifacts view
  if (state.level === 'artifacts') {
    const selectedRun = state.runs[state.selectedRunIndex];
    return (
      <ArtifactsList
        artifacts={state.artifacts}
        selectedIndex={state.selectedArtifactIndex}
        runTimestamp={selectedRun?.timestamp || null}
      />
    );
  }

  // Runs view (default)
  return (
    <RunsList
      runs={state.runs}
      selectedIndex={state.selectedRunIndex}
      dataset={currentDataset}
    />
  );
}
