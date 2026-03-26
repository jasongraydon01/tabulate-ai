/**
 * CLI State Reducer
 *
 * Handles state updates from pipeline events and navigation actions.
 */

import type {
  AppState,
  AppMode,
  PipelineState,
  NavigationState,
  SlotState,
  LogEntry,
  MenuState,
  ScriptState,
  ScriptInfo,
  HistoryState,
  PipelineRun,
  HistoryArtifact,
  SettingsState,
  AgentModelConfig,
} from './types';
import { createInitialPipelineState } from './types';
import type { PipelineEvent } from '../../lib/events/types';

// =============================================================================
// Constants
// =============================================================================

const MAX_RECENT_LOGS = 100;
const MAX_LOGS_PER_TABLE = 50;
const MAX_RECENT_COMPLETIONS = 10;
const DEFAULT_CONCURRENCY = 3;
const MAX_SYSTEM_LOGS = 300;

// =============================================================================
// Action Types
// =============================================================================

export type NavigationAction =
  | { type: 'nav:up' }
  | { type: 'nav:down' }
  | { type: 'nav:enter' }
  | { type: 'nav:back' }
  | { type: 'nav:scroll-up' }
  | { type: 'nav:scroll-down' }
  | { type: 'nav:logs' }
  | { type: 'nav:number'; number: number };

export type ModeAction =
  | { type: 'mode:set'; mode: AppMode }
  | { type: 'mode:back' };

export type MenuAction =
  | { type: 'menu:select'; index: number };

export type ScriptAction =
  | { type: 'scripts:load'; scripts: ScriptInfo[] }
  | { type: 'scripts:select'; index: number }
  | { type: 'scripts:confirm'; script: ScriptInfo }
  | { type: 'scripts:cancel' }
  | { type: 'scripts:start'; scriptName: string }
  | { type: 'scripts:output'; line: string }
  | { type: 'scripts:complete'; exitCode: number };

export type HistoryAction =
  | { type: 'history:load-datasets'; datasets: string[] }
  | { type: 'history:load-runs'; runs: PipelineRun[] }
  | { type: 'history:load-artifacts'; artifacts: HistoryArtifact[] }
  | { type: 'history:select-dataset'; index: number }
  | { type: 'history:select-run'; index: number }
  | { type: 'history:select-artifact'; index: number }
  | { type: 'history:view-content'; content: string }
  | { type: 'history:drill-down' }
  | { type: 'history:drill-up' };

export type SettingsAction =
  | { type: 'settings:load'; agents: AgentModelConfig[]; statTesting: SettingsState['statTesting'] }
  | { type: 'settings:select'; index: number };

export type PipelineAction = { type: 'event'; event: PipelineEvent };

export type AppAction =
  | NavigationAction
  | ModeAction
  | MenuAction
  | ScriptAction
  | HistoryAction
  | SettingsAction
  | PipelineAction;

// =============================================================================
// Pipeline State Reducer
// =============================================================================

