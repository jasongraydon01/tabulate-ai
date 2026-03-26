/**
 * useNavigation Hook
 *
 * Handles keyboard input for navigation.
 */

import { useInput } from 'ink';
import type { AppAction } from '../state/reducer';
import type { AppMode } from '../state/types';

export interface UseNavigationOptions {
  mode: AppMode;
  onAction: (action: AppAction) => void;
  onQuit: () => void;
  onModeAction?: (action: AppAction) => void;
}

export function useNavigation({ mode, onAction, onQuit, onModeAction }: UseNavigationOptions): void {
  useInput((input, key) => {
    // Quit
    if (input === 'q' || input === 'Q') {
      onQuit();
      return;
    }

    // Navigation up
    if (input === 'k' || key.upArrow) {
      onAction({ type: 'nav:up' });
      return;
    }

    // Navigation down
    if (input === 'j' || key.downArrow) {
      onAction({ type: 'nav:down' });
      return;
    }

    // Drill down / select
    if (key.return) {
      onAction({ type: 'nav:enter' });
      // Also notify mode action handler if in menu mode
      if (mode === 'menu' && onModeAction) {
        onModeAction({ type: 'nav:enter' });
      }
      return;
    }

    // Go back
    if (key.escape) {
      onAction({ type: 'nav:back' });
      return;
    }

    // Page up (fast scroll)
    if (key.pageUp || (input === 'u' && key.ctrl)) {
      onAction({ type: 'nav:scroll-up' });
      return;
    }

    // Page down (fast scroll)
    if (key.pageDown || (input === 'd' && key.ctrl)) {
      onAction({ type: 'nav:scroll-down' });
      return;
    }

    // Number shortcuts (menu mode only)
    if (mode === 'menu') {
      const num = parseInt(input, 10);
      if (num >= 1 && num <= 4) {
        onAction({ type: 'nav:number', number: num });
        // Also trigger mode selection
        if (onModeAction) {
          onModeAction({ type: 'nav:number', number: num });
        }
        return;
      }
    }

    // Open in Finder (history mode only)
    if (mode === 'history' && (input === 'o' || input === 'O')) {
      if (onModeAction) {
        onModeAction({ type: 'history:drill-down' }); // Using drill-down as signal for open
      }
      return;
    }

    // System logs toggle (pipeline mode only)
    if (mode === 'pipeline' && (input === 'l' || input === 'L')) {
      onAction({ type: 'nav:logs' });
      return;
    }
  });
}
