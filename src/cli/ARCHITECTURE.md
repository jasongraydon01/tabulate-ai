# HawkTab CLI Architecture

> **For AI Agents**: This document describes the internal architecture of the HawkTab CLI. If you modify the CLI, **update this document** to reflect your changes.

## Overview

The CLI is built with [Ink](https://github.com/vadimdemedes/ink) (React for terminal UIs) and follows a Redux-like state management pattern with a single reducer and typed actions.

```
src/cli/
├── index.tsx           # Entry point, CLI argument parsing
├── App.tsx             # Main component, mode routing, effects
├── state/
│   ├── types.ts        # All state interfaces and initial state factories
│   └── reducer.ts      # Combined reducer with all action handlers
├── components/
│   ├── index.ts        # Component exports
│   ├── shared.tsx      # Reusable components (Header, StatusBadge, etc.)
│   ├── MainMenu.tsx    # Landing menu
│   ├── ScriptRunner.tsx # Script execution view
│   ├── HistoryBrowser.tsx # Pipeline history browser
│   ├── SettingsView.tsx # Configuration display
│   ├── PipelineView.tsx # Pipeline stage list (L0)
│   ├── StageDetail.tsx  # Stage drill-down (L1)
│   └── LogView.tsx      # Log viewer (L2)
├── hooks/
│   ├── index.ts        # Hook exports
│   ├── useNavigation.ts # Keyboard input handling
│   ├── usePipelineEvents.ts # Event bus subscription
│   └── useScriptRunner.ts # Script subprocess management
└── utils/
    ├── scripts.ts      # Script discovery
    └── history.ts      # Pipeline run discovery
```

## State Architecture

### AppState Structure

```typescript
interface AppState {
  mode: AppMode;           // Current view mode
  menu: MenuState;         // Menu selection
  scripts: ScriptState;    // Script runner state
  history: HistoryState;   // History browser state
  settings: SettingsState; // Settings display state
  pipeline: PipelineState; // Pipeline execution state
  navigation: NavigationState; // Pipeline view navigation
}
```

### Mode System

The CLI has 5 modes, controlled by `state.mode`:

| Mode | Component | Purpose |
|------|-----------|---------|
| `menu` | `MainMenu` | Landing screen with 4 options |
| `scripts` | `ScriptRunner` | Browse and run test scripts |
| `history` | `HistoryBrowser` | Browse previous pipeline runs |
| `settings` | `SettingsView` | View model configuration |
| `pipeline` | `PipelineView` + drill-down | Live pipeline execution view |

### Action Types

Actions are organized by domain:

```typescript
// Mode switching
type ModeAction =
  | { type: 'mode:set'; mode: AppMode }
  | { type: 'mode:back' };

// Navigation (works across modes)
type NavigationAction =
  | { type: 'nav:up' }
  | { type: 'nav:down' }
  | { type: 'nav:enter' }
  | { type: 'nav:back' }
  | { type: 'nav:scroll-up' }
  | { type: 'nav:scroll-down' }
  | { type: 'nav:number'; number: number };

// Script runner
type ScriptAction =
  | { type: 'scripts:load'; scripts: ScriptInfo[] }
  | { type: 'scripts:select'; index: number }
  | { type: 'scripts:confirm'; script: ScriptInfo }
  | { type: 'scripts:cancel' }
  | { type: 'scripts:start'; scriptName: string }
  | { type: 'scripts:output'; line: string }
  | { type: 'scripts:complete'; exitCode: number };

// History browser
type HistoryAction =
  | { type: 'history:load-runs'; runs: PipelineRun[] }
  | { type: 'history:load-artifacts'; artifacts: HistoryArtifact[] }
  | { type: 'history:select-run'; index: number }
  | { type: 'history:select-artifact'; index: number }
  | { type: 'history:view-content'; content: string }
  | { type: 'history:drill-down' }
  | { type: 'history:drill-up' };

// Settings
type SettingsAction =
  | { type: 'settings:load'; agents: AgentModelConfig[]; statTesting: ... }
  | { type: 'settings:select'; index: number };

// Pipeline events (from event bus)
type PipelineAction = { type: 'event'; event: PipelineEvent };
```

## Navigation Pattern

The `useNavigation` hook handles all keyboard input and dispatches actions based on the current mode.

```typescript
// In useNavigation.ts
useInput((input, key) => {
  if (input === 'q') onQuit();
  if (input === 'k' || key.upArrow) onAction({ type: 'nav:up' });
  if (input === 'j' || key.downArrow) onAction({ type: 'nav:down' });
  if (key.return) onAction({ type: 'nav:enter' });
  if (key.escape) onAction({ type: 'nav:back' });
  // ... number shortcuts for menu mode
});
```

The reducer routes navigation actions to mode-specific handlers:

```typescript
// In reducer.ts
if (action.type.startsWith('nav:')) {
  if (state.mode === 'menu') return handleMenuNavigation(state, action);
  if (state.mode === 'scripts') return handleScriptsNavigation(state, action);
  if (state.mode === 'history') return handleHistoryNavigation(state, action);
  if (state.mode === 'settings') return handleSettingsNavigation(state, action);
  if (state.mode === 'pipeline') return { ...state, navigation: navigationReducer(...) };
}
```

## Data Flow

### Script Execution Flow

```
1. User selects script in ScriptRunner
2. If script.category === 'long', dispatch 'scripts:confirm'
3. On confirm, call scriptRunner.run(script)
4. useScriptRunner spawns subprocess with npx tsx
5. stdout/stderr → dispatch 'scripts:output' per line
6. On exit → dispatch 'scripts:complete' with exit code
```

### History Loading Flow

```
1. User enters history mode → triggers useEffect
2. discoverRuns(OUTPUTS_DIR, datasetName) scans filesystem
3. dispatch 'history:load-runs' with results
4. User selects run and presses Enter
5. discoverArtifacts(runPath) scans run directory
6. dispatch 'history:load-artifacts' with results
7. User selects artifact → readArtifactContent() or open in Finder
```

### Pipeline Event Flow

```
1. Pipeline runs (started from index.tsx)
2. Pipeline emits events via getPipelineEventBus()
3. usePipelineEvents hook subscribes to bus
4. Each event → dispatch { type: 'event', event }
5. pipelineReducer updates stage status, costs, logs, etc.
```

## Adding New Features

### Adding a New Mode

1. **Add to AppMode type** in `state/types.ts`:
   ```typescript
   export type AppMode = 'menu' | 'scripts' | 'history' | 'settings' | 'pipeline' | 'newmode';
   ```

2. **Define state interface** in `state/types.ts`:
   ```typescript
   export interface NewModeState {
     // your state fields
   }
   ```

3. **Add to AppState** in `state/types.ts`:
   ```typescript
   export interface AppState {
     // ...existing
     newmode: NewModeState;
   }
   ```

4. **Create initial state factory** in `state/types.ts`:
   ```typescript
   export function createInitialNewModeState(): NewModeState {
     return { /* initial values */ };
   }
   ```

5. **Define actions** in `state/reducer.ts`:
   ```typescript
   export type NewModeAction =
     | { type: 'newmode:load'; data: Data[] }
     | { type: 'newmode:select'; index: number };
   ```

6. **Add reducer** in `state/reducer.ts`:
   ```typescript
   function newmodeReducer(state: NewModeState, action: NewModeAction): NewModeState {
     // handle actions
   }
   ```

7. **Add to appReducer** in `state/reducer.ts`:
   ```typescript
   if (action.type.startsWith('newmode:')) {
     return { ...state, newmode: newmodeReducer(state.newmode, action as NewModeAction) };
   }
   ```

8. **Add navigation handler** in `state/reducer.ts`:
   ```typescript
   function handleNewModeNavigation(state: AppState, action: NavigationAction): AppState {
     // handle up/down/enter/back
   }
   ```

9. **Create component** in `components/NewMode.tsx`

10. **Add to App.tsx** rendering:
    ```typescript
    {state.mode === 'newmode' && <NewMode state={state.newmode} />}
    ```

11. **Add to MainMenu** if it should be a menu option

12. **Export from components/index.ts**

### Adding a New Pipeline Stage Display

The pipeline view is driven by `PipelineEvent` types from `lib/events/types.ts`. To add visualization for a new event:

1. Add event type handling in `pipelineReducer`
2. Update `StageState` if needed
3. Modify `PipelineView` or `StageDetail` to display new data

## Component Patterns

### Shared Components

Use components from `shared.tsx`:

```typescript
import { Header, HorizontalRule, StatusBadge, ProgressBar, Duration, Cost } from './shared';

<Header title="My View" subtitle="optional" showBack />
<StatusBadge status="running" />
<ProgressBar completed={5} total={10} width={20} />
<Duration durationMs={1234} />
<Cost costUsd={0.05} />
<HorizontalRule />
```

### Key Hints Pattern

Each view should show key hints at the bottom:

```typescript
<HorizontalRule />
<Box paddingX={1}>
  <Text color="cyan">[j/k]</Text>
  <Text color="gray"> select  </Text>
  <Text color="cyan">[Enter]</Text>
  <Text color="gray"> action  </Text>
  <Text color="cyan">[Esc]</Text>
  <Text color="gray"> back  </Text>
  <Text color="cyan">[q]</Text>
  <Text color="gray"> quit</Text>
</Box>
```

### List Selection Pattern

```typescript
{items.map((item, index) => (
  <Box key={item.id}>
    <Text color={index === selectedIndex ? 'cyan' : undefined}>
      {index === selectedIndex ? '  \u25B6 ' : '    '}
    </Text>
    <Text color={index === selectedIndex ? 'white' : undefined} bold={index === selectedIndex}>
      {item.name}
    </Text>
  </Box>
))}
```

## Testing the CLI

```bash
# Show menu (default)
hawktab

# Show help
hawktab help

# Run pipeline with UI
hawktab run

# Run pipeline without UI
hawktab run --no-ui

# Demo mode (UI without pipeline)
hawktab demo
```

## Important Notes

1. **Console suppression**: In UI mode, `console.log/warn/info` are suppressed. Use the event bus for pipeline communication.

2. **Raw mode errors**: When piping input (e.g., `echo 'q' | hawktab`), Ink throws a raw mode error. This is expected - the CLI requires an interactive terminal.

3. **Effects in App.tsx**: Data loading (scripts, history, settings) happens in `useEffect` hooks when entering each mode.

4. **Script execution**: Scripts run in a subprocess via `child_process.spawn`. Output is streamed line-by-line.

5. **History scanning**: The `utils/history.ts` module reads `outputs/` directory and parses `pipeline-summary.json` files.

6. **Pipeline start coordination**: The App component accepts two important callbacks:
   - `onReady`: Called after `usePipelineEvents` mounts and subscribes to the event bus. The parent (index.tsx) waits for this before starting the pipeline to avoid race conditions.
   - `onStartPipeline`: Called when user selects "Run Pipeline" from the menu. The parent handles the actual `runPipeline()` call.

---

**Last Updated**: 2026-02-01 (CLI enhancement with menu, scripts, history, settings modes)
