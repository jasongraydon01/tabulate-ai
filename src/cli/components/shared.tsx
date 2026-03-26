/**
 * Shared CLI Components
 *
 * StatusBadge, CostBar, KeyHints, and other reusable components.
 */

import React from 'react';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import type { StageStatus, SlotStatus } from '../../lib/events/types';

// =============================================================================
// Status Badge
// =============================================================================

interface StatusBadgeProps {
  status: StageStatus | SlotStatus;
}

export function StatusBadge({ status }: StatusBadgeProps): React.ReactElement {
  switch (status) {
    case 'completed':
      return <Text color="green">✓</Text>;
    case 'running':
      return (
        <Text color="yellow">
          <Spinner type="dots" />
        </Text>
      );
    case 'failed':
      return <Text color="red">✗</Text>;
    case 'idle':
      return <Text color="gray">○</Text>;
    case 'pending':
    default:
      return <Text color="gray">○</Text>;
  }
}

// =============================================================================
// Progress Bar
// =============================================================================

interface ProgressBarProps {
  completed: number;
  total: number;
  width?: number;
}

export function ProgressBar({ completed, total, width = 20 }: ProgressBarProps): React.ReactElement {
  const percentage = total > 0 ? Math.min(1, completed / total) : 0;
  const filledWidth = Math.round(percentage * width);
  const emptyWidth = width - filledWidth;

  return (
    <Text>
      <Text color="green">{'█'.repeat(filledWidth)}</Text>
      <Text color="gray">{'░'.repeat(emptyWidth)}</Text>
      <Text color="cyan"> {completed}/{total}</Text>
    </Text>
  );
}

// =============================================================================
// Cost Bar (Footer)
// =============================================================================

interface CostBarProps {
  totalCostUsd: number;
  elapsedMs: number;
  tableCount: number;
  cutCount?: number;
}

export function CostBar({ totalCostUsd, elapsedMs, tableCount, cutCount }: CostBarProps): React.ReactElement {
  const formatCost = (cost: number): string => {
    if (cost < 0.01) return `$${cost.toFixed(4)}`;
    if (cost < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatDuration = (ms: number): string => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    if (minutes > 0) {
      return `${minutes}m ${remainingSeconds}s`;
    }
    return `${seconds}s`;
  };

  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1}>
      <Box flexGrow={1}>
        <Text color="green">{formatCost(totalCostUsd)}</Text>
        <Text color="gray">  │  </Text>
        <Text color="cyan">{formatDuration(elapsedMs)}</Text>
        <Text color="gray">  │  </Text>
        <Text color="yellow">{tableCount} tables</Text>
        {cutCount !== undefined && (
          <>
            <Text color="gray">  │  </Text>
            <Text color="magenta">{cutCount} cuts</Text>
          </>
        )}
      </Box>
    </Box>
  );
}

// =============================================================================
// Key Hints
// =============================================================================

interface KeyHintsProps {
  level: 'pipeline' | 'stage' | 'log' | 'system';
}

export function KeyHints({ level }: KeyHintsProps): React.ReactElement {
  const hints = getHintsForLevel(level);

  return (
    <Box paddingX={1}>
      {hints.map((hint, index) => (
        <React.Fragment key={`${hint.key}-${hint.action}`}>
          {index > 0 && <Text color="gray">  </Text>}
          <Text color="cyan">[{hint.key}]</Text>
          <Text color="gray"> {hint.action}</Text>
        </React.Fragment>
      ))}
    </Box>
  );
}

function getHintsForLevel(level: 'pipeline' | 'stage' | 'log' | 'system'): Array<{ key: string; action: string }> {
  const common = [
    { key: 'j/k', action: 'select' },
    { key: 'q', action: 'quit' },
  ];

  switch (level) {
    case 'pipeline':
      return [
        { key: 'j/k', action: 'select' },
        { key: 'Enter', action: 'drill down' },
        { key: 'l', action: 'system logs' },
        { key: 'q', action: 'quit' },
      ];
    case 'stage':
      return [
        { key: 'j/k', action: 'select slot' },
        { key: 'Enter', action: 'view log' },
        { key: 'l', action: 'system logs' },
        { key: 'Esc', action: 'back' },
        { key: 'q', action: 'quit' },
      ];
    case 'log':
      return [
        { key: 'j/k', action: 'scroll' },
        { key: 'l', action: 'system logs' },
        { key: 'Esc', action: 'back' },
        { key: 'q', action: 'quit' },
      ];
    case 'system':
      return [
        { key: 'j/k', action: 'scroll' },
        { key: 'l', action: 'back' },
        { key: 'Esc', action: 'back' },
        { key: 'q', action: 'quit' },
      ];
    default:
      return common;
  }
}

// =============================================================================
// Header
// =============================================================================

interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
}

export function Header({ title, subtitle, showBack }: HeaderProps): React.ReactElement {
  return (
    <Box borderStyle="single" borderColor="magenta" paddingX={1}>
      {showBack && <Text color="gray">◀ [Esc] Back    </Text>}
      <Text color="magenta" bold>
        {title}
      </Text>
      {subtitle && (
        <>
          <Text color="gray">  │  </Text>
          <Text color="cyan">{subtitle}</Text>
        </>
      )}
    </Box>
  );
}

// =============================================================================
// Horizontal Rule
// =============================================================================

interface HorizontalRuleProps {
  width?: number;
  char?: string;
  color?: string;
}

export function HorizontalRule({ width = 70, char = '─', color = 'gray' }: HorizontalRuleProps): React.ReactElement {
  return <Text color={color}>{char.repeat(width)}</Text>;
}

// =============================================================================
// Duration Display
// =============================================================================

interface DurationProps {
  durationMs: number | null;
  showMs?: boolean;
}

export function Duration({ durationMs, showMs }: DurationProps): React.ReactElement {
  if (durationMs === null) {
    return <Text color="gray">-</Text>;
  }

  if (showMs || durationMs < 1000) {
    return <Text color="gray">{durationMs}ms</Text>;
  }

  const seconds = (durationMs / 1000).toFixed(1);
  return <Text color="gray">{seconds}s</Text>;
}

// =============================================================================
// Cost Display
// =============================================================================

interface CostProps {
  costUsd: number | null;
}

export function Cost({ costUsd }: CostProps): React.ReactElement {
  if (costUsd === null || costUsd === 0) {
    return <Text color="gray">$0.00</Text>;
  }

  if (costUsd < 0.01) {
    return <Text color="green">${costUsd.toFixed(4)}</Text>;
  }

  return <Text color="green">${costUsd.toFixed(2)}</Text>;
}
