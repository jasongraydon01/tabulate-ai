/**
 * Main Menu Component
 *
 * Landing screen for TabulateAI CLI with 4 menu items.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Header, HorizontalRule } from './shared';

// =============================================================================
// Types
// =============================================================================

export interface LastRunInfo {
  timestamp: Date;
  durationMs: number;
  costUsd: number;
  tableCount: number;
}

interface MainMenuProps {
  selectedIndex: number;
  dataset: string;
  lastRun: LastRunInfo | null;
}

// =============================================================================
// Menu Items
// =============================================================================

const MENU_ITEMS = [
  { key: '1', label: 'Run Pipeline', description: 'Run full crosstab pipeline' },
  { key: '2', label: 'Run Script', description: 'Execute test/utility scripts' },
  { key: '3', label: 'Browse History', description: 'Explore previous pipeline runs' },
  { key: '4', label: 'Settings', description: 'View model configuration' },
];

// =============================================================================
// Helper Functions
// =============================================================================

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

function formatCost(cost: number): string {
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  if (cost < 1) return `$${cost.toFixed(3)}`;
  return `$${cost.toFixed(2)}`;
}

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

// =============================================================================
// Components
// =============================================================================

interface MenuItemProps {
  item: typeof MENU_ITEMS[0];
  isSelected: boolean;
}

function MenuItem({ item, isSelected }: MenuItemProps): React.ReactElement {
  return (
    <Box>
      <Text color={isSelected ? 'cyan' : undefined}>
        {isSelected ? '  \u25B6 ' : '    '}
      </Text>
      <Text color={isSelected ? 'cyan' : 'gray'}>[{item.key}]</Text>
      <Text> </Text>
      <Text color={isSelected ? 'white' : undefined} bold={isSelected}>
        {item.label.padEnd(20)}
      </Text>
      <Text color="gray">{item.description}</Text>
    </Box>
  );
}

// =============================================================================
// Main Menu
// =============================================================================

export function MainMenu({ selectedIndex, dataset, lastRun }: MainMenuProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Header title="TabulateAI" />

      {/* Menu Items */}
      <Box flexDirection="column" paddingY={1}>
        {MENU_ITEMS.map((item, index) => (
          <MenuItem key={item.key} item={item} isSelected={index === selectedIndex} />
        ))}
        <Box marginTop={1}>
          <Text color="gray">    </Text>
          <Text color="red">[q]</Text>
          <Text> </Text>
          <Text color="gray">Quit</Text>
        </Box>
      </Box>

      {/* Dataset and Last Run Info */}
      <Box flexDirection="column" paddingTop={1}>
        <Box>
          <Text color="gray">  Dataset: </Text>
          <Text color="cyan">{dataset || 'Not configured'}</Text>
        </Box>
        {lastRun && (
          <Box>
            <Text color="gray">  Last Run: </Text>
            <Text color="yellow">{formatDate(lastRun.timestamp)}</Text>
            <Text color="gray"> (</Text>
            <Text color="cyan">{formatDuration(lastRun.durationMs)}</Text>
            <Text color="gray">, </Text>
            <Text color="green">{formatCost(lastRun.costUsd)}</Text>
            <Text color="gray">, </Text>
            <Text color="yellow">{lastRun.tableCount} tables</Text>
            <Text color="gray">)</Text>
          </Box>
        )}
        {!lastRun && (
          <Box>
            <Text color="gray">  Last Run: </Text>
            <Text color="gray">No previous runs</Text>
          </Box>
        )}
      </Box>

      {/* Key Hints */}
      <Box paddingTop={1}>
        <HorizontalRule />
      </Box>
      <Box paddingX={1}>
        <Text color="cyan">[j/k]</Text>
        <Text color="gray"> select  </Text>
        <Text color="cyan">[Enter]</Text>
        <Text color="gray"> choose  </Text>
        <Text color="cyan">[1-4]</Text>
        <Text color="gray"> quick select  </Text>
        <Text color="cyan">[q]</Text>
        <Text color="gray"> quit</Text>
      </Box>
    </Box>
  );
}