function pipelineReducer(state: PipelineState, event: PipelineEvent): PipelineState {
  const hasActiveIdentity = !!state.activePipelineId && !!state.activeRunId;
  const isForeignEvent = hasActiveIdentity
    && (event.pipelineId !== state.activePipelineId || event.runId !== state.activeRunId);

  switch (event.type) {
    case 'pipeline:start': {
      if (state.status === 'running' && isForeignEvent) {
        return state;
      }
      return {
        ...createInitialPipelineState(),
        activePipelineId: event.pipelineId,
        activeRunId: event.runId,
        dataset: event.dataset,
        outputDir: event.outputDir,
        totalStages: event.totalStages,
        status: 'running',
        startTime: event.timestamp,
      };
    }

    case 'pipeline:complete': {
      if (isForeignEvent) return state;
      return {
        ...state,
        status: 'completed',
        endTime: event.timestamp,
        totalCostUsd: event.totalCostUsd,
        tableCount: event.tableCount,
      };
    }

    case 'pipeline:failed': {
      if (isForeignEvent) return state;
      return {
        ...state,
        status: 'failed',
        error: event.error,
        failedStage: event.failedStage ?? null,
        endTime: event.timestamp,
      };
    }

    case 'stage:start': {
      if (isForeignEvent) return state;
      const stages = [...state.stages];
      const stageIndex = event.stageNumber - 1;
      if (stageIndex >= 0 && stageIndex < stages.length) {
        stages[stageIndex] = {
          ...stages[stageIndex],
          status: 'running',
          startTime: event.timestamp,
          // Initialize slots for parallel agents
          slots: isParallelAgent(event.name)
            ? createInitialSlots(DEFAULT_CONCURRENCY)
            : [],
        };
      }
      return { ...state, stages };
    }

    case 'stage:complete': {
      if (isForeignEvent) return state;
      const stages = [...state.stages];
      const stageIndex = event.stageNumber - 1;
      if (stageIndex >= 0 && stageIndex < stages.length) {
        stages[stageIndex] = {
          ...stages[stageIndex],
          status: 'completed',
          durationMs: event.durationMs,
          costUsd: event.costUsd ?? null,
        };
      }
      return { ...state, stages };
    }

    case 'stage:failed': {
      if (isForeignEvent) return state;
      const stages = [...state.stages];
      const stageIndex = event.stageNumber - 1;
      if (stageIndex >= 0 && stageIndex < stages.length) {
        stages[stageIndex] = {
          ...stages[stageIndex],
          status: 'failed',
          error: event.error,
        };
      }
      return { ...state, stages };
    }

    case 'agent:progress': {
      if (isForeignEvent) return state;
      const stages = [...state.stages];
      const stageIndex = getStageIndexForAgent(event.agentName);
      if (stageIndex >= 0 && stageIndex < stages.length) {
        stages[stageIndex] = {
          ...stages[stageIndex],
          progress: {
            completed: event.completed,
            total: event.total,
          },
        };
      }
      const tableCount =
        event.agentName === 'VerificationAgent'
          ? Math.max(state.tableCount, event.completed)
          : state.tableCount;
      return { ...state, stages, tableCount };
    }

    case 'slot:start': {
      if (isForeignEvent) return state;
      const stages = [...state.stages];
      const stageIndex = getStageIndexForAgent(event.agentName);
      if (stageIndex >= 0 && stageIndex < stages.length) {
        const slots = [...stages[stageIndex].slots];
        if (event.slotIndex >= 0 && event.slotIndex < slots.length) {
          slots[event.slotIndex] = {
            ...slots[event.slotIndex],
            status: 'running',
            tableId: event.tableId,
            startTime: event.timestamp,
            latestLog: null,
          };
          stages[stageIndex] = { ...stages[stageIndex], slots };
        }
      }
      return { ...state, stages };
    }

    case 'slot:log': {
      if (isForeignEvent) return state;
      // Add to recent logs
      const logEntry: LogEntry = {
        timestamp: event.timestamp,
        source: event.agentName,
        tableId: event.tableId,
        action: event.action,
        content: event.content,
      };

      const recentLogs = [logEntry, ...state.recentLogs].slice(0, MAX_RECENT_LOGS);

      // Add to per-table logs
      const logsByTable = new Map(state.logsByTable);
      const tableLogs = logsByTable.get(event.tableId) || [];
      logsByTable.set(
        event.tableId,
        [logEntry, ...tableLogs].slice(0, MAX_LOGS_PER_TABLE)
      );

      // Update slot with latest log
      const stages = [...state.stages];
      const stageIndex = getStageIndexForAgent(event.agentName);
      if (stageIndex >= 0 && stageIndex < stages.length) {
        const slots = [...stages[stageIndex].slots];
        // Find slot by tableId
        const slotIndex = slots.findIndex((s) => s.tableId === event.tableId);
        if (slotIndex >= 0) {
          slots[slotIndex] = {
            ...slots[slotIndex],
            latestLog: event.content.substring(0, 60) + (event.content.length > 60 ? '...' : ''),
          };
          stages[stageIndex] = { ...stages[stageIndex], slots };
        }
      }

      return { ...state, stages, recentLogs, logsByTable };
    }

    case 'slot:complete': {
      if (isForeignEvent) return state;
      const stages = [...state.stages];
      const stageIndex = getStageIndexForAgent(event.agentName);
      if (stageIndex >= 0 && stageIndex < stages.length) {
        const slots = [...stages[stageIndex].slots];
        if (event.slotIndex >= 0 && event.slotIndex < slots.length) {
          slots[event.slotIndex] = {
            ...slots[event.slotIndex],
            status: 'idle',
            tableId: null,
            latestLog: null,
            startTime: null,
          };
          stages[stageIndex] = { ...stages[stageIndex], slots };
        }
      }

      // Add to recent completions
      const recentCompletions = [
        { tableId: event.tableId, durationMs: event.durationMs, timestamp: event.timestamp },
        ...state.recentCompletions,
      ].slice(0, MAX_RECENT_COMPLETIONS);

      return { ...state, stages, recentCompletions };
    }

    case 'cost:update': {
      if (isForeignEvent) return state;
      return {
        ...state,
        totalCostUsd: event.totalCostUsd,
      };
    }

    case 'system:log': {
      if (isForeignEvent) return state;
      const logEntry: LogEntry = {
        timestamp: event.timestamp,
        source: event.stageName || '',
        tableId: null,
        action: event.level,
        content: event.message,
      };

      const systemLogs = [logEntry, ...state.systemLogs].slice(0, MAX_SYSTEM_LOGS);

      return { ...state, systemLogs };
    }

    default:
      return state;
  }
}

