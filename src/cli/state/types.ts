/**
 * CLI State Types
 *
 * TypeScript interfaces for the CLI state management.
 */

import type { StageStatus, SlotStatus } from '../../lib/events/types';

// =============================================================================
// App Mode
// =============================================================================

export type AppMode = 'menu' | 'scripts' | 'history' | 'settings' | 'pipeline';

// =============================================================================
// Menu State
// =============================================================================

export interface MenuState {
  /** Selected menu item index (0-3) */
  selectedIndex: number;
}

// =============================================================================
// Script State
// =============================================================================

export interface ScriptInfo {
  /** Script file name */
  name: string;
  /** Script description (from comment) */
  description: string;
  /** Script category: 'long' | 'fast' | 'normal' */
  category: 'long' | 'fast' | 'normal';
  /** Full path to script */
  path: string;
}

export interface ScriptState {
  /** Available scripts */
  scripts: ScriptInfo[];
  /** Selected script index */
  selectedIndex: number;
  /** Running script name (if any) */
  runningScript: string | null;
  /** Script output lines */
  output: string[];
  /** Script exit code (null if running or not started) */
  exitCode: number | null;
  /** Show confirmation dialog */
  showConfirmation: boolean;
  /** Script pending confirmation */
  pendingScript: ScriptInfo | null;
}

// =============================================================================
// History State
// =============================================================================

export interface PipelineRun {
  /** Dataset name */
  dataset: string;
  /** Run timestamp */
  timestamp: Date;
  /** Run directory path */
  path: string;
  /** Duration in ms */
  durationMs: number;
  /** Total cost in USD */
  costUsd: number;
  /** Number of tables */
  tableCount: number;
  /** Status: completed, failed */
  status: 'completed' | 'failed';
  /** Error message (if failed) */
  error?: string;
}

export interface HistoryArtifact {
  /** Artifact name (folder or file) */
  name: string;
  /** Full path */
  path: string;
  /** Is directory */
  isDirectory: boolean;
  /** Description */
  description: string;
}

export type HistoryLevel = 'datasets' | 'runs' | 'artifacts' | 'viewer';

export interface HistoryState {
  /** Current drill-down level */
  level: HistoryLevel;
  /** Available datasets */
  datasets: string[];
  /** Selected dataset index */
  selectedDatasetIndex: number;
  /** Runs for selected dataset */
  runs: PipelineRun[];
  /** Selected run index */
  selectedRunIndex: number;
  /** Artifacts for selected run */
  artifacts: HistoryArtifact[];
  /** Selected artifact index */
  selectedArtifactIndex: number;
  /** File content being viewed */
  viewerContent: string | null;
  /** Viewer scroll offset */
  viewerScrollOffset: number;
}

// =============================================================================
// Slot State
// =============================================================================

export interface SlotState {
  /** Slot index (0, 1, 2) */
  index: number;
  /** Current status */
  status: SlotStatus;
  /** Table ID being processed (if running) */
  tableId: string | null;
  /** Latest log entry */
  latestLog: string | null;
  /** Start time (for duration calculation) */
  startTime: number | null;
}

// =============================================================================
// Stage State
// =============================================================================

export interface StageState {
  /** Stage number (1-10) */
  number: number;
  /** Stage name */
  name: string;
  /** Current status */
  status: StageStatus;
  /** Duration in ms (set when completed) */
  durationMs: number | null;
  /** Cost in USD (set when completed) */
  costUsd: number | null;
  /** Error message (if failed) */
  error: string | null;
  /** Start time */
  startTime: number | null;
  /** Progress info (for agents with parallel processing) */
  progress: {
    completed: number;
    total: number;
  } | null;
  /** Parallel slots (for VerificationAgent) */
  slots: SlotState[];
}

// =============================================================================
// Log Entry
// =============================================================================

export interface LogEntry {
  /** Timestamp */
  timestamp: number;
  /** Agent or stage name */
  source: string;
  /** Table ID (if applicable) */
  tableId: string | null;
  /** Action type (add, review, etc.) */
  action: string;
  /** Log content */
  content: string;
}

// =============================================================================
// Completed Table
// =============================================================================

export interface CompletedTable {
  /** Table ID */
  tableId: string;
  /** Duration in ms */
  durationMs: number;
  /** Completion timestamp */
  timestamp: number;
}

// =============================================================================
// Pipeline State
// =============================================================================

