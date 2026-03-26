/**
 * Settings View Component
 *
 * Displays current model configuration and environment settings.
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Header, HorizontalRule } from './shared';
import type { SettingsState, AgentModelConfig } from '../state/types';

// =============================================================================
// Types
// =============================================================================

interface SettingsViewProps {
  state: SettingsState;
}

// =============================================================================
// Agent Config Row
// =============================================================================

interface AgentConfigRowProps {
  agent: AgentModelConfig;
  isSelected: boolean;
}

function AgentConfigRow({ agent, isSelected }: AgentConfigRowProps): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text color={isSelected ? 'cyan' : undefined}>
          {isSelected ? '\u25B6 ' : '  '}
        </Text>
        <Text color={isSelected ? 'white' : 'yellow'} bold={isSelected}>
          {agent.agent}
        </Text>
      </Box>
      <Box marginLeft={4}>
        <Text color="gray">Model: </Text>
        <Text color="cyan">{agent.model}</Text>
        <Text color="gray">  |  Tokens: </Text>
        <Text>{agent.tokenLimit.toLocaleString()}</Text>
      </Box>
      <Box marginLeft={4}>
        <Text color="gray">Reasoning: </Text>
        <Text color={getReasoningColor(agent.reasoningEffort)}>{agent.reasoningEffort}</Text>
        <Text color="gray">  |  Prompt: </Text>
        <Text color="magenta">{agent.promptVersion}</Text>
      </Box>
    </Box>
  );
}

function getReasoningColor(effort: string): string {
  switch (effort) {
    case 'none':
    case 'minimal':
      return 'gray';
    case 'low':
      return 'green';
    case 'medium':
      return 'yellow';
    case 'high':
      return 'red';
    case 'xhigh':
      return 'magenta';
    default:
      return 'white';
  }
}

// =============================================================================
// Stat Testing Section
// =============================================================================

interface StatTestingSectionProps {
  statTesting: SettingsState['statTesting'];
  isSelected: boolean;
}

function StatTestingSection({ statTesting, isSelected }: StatTestingSectionProps): React.ReactElement {
  // Format confidence levels
  const confidences = statTesting.thresholds.map(t => Math.round((1 - t) * 100));
  const confidenceStr = confidences.length === 1
    ? `${confidences[0]}% (p < ${statTesting.thresholds[0]})`
    : `${confidences.join('%, ')}% (p < ${statTesting.thresholds.join(', ')})`;

  // Format test names
  const proportionTestName = statTesting.proportionTest === 'unpooled_z'
    ? 'Unpooled z-test'
    : 'Pooled z-test';
  const meanTestName = statTesting.meanTest === 'welch_t'
    ? "Welch's t-test"
    : "Student's t-test";

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={isSelected ? 'cyan' : undefined}>
          {isSelected ? '\u25B6 ' : '  '}
        </Text>
        <Text color={isSelected ? 'white' : 'yellow'} bold={isSelected}>
          Statistical Testing
        </Text>
      </Box>
      <Box marginLeft={4} flexDirection="column">
        <Box>
          <Text color="gray">Confidence: </Text>
          <Text color="cyan">{confidenceStr}</Text>
        </Box>
        <Box>
          <Text color="gray">Proportion Test: </Text>
          <Text>{proportionTestName}</Text>
        </Box>
        <Box>
          <Text color="gray">Mean Test: </Text>
          <Text>{meanTestName}</Text>
        </Box>
        <Box>
          <Text color="gray">Min Base: </Text>
          <Text>{statTesting.minBase === 0 ? 'None' : statTesting.minBase}</Text>
        </Box>
      </Box>
    </Box>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function SettingsView({ state }: SettingsViewProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Header title="Settings" subtitle="Model Configuration (Read-only)" />

      <Box flexDirection="column" paddingY={1}>
        {/* Agent Configurations */}
        <Box marginBottom={1}>
          <Text color="gray">  </Text>
          <Text color="white" bold>Agent Models</Text>
        </Box>

        {state.agents.length === 0 ? (
          <Text color="gray">  Loading configuration...</Text>
        ) : (
          state.agents.map((agent, index) => (
            <AgentConfigRow
              key={agent.agent}
              agent={agent}
              isSelected={index === state.selectedIndex}
            />
          ))
        )}

        {/* Stat Testing Section */}
        <Box marginTop={1} marginBottom={1}>
          <Text color="gray">  </Text>
          <Text color="white" bold>Testing Configuration</Text>
        </Box>

        <StatTestingSection
          statTesting={state.statTesting}
          isSelected={state.selectedIndex === state.agents.length}
        />
      </Box>

      {/* Key Hints */}
      <Box paddingTop={1}>
        <HorizontalRule />
      </Box>
      <Box paddingX={1}>
        <Text color="cyan">[j/k]</Text>
        <Text color="gray"> scroll  </Text>
        <Text color="cyan">[Esc]</Text>
        <Text color="gray"> back  </Text>
        <Text color="cyan">[q]</Text>
        <Text color="gray"> quit</Text>
      </Box>

      {/* Note about editing */}
      <Box paddingTop={1} paddingX={1}>
        <Text color="gray" dimColor>
          To change settings, edit .env.local or set environment variables
        </Text>
      </Box>
    </Box>
  );
}