// =============================================================================
// Navigation State Reducer
// =============================================================================

function navigationReducer(
  state: NavigationState,
  action: NavigationAction,
  pipelineState: PipelineState
): NavigationState {
  switch (action.type) {
    case 'nav:up': {
      if (state.level === 'pipeline') {
        return {
          ...state,
          selectedStage: Math.max(0, state.selectedStage - 1),
        };
      }
      if (state.level === 'stage') {
        return {
          ...state,
          selectedSlot: Math.max(0, state.selectedSlot - 1),
        };
      }
      if (state.level === 'log') {
        return {
          ...state,
          logScrollOffset: Math.max(0, state.logScrollOffset - 1),
        };
      }
      if (state.level === 'system') {
        return {
          ...state,
          systemLogScrollOffset: Math.max(0, state.systemLogScrollOffset - 1),
        };
      }
      return state;
    }

    case 'nav:down': {
      if (state.level === 'pipeline') {
        return {
          ...state,
          selectedStage: Math.min(pipelineState.stages.length - 1, state.selectedStage + 1),
        };
      }
      if (state.level === 'stage') {
        const stage = pipelineState.stages[state.selectedStage];
        const maxSlot = (stage?.slots.length || 1) - 1;
        return {
          ...state,
          selectedSlot: Math.min(maxSlot, state.selectedSlot + 1),
        };
      }
      if (state.level === 'log') {
        return {
          ...state,
          logScrollOffset: state.logScrollOffset + 1,
        };
      }
      if (state.level === 'system') {
        return {
          ...state,
          systemLogScrollOffset: state.systemLogScrollOffset + 1,
        };
      }
      return state;
    }

    case 'nav:enter': {
      if (state.level === 'pipeline') {
        const stage = pipelineState.stages[state.selectedStage];
        // Only drill into parallel agent stages
        if (stage && stage.slots.length > 0) {
          return {
            ...state,
            level: 'stage',
            selectedSlot: 0,
          };
        }
      }
      if (state.level === 'stage') {
        const stage = pipelineState.stages[state.selectedStage];
        const slot = stage?.slots[state.selectedSlot];
        if (slot?.tableId) {
          return {
            ...state,
            level: 'log',
            selectedTableId: slot.tableId,
            logScrollOffset: 0,
          };
        }
      }
      return state;
    }

    case 'nav:back': {
      if (state.level === 'log') {
        return {
          ...state,
          level: 'stage',
          selectedTableId: null,
          logScrollOffset: 0,
        };
      }
      if (state.level === 'system') {
        return {
          ...state,
          level: state.systemLogReturnLevel,
        };
      }
      if (state.level === 'stage') {
        return {
          ...state,
          level: 'pipeline',
          selectedSlot: 0,
        };
      }
      return state;
    }

    case 'nav:scroll-up': {
      return {
        ...state,
        logScrollOffset: state.level === 'log' ? Math.max(0, state.logScrollOffset - 5) : state.logScrollOffset,
        systemLogScrollOffset: state.level === 'system'
          ? Math.max(0, state.systemLogScrollOffset - 5)
          : state.systemLogScrollOffset,
      };
    }

    case 'nav:scroll-down': {
      return {
        ...state,
        logScrollOffset: state.level === 'log' ? state.logScrollOffset + 5 : state.logScrollOffset,
        systemLogScrollOffset: state.level === 'system'
          ? state.systemLogScrollOffset + 5
          : state.systemLogScrollOffset,
      };
    }

    case 'nav:logs': {
      if (state.level !== 'system') {
        return {
          ...state,
          level: 'system',
          systemLogReturnLevel: state.level,
          systemLogScrollOffset: 0,
        };
      }
      return {
        ...state,
        level: state.systemLogReturnLevel || 'pipeline',
      };
    }

    default:
      return state;
  }
}

