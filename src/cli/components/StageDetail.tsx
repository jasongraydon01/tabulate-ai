/**
 * Stage Detail View Component (L1)
 *
 * Shows detailed view of a stage, including parallel slots for agents
 * like VerificationAgent and BaseFilterAgent.
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import { Header, Duration, Cost } from './shared';
import type { StageState, SlotState, CompletedTable } from '../state/types';

// =============================================================================
// Slot Row
// =============================================================================

interface SlotRowProps {
  slot: SlotState;
  isSelected: boolean;
}

function SlotRow({ slot, isSelected }: SlotRowProps): React.ReactElement {
  const slotLabel = `[slot-${slot.index + 1}]`;

  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined}>
        {isSelected ? '▶ ' : '  '}
      </Text>
      <Text color="gray">{slotLabel.padEnd(10)}</Text>
      {slot.status === 'running' ? (
        <>
          <Text color="yellow">
            <Spinner type="dots" />
          </Text>
          <Text> </Text>
          <Text color="cyan">{slot.tableId?.padEnd(15) || ''.padEnd(15)}</Text>
          {slot.latestLog && (
            <Text color="gray">  &quot;{slot.latestLog}&quot;</Text>
          )}
        </>
      ) : (
        <Text color="gray">idle</Text>
      )}
    </Box>
  );
}

// =============================================================================
// Recent Completions
// =============================================================================

interface RecentCompletionsProps {
  completions: CompletedTable[];
}

function RecentCompletions({ completions }: RecentCompletionsProps): React.ReactElement {
  if (completions.length === 0) {
    return <Text color="gray">No recent completions</Text>;
  }

  // Show up to 6 recent completions in a row
  const recent = completions.slice(0, 6);

  return (
    <Box>
      {recent.map((c, index) => (
        <React.Fragment key={c.tableId}>
          {index > 0 && <Text color="gray">  │  </Text>}
          <Text color="green">✓ </Text>
          <Text>{c.tableId.substring(0, 12)}</Text>
          <Text color="gray"> </Text>
          <Duration durationMs={c.durationMs} />
        </React.Fragment>
      ))}
    </Box>
  );
}

// =============================================================================
// Stage Detail View
// =============================================================================

interface StageDetailProps {
  stage: StageState;
  selectedSlotIndex: number;
  recentCompletions: CompletedTable[];
  modelName?: string;
}

export function StageDetail({
  stage,
  selectedSlotIndex,
  recentCompletions,
  modelName,
}: StageDetailProps): React.ReactElement {
  // Calculate progress string
  const progressStr = stage.progress
    ? `${stage.progress.completed}/${stage.progress.total} tables`
    : '';

  const concurrencyDisplay = stage.slots.length > 0 ? stage.slots.length : 1;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Header
        title={`${stage.name} (${stage.number}/10)`}
        subtitle={progressStr}
        showBack
      />

      {/* Stage Info */}
      <Box paddingY={1} paddingX={1} borderStyle="single" borderColor="gray">
        <Text color="gray">Model: </Text>
        <Text color="cyan">{modelName || 'Unknown'}</Text>
        <Text color="gray">  │  Concurrency: </Text>
        <Text color="cyan">{concurrencyDisplay}</Text>
        <Text color="gray">  │  Cost: </Text>
        <Cost costUsd={stage.costUsd} />
      </Box>

      {stage.status === 'failed' && stage.error && (
        <Box paddingY={1} paddingX={1} borderStyle="single" borderColor="red">
          <Text color="red">Error: </Text>
          <Text color="red" wrap="wrap">{stage.error}</Text>
        </Box>
      )}

      {/* Active Slots */}
      <Box flexDirection="column" paddingY={1}>
        <Text color="gray" dimColor>
          Active Slots:
        </Text>
        <Text> </Text>
        {stage.slots.length > 0 ? (
          stage.slots.map((slot, index) => (
            <SlotRow
              key={slot.index}
              slot={slot}
              isSelected={index === selectedSlotIndex}
            />
          ))
        ) : (
          <Text color="gray">  No parallel slots (sequential processing)</Text>
        )}
      </Box>

      {/* Recent Completions */}
      <Box flexDirection="column" paddingY={1} borderStyle="single" borderColor="gray" borderTop borderBottom={false} borderLeft={false} borderRight={false}>
        <Text color="gray" dimColor>
          Recent Completions:
        </Text>
        <Box paddingTop={1}>
          <RecentCompletions completions={recentCompletions} />
        </Box>
      </Box>
    </Box>
  );
}
