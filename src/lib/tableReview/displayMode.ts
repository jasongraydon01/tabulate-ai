/**
 * @deprecated Legacy Review Tables backend removed from the product surface in Phase 6.
 * Retained on disk for reference only. Do not invoke from active code.
 */
export type RunDisplayMode = 'frequency' | 'counts' | 'both';
export type TableDisplayMode = 'frequency' | 'counts';

const DEFAULT_DISPLAY_MODE: TableDisplayMode = 'frequency';

export function resolveDisplayModes(
  runDisplayMode: string | null | undefined,
): TableDisplayMode[] {
  if (runDisplayMode === 'counts') {
    return ['counts'];
  }
  if (runDisplayMode === 'both') {
    return ['frequency', 'counts'];
  }
  return [DEFAULT_DISPLAY_MODE];
}

export function resolveActiveDisplayMode(
  requestedMode: string | null | undefined,
  availableModes: TableDisplayMode[],
): TableDisplayMode {
  if (requestedMode === 'counts' && availableModes.includes('counts')) {
    return 'counts';
  }
  return availableModes[0] ?? DEFAULT_DISPLAY_MODE;
}