// =============================================================================
// Menu State Reducer
// =============================================================================

function menuReducer(state: MenuState, action: MenuAction): MenuState {
  switch (action.type) {
    case 'menu:select':
      return { ...state, selectedIndex: Math.max(0, Math.min(3, action.index)) };
    default:
      return state;
  }
}

// =============================================================================
// Script State Reducer
// =============================================================================

function scriptReducer(state: ScriptState, action: ScriptAction): ScriptState {
  switch (action.type) {
    case 'scripts:load':
      return { ...state, scripts: action.scripts, selectedIndex: 0 };
    case 'scripts:select':
      return { ...state, selectedIndex: Math.max(0, Math.min(state.scripts.length - 1, action.index)) };
    case 'scripts:confirm':
      return { ...state, showConfirmation: true, pendingScript: action.script };
    case 'scripts:cancel':
      return { ...state, showConfirmation: false, pendingScript: null };
    case 'scripts:start':
      return { ...state, runningScript: action.scriptName, output: [], exitCode: null, showConfirmation: false, pendingScript: null };
    case 'scripts:output':
      return { ...state, output: [...state.output, action.line].slice(-500) }; // Keep last 500 lines
    case 'scripts:complete':
      return { ...state, runningScript: null, exitCode: action.exitCode };
    default:
      return state;
  }
}

// =============================================================================
// History State Reducer
// =============================================================================

function historyReducer(state: HistoryState, action: HistoryAction): HistoryState {
  switch (action.type) {
    case 'history:load-datasets':
      return { ...state, datasets: action.datasets, selectedDatasetIndex: 0 };
    case 'history:load-runs':
      return { ...state, runs: action.runs, selectedRunIndex: 0 };
    case 'history:load-artifacts':
      return { ...state, artifacts: action.artifacts, selectedArtifactIndex: 0 };
    case 'history:select-dataset':
      return { ...state, selectedDatasetIndex: Math.max(0, Math.min(state.datasets.length - 1, action.index)) };
    case 'history:select-run':
      return { ...state, selectedRunIndex: Math.max(0, Math.min(state.runs.length - 1, action.index)) };
    case 'history:select-artifact':
      return { ...state, selectedArtifactIndex: Math.max(0, Math.min(state.artifacts.length - 1, action.index)) };
    case 'history:view-content':
      return { ...state, level: 'viewer', viewerContent: action.content, viewerScrollOffset: 0 };
    case 'history:drill-down':
      if (state.level === 'datasets') {
        return { ...state, level: 'runs' };
      } else if (state.level === 'runs') {
        return { ...state, level: 'artifacts' };
      }
      return state;
    case 'history:drill-up':
      if (state.level === 'viewer') {
        return { ...state, level: 'artifacts', viewerContent: null, viewerScrollOffset: 0 };
      } else if (state.level === 'artifacts') {
        return { ...state, level: 'runs' };
      } else if (state.level === 'runs') {
        return { ...state, level: 'datasets' };
      }
      return state;
    default:
      return state;
  }
}

