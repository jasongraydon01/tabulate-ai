/**
 * Pipeline View Component (L0)
 *
 * Shows all 10 pipeline stages with their status, duration, and cost.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { StatusBadge, Duration, Cost, ProgressBar } from './shared';
import type { StageState } from '../state/types';

// =============================================================================
// Stage Row
// =============================================================================

interface StageRowProps {
  stage: StageState;
  isSelected: boolean;
  totalStages: number;
}

function StageRow({ stage, isSelected, totalStages }: StageRowProps): React.ReactElement {
  const stageNumStr = `[${stage.number}/${totalStages}]`;

  // Build status indicator with progress for parallel agents
  let statusContent: React.ReactElement;
  if (stage.status === 'running' && stage.progress) {
    statusContent = (
      <Box>
        <Text color="yellow">▸</Text>
        <Text>    </Text>
        <ProgressBar completed={stage.progress.completed} total={stage.progress.total} width={15} />
      </Box>
    );
  } else if (stage.status === 'running') {
    statusContent = <Text color="yellow">running...</Text>;
  } else if (stage.status === 'completed') {
    statusContent = (
      <Box>
        <Duration durationMs={stage.durationMs} />
        <Text>     </Text>
        <Cost costUsd={stage.costUsd} />
      </Box>
    );
  } else if (stage.status === 'failed') {
    statusContent = <Text color="red">{stage.error?.substring(0, 30) || 'failed'}</Text>;
  } else {
    statusContent = <Text color="gray">pending</Text>;
  }

  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined}>
        {isSelected ? '▶ ' : '  '}
      </Text>
      <StatusBadge status={stage.status} />
      <Text> </Text>
      <Text color="gray">{stageNumStr.padEnd(8)}</Text>
      <Text color={stage.status === 'running' ? 'yellow' : undefined}>
        {stage.name.padEnd(22)}
      </Text>
      {statusContent}
    </Box>
  );
}

// =============================================================================
// Pipeline View
// =============================================================================

interface PipelineViewProps {
  stages: StageState[];
  selectedIndex: number;
  dataset: string;
}

export function PipelineView({ stages, selectedIndex, dataset }: PipelineViewProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box borderStyle="single" borderColor="magenta" paddingX={1}>
        <Text color="magenta" bold>
          TabulateAI
        </Text>
        <Text color="gray">  │  </Text>
        <Text color="cyan">{dataset || 'No dataset'}</Text>
      </Box>

      {/* Stage List */}
      <Box flexDirection="column" paddingY={1}>
        {stages.map((stage, index) => (
          <StageRow
            key={stage.number}
            stage={stage}
            isSelected={index === selectedIndex}
            totalStages={stages.length}
          />
        ))}
      </Box>
    </Box>
  );
}