export interface PipelineState {
  /** Active pipeline identity for event filtering */
  activePipelineId: string | null;
  activeRunId: string | null;
  /** Dataset name */
  dataset: string;
  /** Output directory */
  outputDir: string;
  /** Total number of stages */
  totalStages: number;
  /** Pipeline status */
  status: 'idle' | 'running' | 'completed' | 'failed';
  /** Pipeline start time */
  startTime: number | null;
  /** Pipeline end time */
  endTime: number | null;
  /** Total cost in USD */
  totalCostUsd: number;
  /** Total table count */
  tableCount: number;
  /** Error message (if failed) */
  error: string | null;
  /** Failed stage (if failed) */
  failedStage: number | null;
  /** All stages */
  stages: StageState[];
  /** Recent log entries (limited buffer) */
  recentLogs: LogEntry[];
  /** Logs per table ID (for drill-down view) */
  logsByTable: Map<string, LogEntry[]>;
  /** Recently completed tables (for display) */
  recentCompletions: CompletedTable[];
  /** System logs (pipeline + agent console output) */
  systemLogs: LogEntry[];
}

// =============================================================================
// Navigation State
// =============================================================================

export type ViewLevel = 'pipeline' | 'stage' | 'log' | 'system';

export interface NavigationState {
  /** Current view level */
  level: ViewLevel;
  /** Selected stage index (0-based) */
  selectedStage: number;
  /** Selected slot index (0-based, for stage view) */
  selectedSlot: number;
  /** Selected table ID (for log view) */
  selectedTableId: string | null;
  /** Log scroll position */
  logScrollOffset: number;
  /** System log scroll position */
  systemLogScrollOffset: number;
  /** Return level when exiting system logs */
  systemLogReturnLevel: ViewLevel;
}

// =============================================================================
// Settings State
// =============================================================================

export interface AgentModelConfig {
  /** Agent name */
  agent: string;
  /** Model name */
  model: string;
  /** Token limit */
  tokenLimit: number;
  /** Reasoning effort */
  reasoningEffort: string;
  /** Prompt version */
  promptVersion: string;
}

export interface SettingsState {
  /** Agent model configurations */
  agents: AgentModelConfig[];
  /** Stat testing config display */
  statTesting: {
    thresholds: number[];
    proportionTest: string;
    meanTest: string;
    minBase: number;
  };
  /** Selected section index */
  selectedIndex: number;
}

// =============================================================================
// Combined State
// =============================================================================

export interface AppState {
  /** Current app mode */
  mode: AppMode;
  /** Menu state */
  menu: MenuState;
  /** Script runner state */
  scripts: ScriptState;
  /** History browser state */
  history: HistoryState;
  /** Settings view state */
  settings: SettingsState;
  /** Pipeline state (existing) */
  pipeline: PipelineState;
  /** Navigation state (for pipeline view) */
  navigation: NavigationState;
}

// =============================================================================
// Initial State Factory
// =============================================================================

import { STAGE_NAMES, TOTAL_STAGES } from '../../lib/events/types';

export function createInitialPipelineState(): PipelineState {
  const stages: StageState[] = [];
  for (let i = 1; i <= TOTAL_STAGES; i++) {
    stages.push({
      number: i,
      name: STAGE_NAMES[i],
      status: 'pending',
      durationMs: null,
      costUsd: null,
      error: null,
      startTime: null,
      progress: null,
      slots: [],
    });
  }

  return {
    activePipelineId: null,
    activeRunId: null,
    dataset: '',
    outputDir: '',
    totalStages: TOTAL_STAGES,
    status: 'idle',
    startTime: null,
    endTime: null,
    totalCostUsd: 0,
    tableCount: 0,
    error: null,
    failedStage: null,
    stages,
    recentLogs: [],
    logsByTable: new Map(),
    recentCompletions: [],
    systemLogs: [],
  };
}

export function createInitialNavigationState(): NavigationState {
  return {
    level: 'pipeline',
    selectedStage: 0,
    selectedSlot: 0,
    selectedTableId: null,
    logScrollOffset: 0,
    systemLogScrollOffset: 0,
    systemLogReturnLevel: 'pipeline',
  };
}

export function createInitialMenuState(): MenuState {
  return {
    selectedIndex: 0,
  };
}

export function createInitialScriptState(): ScriptState {
  return {
    scripts: [],
    selectedIndex: 0,
    runningScript: null,
    output: [],
    exitCode: null,
    showConfirmation: false,
    pendingScript: null,
  };
}

export function createInitialHistoryState(): HistoryState {
  return {
    level: 'runs',
    datasets: [],
    selectedDatasetIndex: 0,
    runs: [],
    selectedRunIndex: 0,
    artifacts: [],
    selectedArtifactIndex: 0,
    viewerContent: null,
    viewerScrollOffset: 0,
  };
}

export function createInitialSettingsState(): SettingsState {
  return {
    agents: [],
    statTesting: {
      thresholds: [],
      proportionTest: '',
      meanTest: '',
      minBase: 0,
    },
    selectedIndex: 0,
  };
}

export function createInitialAppState(): AppState {
  return {
    mode: 'menu',
    menu: createInitialMenuState(),
    scripts: createInitialScriptState(),
    history: createInitialHistoryState(),
    settings: createInitialSettingsState(),
    pipeline: createInitialPipelineState(),
    navigation: createInitialNavigationState(),
  };
}
