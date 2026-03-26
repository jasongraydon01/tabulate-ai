/**
 * TabulateAI CLI App
 *
 * Main Ink application component with state management and event handling.
 * Now supports multiple modes: menu, scripts, history, settings, pipeline.
 */

import React, { useReducer, useCallback, useState, useEffect } from 'react';
import { Box } from 'ink';
import * as path from 'path';
import { spawn } from 'child_process';
import {
  PipelineView,
  StageDetail,
  LogView,
  CostBar,
  KeyHints,
  MainMenu,
  ScriptRunner,
  HistoryBrowser,
  SettingsView,
} from './components';
import type { LastRunInfo } from './components';
import { usePipelineEvents, useNavigation, useScriptRunner } from './hooks';
import { appReducer, type AppAction } from './state/reducer';
import { createInitialAppState, type AppMode, type AgentModelConfig } from './state/types';
import type { PipelineEvent } from '../lib/events/types';
import { discoverScripts } from './utils/scripts';
import { discoverRuns, discoverArtifacts, readArtifactContent, getMostRecentRun } from './utils/history';
import {
  getEnvironmentConfig,
  getPromptVersions,
  getStatTestingConfig,
} from '../lib/env';
import { DEFAULT_DATASET } from '../lib/pipeline';

// =============================================================================
// Constants
// =============================================================================

const SCRIPTS_DIR = path.join(process.cwd(), 'scripts');
const OUTPUTS_DIR = path.join(process.cwd(), 'outputs');

// =============================================================================
// App Component
// =============================================================================

interface AppProps {
  onExit: () => void;
  initialMode?: AppMode;
  dataset?: string;
  /** Called when user selects "Run Pipeline" from menu */
  onStartPipeline?: () => void;
  /** Called when App is ready to receive events */
  onReady?: () => void;
}