// =============================================================================
// Settings State Reducer
// =============================================================================

function settingsReducer(state: SettingsState, action: SettingsAction): SettingsState {
  switch (action.type) {
    case 'settings:load':
      return { ...state, agents: action.agents, statTesting: action.statTesting };
    case 'settings:select':
      return { ...state, selectedIndex: action.index };
    default:
      return state;
  }
}

// =============================================================================
// Combined Reducer
// =============================================================================

export function appReducer(state: AppState, action: AppAction): AppState {
  // Mode actions
  if (action.type === 'mode:set') {
    return { ...state, mode: action.mode };
  }
  if (action.type === 'mode:back') {
    // Go back to menu from any mode
    if (state.mode !== 'menu' && state.mode !== 'pipeline') {
      return { ...state, mode: 'menu' };
    }
    return state;
  }

  // Pipeline events
  if (action.type === 'event') {
    return {
      ...state,
      pipeline: pipelineReducer(state.pipeline, action.event),
    };
  }

  // Menu actions
  if (action.type === 'menu:select') {
    return { ...state, menu: menuReducer(state.menu, action) };
  }

  // Script actions
  if (action.type.startsWith('scripts:')) {
    return { ...state, scripts: scriptReducer(state.scripts, action as ScriptAction) };
  }

  // History actions
  if (action.type.startsWith('history:')) {
    return { ...state, history: historyReducer(state.history, action as HistoryAction) };
  }

  // Settings actions
  if (action.type.startsWith('settings:')) {
    return { ...state, settings: settingsReducer(state.settings, action as SettingsAction) };
  }

  // Navigation actions (for pipeline view and general navigation)
  if (action.type.startsWith('nav:')) {
    // Handle mode-specific navigation
    if (state.mode === 'menu') {
      return handleMenuNavigation(state, action as NavigationAction);
    }
    if (state.mode === 'scripts') {
      return handleScriptsNavigation(state, action as NavigationAction);
    }
    if (state.mode === 'history') {
      return handleHistoryNavigation(state, action as NavigationAction);
    }
    if (state.mode === 'settings') {
      return handleSettingsNavigation(state, action as NavigationAction);
    }
    if (state.mode === 'pipeline') {
      return {
        ...state,
        navigation: navigationReducer(state.navigation, action as NavigationAction, state.pipeline),
      };
    }
  }

  return state;
}

// =============================================================================
// Mode-Specific Navigation Handlers
// =============================================================================

function handleMenuNavigation(state: AppState, action: NavigationAction): AppState {
  switch (action.type) {
    case 'nav:up':
      return {
        ...state,
        menu: { ...state.menu, selectedIndex: Math.max(0, state.menu.selectedIndex - 1) },
      };
    case 'nav:down':
      return {
        ...state,
        menu: { ...state.menu, selectedIndex: Math.min(3, state.menu.selectedIndex + 1) },
      };
    case 'nav:enter':
      // Mode switch is handled by the component that knows which mode to go to
      return state;
    case 'nav:number':
      if (action.number >= 1 && action.number <= 4) {
        return {
          ...state,
          menu: { ...state.menu, selectedIndex: action.number - 1 },
        };
      }
      return state;
    default:
      return state;
  }
}

function handleScriptsNavigation(state: AppState, action: NavigationAction): AppState {
  // Don't navigate if a script is running or confirmation is showing
  if (state.scripts.runningScript || state.scripts.showConfirmation) {
    return state;
  }

  switch (action.type) {
    case 'nav:up':
      return {
        ...state,
        scripts: {
          ...state.scripts,
          selectedIndex: Math.max(0, state.scripts.selectedIndex - 1),
        },
      };
    case 'nav:down':
      return {
        ...state,
        scripts: {
          ...state.scripts,
          selectedIndex: Math.min(state.scripts.scripts.length - 1, state.scripts.selectedIndex + 1),
        },
      };
    case 'nav:back':
      return { ...state, mode: 'menu' };
    default:
      return state;
  }
}

