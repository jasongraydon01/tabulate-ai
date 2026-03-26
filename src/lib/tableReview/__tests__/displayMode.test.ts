import { describe, expect, it } from 'vitest';
import {
  resolveActiveDisplayMode,
  resolveDisplayModes,
} from '../displayMode';

describe('resolveDisplayModes', () => {
  it('defaults to frequency when unset', () => {
    expect(resolveDisplayModes(undefined)).toEqual(['frequency']);
    expect(resolveDisplayModes(null)).toEqual(['frequency']);
  });

  it('returns single counts mode when configured', () => {
    expect(resolveDisplayModes('counts')).toEqual(['counts']);
  });

  it('returns both frequency and counts when configured', () => {
    expect(resolveDisplayModes('both')).toEqual(['frequency', 'counts']);
  });

  it('falls back to frequency on unknown mode', () => {
    expect(resolveDisplayModes('not-a-mode')).toEqual(['frequency']);
  });
});

describe('resolveActiveDisplayMode', () => {
  it('keeps requested counts mode when available', () => {
    expect(resolveActiveDisplayMode('counts', ['frequency', 'counts'])).toBe('counts');
  });

  it('falls back to first available mode when request is unavailable', () => {
    expect(resolveActiveDisplayMode('counts', ['frequency'])).toBe('frequency');
  });
});