export function App({ onExit, initialMode = 'menu', dataset, onStartPipeline, onReady }: AppProps): React.ReactElement {
  const [state, dispatch] = useReducer(appReducer, {
    ...createInitialAppState(),
    mode: initialMode,
  });
  const [startTime] = useState(Date.now());
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [lastRun, setLastRun] = useState<LastRunInfo | null>(null);

  const currentDataset = dataset || DEFAULT_DATASET;
  const datasetName = path.basename(currentDataset);

  // Update elapsed time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  // Load last run info for menu
  useEffect(() => {
    const run = getMostRecentRun(OUTPUTS_DIR, datasetName);
    if (run) {
      setLastRun({
        timestamp: run.timestamp,
        durationMs: run.durationMs,
        costUsd: run.costUsd,
        tableCount: run.tableCount,
      });
    }
  }, [datasetName]);

  // Load scripts when entering scripts mode
  useEffect(() => {
    if (state.mode === 'scripts' && state.scripts.scripts.length === 0) {
      const scripts = discoverScripts(SCRIPTS_DIR);
      dispatch({ type: 'scripts:load', scripts });
    }
  }, [state.mode, state.scripts.scripts.length]);

  // Load history when entering history mode
  useEffect(() => {
    if (state.mode === 'history' && state.history.runs.length === 0) {
      const runs = discoverRuns(OUTPUTS_DIR, datasetName);
      dispatch({ type: 'history:load-runs', runs });
    }
  }, [state.mode, state.history.runs.length, datasetName]);

  // Load settings when entering settings mode
  useEffect(() => {
    if (state.mode === 'settings' && state.settings.agents.length === 0) {
      try {
        const config = getEnvironmentConfig();
        const promptVersions = getPromptVersions();
        const statConfig = getStatTestingConfig();

        const agents: AgentModelConfig[] = [
          {
            agent: 'BannerAgent',
            model: config.bannerModel,
            tokenLimit: config.processingLimits.bannerModelTokens,
            reasoningEffort: config.reasoningConfig.bannerReasoningEffort,
            promptVersion: promptVersions.bannerPromptVersion,
          },
          {
            agent: 'CrosstabAgent',
            model: config.crosstabModel,
            tokenLimit: config.processingLimits.crosstabModelTokens,
            reasoningEffort: config.reasoningConfig.crosstabReasoningEffort,
            promptVersion: promptVersions.crosstabPromptVersion,
          },
          {
            agent: 'VerificationAgent',
            model: config.verificationModel,
            tokenLimit: config.processingLimits.verificationModelTokens,
            reasoningEffort: config.reasoningConfig.verificationReasoningEffort,
            promptVersion: promptVersions.verificationPromptVersion,
          },
        ];

        dispatch({
          type: 'settings:load',
          agents,
          statTesting: {
            thresholds: statConfig.thresholds,
            proportionTest: statConfig.proportionTest,
            meanTest: statConfig.meanTest,
            minBase: statConfig.minBase,
          },
        });
      } catch (_error) {
        // Config error - show empty state
      }
    }
  }, [state.mode, state.settings.agents.length]);

  // Handle pipeline events
  const handleEvent = useCallback((event: PipelineEvent) => {
    dispatch({ type: 'event', event } as AppAction);
  }, []);

  const shouldAcceptEvent = useCallback((event: PipelineEvent) => {
    // Always allow pipeline:start so a new run can claim the view.
    if (event.type === 'pipeline:start') return true;

    const { activePipelineId, activeRunId } = state.pipeline;
    if (!activePipelineId || !activeRunId) return false;
    return event.pipelineId === activePipelineId && event.runId === activeRunId;
  }, [state.pipeline]);

  usePipelineEvents({ onEvent: handleEvent, eventFilter: shouldAcceptEvent });

  // Signal that we're ready to receive events (after event bus subscription)
  useEffect(() => {
    if (onReady) {
      onReady();
    }
  }, [onReady]);

  // Script runner
  const scriptRunner = useScriptRunner({
    onOutput: (line) => dispatch({ type: 'scripts:output', line }),
    onComplete: (exitCode) => dispatch({ type: 'scripts:complete', exitCode }),
    onStart: (scriptName) => dispatch({ type: 'scripts:start', scriptName }),
  });

  // Handle navigation actions
  const handleNavAction = useCallback((action: AppAction) => {
    dispatch(action);
  }, []);

  // Handle mode-specific actions
  const handleModeAction = useCallback((action: AppAction) => {
    // Menu selection
    if (state.mode === 'menu' && (action.type === 'nav:enter' || action.type === 'nav:number')) {
      const selectedIndex = action.type === 'nav:number'
        ? action.number - 1
        : state.menu.selectedIndex;

      switch (selectedIndex) {
        case 0: // Run Pipeline
          dispatch({ type: 'mode:set', mode: 'pipeline' });
          if (onStartPipeline) {
            onStartPipeline();
          }
          break;
        case 1: // Run Script
          dispatch({ type: 'mode:set', mode: 'scripts' });
          break;
        case 2: // Browse History
          dispatch({ type: 'mode:set', mode: 'history' });
          break;
        case 3: // Settings
          dispatch({ type: 'mode:set', mode: 'settings' });
          break;
      }
      return;
    }

    // History mode - drill down or open
    if (state.mode === 'history') {
      if (action.type === 'history:drill-down') {
        // This is the 'o' key - open in Finder
        const selectedRun = state.history.runs[state.history.selectedRunIndex];
        if (state.history.level === 'runs' && selectedRun) {
          spawn('open', [selectedRun.path], { detached: true });
        } else if (state.history.level === 'artifacts') {
          const selectedArtifact = state.history.artifacts[state.history.selectedArtifactIndex];
          if (selectedArtifact) {
            spawn('open', [selectedArtifact.path], { detached: true });
          }
        }
      }
    }
  }, [state.mode, state.menu.selectedIndex, state.history, onStartPipeline]);

  // Handle history drill-down on Enter
  const handleHistoryEnter = useCallback(() => {
    if (state.history.level === 'runs') {
      const selectedRun = state.history.runs[state.history.selectedRunIndex];
      if (selectedRun) {
        const artifacts = discoverArtifacts(selectedRun.path);
        dispatch({ type: 'history:load-artifacts', artifacts });
        dispatch({ type: 'history:drill-down' });
      }
    } else if (state.history.level === 'artifacts') {
      const selectedArtifact = state.history.artifacts[state.history.selectedArtifactIndex];
      if (selectedArtifact && !selectedArtifact.isDirectory) {
        const content = readArtifactContent(selectedArtifact.path);
        dispatch({ type: 'history:view-content', content });
      } else if (selectedArtifact?.isDirectory) {
        // Open directory in Finder
        spawn('open', [selectedArtifact.path], { detached: true });
      }
    }
  }, [state.history]);

  // Handle scripts Enter
  const handleScriptsEnter = useCallback(() => {
    const selectedScript = state.scripts.scripts[state.scripts.selectedIndex];
    if (!selectedScript) return;

    if (selectedScript.category === 'long') {
      dispatch({ type: 'scripts:confirm', script: selectedScript });
    } else {
      scriptRunner.run(selectedScript);
    }
  }, [state.scripts, scriptRunner]);

  useNavigation({
    mode: state.mode,
    onAction: (action) => {
      // Intercept Enter in certain modes
      if (action.type === 'nav:enter') {
        if (state.mode === 'history' && state.history.level !== 'viewer') {
          handleHistoryEnter();
          return;
        }
        if (state.mode === 'scripts' && !state.scripts.runningScript && state.scripts.exitCode === null) {
          handleScriptsEnter();
          return;
        }
      }
      handleNavAction(action);
    },
    onQuit: onExit,
    onModeAction: handleModeAction,
  });

  // Calculate elapsed time
  const elapsedMs = state.pipeline.startTime
    ? currentTime - state.pipeline.startTime
    : currentTime - startTime;

  // Get logs for current table (if in log view)
  const currentTableLogs = state.navigation.selectedTableId
    ? state.pipeline.logsByTable.get(state.navigation.selectedTableId) || []
    : [];

  // Get current stage for detail view
  const currentStage = state.pipeline.stages[state.navigation.selectedStage];

  // Determine which agent name to show in log view
  const currentAgentName = currentStage?.name || 'Unknown';
  const stageModelName = (() => {
    const agentName = currentStage?.name;
    if (!agentName) return undefined;
    const fromState = state.settings.agents.find((agent) => agent.agent === agentName)?.model;
    if (fromState) return fromState;
    try {
      const config = getEnvironmentConfig();
      switch (agentName) {
        case 'BannerAgent':
          return config.bannerModel;
        case 'CrosstabAgent':
          return config.crosstabModel;
        case 'VerificationAgent':
          return config.verificationModel;
        default:
          return undefined;
      }
    } catch {
      return undefined;
    }
  })();
  const systemLogs = state.pipeline.systemLogs;

  // Render based on mode
  return (
    <Box flexDirection="column" height="100%">
      {/* Main View Area */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Menu Mode */}
        {state.mode === 'menu' && (
          <MainMenu
            selectedIndex={state.menu.selectedIndex}
            dataset={datasetName}
            lastRun={lastRun}
          />
        )}

        {/* Scripts Mode */}
        {state.mode === 'scripts' && (
          <ScriptRunner
            state={state.scripts}
            dataset={datasetName}
            onRun={(script) => scriptRunner.run(script)}
            onConfirm={() => {
              if (state.scripts.pendingScript) {
                scriptRunner.run(state.scripts.pendingScript);
              }
            }}
            onCancel={() => dispatch({ type: 'scripts:cancel' })}
          />
        )}

        {/* History Mode */}
        {state.mode === 'history' && (
          <HistoryBrowser
            state={state.history}
            currentDataset={datasetName}
            onDrillDown={handleHistoryEnter}
            onOpenInFinder={(p) => spawn('open', [p], { detached: true })}
          />
        )}

        {/* Settings Mode */}
        {state.mode === 'settings' && (
          <SettingsView state={state.settings} />
        )}

        {/* Pipeline Mode */}
        {state.mode === 'pipeline' && (
          <>
            {state.navigation.level === 'pipeline' && (
              <PipelineView
                stages={state.pipeline.stages}
                selectedIndex={state.navigation.selectedStage}
                dataset={state.pipeline.dataset || datasetName}
              />
            )}

            {state.navigation.level === 'stage' && currentStage && (
              <StageDetail
                stage={currentStage}
                selectedSlotIndex={state.navigation.selectedSlot}
                recentCompletions={state.pipeline.recentCompletions}
                modelName={stageModelName}
              />
            )}

            {state.navigation.level === 'log' && state.navigation.selectedTableId && (
              <LogView
                tableId={state.navigation.selectedTableId}
                agentName={currentAgentName}
                logs={currentTableLogs}
                scrollOffset={state.navigation.logScrollOffset}
              />
            )}

            {state.navigation.level === 'system' && (
              <LogView
                title="System Logs"
                subtitle="Pipeline + agent output"
                logs={systemLogs}
                scrollOffset={state.navigation.systemLogScrollOffset}
              />
            )}
          </>
        )}
      </Box>

      {/* Footer - only show for pipeline mode */}
      {state.mode === 'pipeline' && (
        <Box flexDirection="column">
          <CostBar
            totalCostUsd={state.pipeline.totalCostUsd}
            elapsedMs={elapsedMs}
            tableCount={state.pipeline.tableCount}
          />
          <KeyHints level={state.navigation.level} />
        </Box>
      )}
    </Box>
  );
}