function handleHistoryNavigation(state: AppState, action: NavigationAction): AppState {
  const { history } = state;

  switch (action.type) {
    case 'nav:up':
      if (history.level === 'viewer') {
        return {
          ...state,
          history: {
            ...history,
            viewerScrollOffset: Math.max(0, history.viewerScrollOffset - 1),
          },
        };
      }
      if (history.level === 'datasets') {
        return {
          ...state,
          history: {
            ...history,
            selectedDatasetIndex: Math.max(0, history.selectedDatasetIndex - 1),
          },
        };
      }
      if (history.level === 'runs') {
        return {
          ...state,
          history: {
            ...history,
            selectedRunIndex: Math.max(0, history.selectedRunIndex - 1),
          },
        };
      }
      if (history.level === 'artifacts') {
        return {
          ...state,
          history: {
            ...history,
            selectedArtifactIndex: Math.max(0, history.selectedArtifactIndex - 1),
          },
        };
      }
      return state;

    case 'nav:down':
      if (history.level === 'viewer') {
        return {
          ...state,
          history: {
            ...history,
            viewerScrollOffset: history.viewerScrollOffset + 1,
          },
        };
      }
      if (history.level === 'datasets') {
        return {
          ...state,
          history: {
            ...history,
            selectedDatasetIndex: Math.min(history.datasets.length - 1, history.selectedDatasetIndex + 1),
          },
        };
      }
      if (history.level === 'runs') {
        return {
          ...state,
          history: {
            ...history,
            selectedRunIndex: Math.min(history.runs.length - 1, history.selectedRunIndex + 1),
          },
        };
      }
      if (history.level === 'artifacts') {
        return {
          ...state,
          history: {
            ...history,
            selectedArtifactIndex: Math.min(history.artifacts.length - 1, history.selectedArtifactIndex + 1),
          },
        };
      }
      return state;

    case 'nav:back':
      if (history.level === 'viewer') {
        return {
          ...state,
          history: { ...history, level: 'artifacts', viewerContent: null, viewerScrollOffset: 0 },
        };
      }
      if (history.level === 'artifacts') {
        return {
          ...state,
          history: { ...history, level: 'runs' },
        };
      }
      if (history.level === 'runs') {
        // Go back to menu
        return { ...state, mode: 'menu' };
      }
      if (history.level === 'datasets') {
        return { ...state, mode: 'menu' };
      }
      return state;

    case 'nav:scroll-up':
      if (history.level === 'viewer') {
        return {
          ...state,
          history: {
            ...history,
            viewerScrollOffset: Math.max(0, history.viewerScrollOffset - 5),
          },
        };
      }
      return state;

    case 'nav:scroll-down':
      if (history.level === 'viewer') {
        return {
          ...state,
          history: {
            ...history,
            viewerScrollOffset: history.viewerScrollOffset + 5,
          },
        };
      }
      return state;

    default:
      return state;
  }
}

function handleSettingsNavigation(state: AppState, action: NavigationAction): AppState {
  switch (action.type) {
    case 'nav:up':
      return {
        ...state,
        settings: {
          ...state.settings,
          selectedIndex: Math.max(0, state.settings.selectedIndex - 1),
        },
      };
    case 'nav:down':
      // Allow scrolling through agents + stat testing section
      const maxIndex = state.settings.agents.length; // agents + 1 for stat testing
      return {
        ...state,
        settings: {
          ...state.settings,
          selectedIndex: Math.min(maxIndex, state.settings.selectedIndex + 1),
        },
      };
    case 'nav:back':
      return { ...state, mode: 'menu' };
    default:
      return state;
  }
}

// =============================================================================
// Helpers
// =============================================================================

function isParallelAgent(stageName: string): boolean {
  return stageName === 'VerificationAgent';
}

function createInitialSlots(count: number): SlotState[] {
  const slots: SlotState[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({
      index: i,
      status: 'idle',
      tableId: null,
      latestLog: null,
      startTime: null,
    });
  }
  return slots;
}

function getStageIndexForAgent(agentName: string): number {
  switch (agentName) {
    case 'BannerAgent':
      return 1; // Stage 2
    case 'CrosstabAgent':
      return 2; // Stage 3
    case 'VerificationAgent':
      return 4; // Stage 5
    default:
      return -1;
  }
}
