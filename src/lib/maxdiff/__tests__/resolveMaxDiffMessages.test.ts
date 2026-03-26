import { describe, it, expect } from 'vitest';
import { resolveMaxDiffMessages, resolveAndParseMaxDiffMessages } from '../resolveMaxDiffMessages';
import { MaxDiffWarnings } from '../warnings';
import type { ProjectConfig } from '@/schemas/projectConfigSchema';

// ─── resolveMaxDiffMessages (sync) ──────────────────────────────────────────

describe('resolveMaxDiffMessages', () => {
  it('returns wizard entries when config has maxdiffMessages', () => {
    const config = {
      maxdiffMessages: [
        { code: 'I1', text: 'First message' },
        { code: 'I2', text: 'Second message' },
      ],
    } as unknown as ProjectConfig;

    const result = resolveMaxDiffMessages(config);
    expect(result.source).toBe('wizard');
    expect(result.entries).toHaveLength(2);
    expect(result.entries![0]).toMatchObject({ code: 'I1', text: 'First message', sourceRow: 1 });
    expect(result.entries![1]).toMatchObject({ code: 'I2', text: 'Second message', sourceRow: 2 });
  });

  it('threads variantOf from wizard messages', () => {
    const config = {
      maxdiffMessages: [
        { code: 'I1', text: 'Primary' },
        { code: 'I1A', text: 'Alternate', variantOf: 'I1' },
      ],
    } as unknown as ProjectConfig;

    const result = resolveMaxDiffMessages(config);
    expect(result.entries![1].variantOf).toBe('I1');
  });

  it('omits variantOf when not present', () => {
    const config = {
      maxdiffMessages: [
        { code: 'I1', text: 'Primary' },
      ],
    } as unknown as ProjectConfig;

    const result = resolveMaxDiffMessages(config);
    expect(result.entries![0].variantOf).toBeUndefined();
  });

  it('returns file source when messageListPath is provided', () => {
    const result = resolveMaxDiffMessages(undefined, '/path/to/messages.xlsx');
    expect(result.source).toBe('file');
    expect(result.entries).toBeNull();
  });

  it('returns sav source as fallback', () => {
    const result = resolveMaxDiffMessages(undefined);
    expect(result.source).toBe('sav');
    expect(result.entries).toBeNull();
  });

  it('wizard takes priority over file path', () => {
    const config = {
      maxdiffMessages: [{ code: 'I1', text: 'Text' }],
    } as unknown as ProjectConfig;

    const result = resolveMaxDiffMessages(config, '/path/to/messages.xlsx');
    expect(result.source).toBe('wizard');
  });

  it('empty wizard messages fall through to file', () => {
    const config = {
      maxdiffMessages: [],
    } as unknown as ProjectConfig;

    const result = resolveMaxDiffMessages(config, '/path/to/messages.xlsx');
    expect(result.source).toBe('file');
  });
});

// ─── resolveAndParseMaxDiffMessages (async) ──────────────────────────────────

describe('resolveAndParseMaxDiffMessages', () => {
  it('returns wizard entries without parsing a file', async () => {
    const config = {
      maxdiffMessages: [
        { code: 'I1', text: 'First' },
      ],
    } as unknown as ProjectConfig;

    const result = await resolveAndParseMaxDiffMessages(config);
    expect(result.source).toBe('wizard');
    expect(result.entries).toHaveLength(1);
  });

  it('returns sav fallback when no config and no file path', async () => {
    const result = await resolveAndParseMaxDiffMessages(undefined);
    expect(result.source).toBe('sav');
    expect(result.entries).toBeNull();
  });

  it('falls back to sav with warning when file parsing fails', async () => {
    const warnings = new MaxDiffWarnings();
    // Use a non-existent path — parseMessageListFile will throw
    const result = await resolveAndParseMaxDiffMessages(
      undefined,
      '/nonexistent/path/messages.xlsx',
      warnings,
    );
    expect(result.source).toBe('sav');
    expect(result.entries).toBeNull();
    expect(warnings.count).toBeGreaterThanOrEqual(1);
    expect(warnings.toArray().some(w => w.code === 'parse_error_fallback')).toBe(true);
  });

  it('throws when file parsing fails and no warnings accumulator', async () => {
    await expect(
      resolveAndParseMaxDiffMessages(undefined, '/nonexistent/path/messages.xlsx')
    ).rejects.toThrow();
  });

  it('validates variantOf graph for wizard entries when warnings provided', async () => {
    const config = {
      maxdiffMessages: [
        { code: 'A', text: 'Msg A', variantOf: 'B' },
        { code: 'B', text: 'Msg B', variantOf: 'A' }, // cycle
      ],
    } as unknown as ProjectConfig;

    const warnings = new MaxDiffWarnings();
    await resolveAndParseMaxDiffMessages(config, undefined, warnings);
    expect(warnings.toArray().some(w => w.code === 'variantof_cycle')).toBe(true);
  });
});
