'use client';

import { useState, useEffect, useCallback } from 'react';

const STORAGE_KEY = 'crosstab-sound-notifications';

/**
 * Hook for managing the sound notification preference.
 * Backed by localStorage — device-local, no server round-trip.
 * Default: enabled.
 */
export function useSoundPreference(): [boolean, (enabled: boolean) => void] {
  const [enabled, setEnabledState] = useState(true);

  // Hydrate from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) {
        setEnabledState(stored === 'true');
      }
    } catch {
      // localStorage unavailable (SSR, private browsing) — keep default
    }
  }, []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      localStorage.setItem(STORAGE_KEY, String(value));
    } catch {
      // localStorage unavailable — state still works for this session
    }
  }, []);

  return [enabled, setEnabled];
}
