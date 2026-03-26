/**
 * Log View Component (L2)
 *
 * Shows streaming log entries for a specific table.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Header } from './shared';
import type { LogEntry } from '../state/types';

// =============================================================================
// Log Entry Row
// =============================================================================

interface LogEntryRowProps {
  entry: LogEntry;
}

function LogEntryRow({ entry }: LogEntryRowProps): React.ReactElement {
  const time = new Date(entry.timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  // Add milliseconds
  const ms = (entry.timestamp % 1000).toString().padStart(3, '0');
  const timeStr = `${time}.${ms}`;

  const actionColorMap: Record<string, string> = {
    add: 'green',
    review: 'yellow',
    info: 'cyan',
    warn: 'yellow',
    error: 'red',
    debug: 'gray',
  };
  const actionColor = actionColorMap[entry.action] || 'yellow';

  return (
    <Box>
      <Text color="gray">{timeStr}  </Text>
      <Text color={actionColor}>[{entry.action}]</Text>
      <Text> </Text>
      {entry.source && (
        <>
          <Text color="gray">{entry.source}</Text>
          <Text color="gray">: </Text>
        </>
      )}
      <Text wrap="wrap">{entry.content}</Text>
    </Box>
  );
}

// =============================================================================
// Log View
// =============================================================================

interface LogViewProps {
  tableId?: string;
  agentName?: string;
  logs: LogEntry[];
  scrollOffset: number;
  maxVisible?: number;
  title?: string;
  subtitle?: string;
}

export function LogView({
  tableId,
  agentName,
  logs,
  scrollOffset,
  maxVisible = 15,
  title,
  subtitle,
}: LogViewProps): React.ReactElement {
  // Logs are stored newest-first, but we want to display oldest-first
  const sortedLogs = [...logs].reverse();

  // Apply scroll offset
  const startIndex = Math.max(0, sortedLogs.length - maxVisible - scrollOffset);
  const endIndex = Math.min(sortedLogs.length, startIndex + maxVisible);
  const visibleLogs = sortedLogs.slice(startIndex, endIndex);

  // Check if we're at the bottom (streaming new content)
  const isAtBottom = scrollOffset === 0;

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Header
        title={title || `${tableId || 'Logs'} Log`}
        subtitle={subtitle || agentName}
        showBack
      />

      {/* Log Content */}
      <Box flexDirection="column" paddingY={1} paddingX={1} borderStyle="single" borderColor="gray">
        {visibleLogs.length === 0 ? (
          <Text color="gray">No log entries yet...</Text>
        ) : (
          visibleLogs.map((entry, index) => (
            <LogEntryRow key={`${entry.timestamp}-${index}`} entry={entry} />
          ))
        )}

        {/* Streaming indicator */}
        {isAtBottom && (
          <Box marginTop={1}>
            <Text color="yellow">▼ (streaming...)</Text>
          </Box>
        )}
      </Box>
    </Box>
  );
}
