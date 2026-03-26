import { useState, useEffect } from 'react';

/**
 * Returns `true` if `isLoading` has been `true` continuously for longer
 * than `timeoutMs`. Resets automatically when loading resolves.
 *
 * Usage:
 * ```tsx
 * const isLoading = data === undefined;
 * const timedOut = useLoadingTimeout(isLoading);
 * ```
 */
export function useLoadingTimeout(isLoading: boolean, timeoutMs: number = 10_000): boolean {
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (!isLoading) {
      setTimedOut(false);
      return;
    }

    const timer = setTimeout(() => setTimedOut(true), timeoutMs);
    return () => clearTimeout(timer);
  }, [isLoading, timeoutMs]);

  return timedOut;
}
