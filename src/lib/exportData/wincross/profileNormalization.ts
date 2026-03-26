import {
  WinCrossParseDiagnosticsSchema,
  WinCrossPreferenceProfileSchema,
  type WinCrossParseDiagnostics,
  type WinCrossPreferenceProfile,
} from '../types';

const HEADER_ROW_PATTERNS = new Set<WinCrossPreferenceProfile['tableStyleHints']['headerRowPattern']>([
  'none',
  'leading_label_only',
  'sectioned_label_only',
  'trailing_label_only',
  'mixed_or_unsafe',
]);

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function readStringRecord(value: unknown): Record<string, string> {
  const record = readRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function readSectionRecord(value: unknown): Record<string, string[]> {
  const record = readRecord(value);
  if (!record) return {};
  return Object.fromEntries(
    Object.entries(record).map(([key, entry]) => [key, readStringArray(entry)]),
  );
}

function readNullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readEncoding(value: unknown): WinCrossParseDiagnostics['encoding'] {
  return value === 'utf16le' || value === 'utf8' || value === 'unknown'
    ? value
    : 'unknown';
}

export function normalizeWinCrossPreferenceProfile(input: unknown): {
  profile: WinCrossPreferenceProfile;
  warnings: string[];
} {
  const profile = readRecord(input) ?? {};
  const rawStyleHints = readRecord(profile.tableStyleHints);
  const rawPatternHints = readRecord(profile.tablePatternHints);

  const normalizedPatternHints = {
    tableCount: readNumber(rawPatternHints?.tableCount),
    useCount: readNumber(rawPatternHints?.useCount),
    afCount: readNumber(rawPatternHints?.afCount),
    sbaseCount: readNumber(rawPatternHints?.sbaseCount),
  };

  const normalizedProfile = WinCrossPreferenceProfileSchema.parse({
    version: readNullableString(profile.version),
    numericPreferenceVector: readNullableString(profile.numericPreferenceVector),
    tableOptionSignature: readNullableString(profile.tableOptionSignature),
    defaultTotalLine: readNullableString(profile.defaultTotalLine),
    preferenceLines: readStringArray(profile.preferenceLines),
    tokenDictionary: readStringRecord(profile.tokenDictionary),
    statsDictionary: readStringRecord(profile.statsDictionary),
    sigFooterLines: readStringArray(profile.sigFooterLines),
    bannerLines: readStringArray(profile.bannerLines),
    bannerMemberLines: readStringArray(profile.bannerMemberLines),
    bannerDisplayLines: readStringArray(profile.bannerDisplayLines),
    bannerLayoutLines: readStringArray(profile.bannerLayoutLines),
    titleLines: readStringArray(profile.titleLines),
    passthroughSections: readSectionRecord(profile.passthroughSections),
    tableStyleHints: {
      sourceTableCount: readNumber(
        rawStyleHints?.sourceTableCount,
        normalizedPatternHints.tableCount,
      ),
      valueReferenceColumn: readNullableNumber(rawStyleHints?.valueReferenceColumn),
      statLabelCaretColumn: readNullableNumber(rawStyleHints?.statLabelCaretColumn),
      netRowSuffixToken: readNullableString(rawStyleHints?.netRowSuffixToken),
      headerLeadingSpaces: readNullableNumber(rawStyleHints?.headerLeadingSpaces),
      headerRowPattern: HEADER_ROW_PATTERNS.has(
        rawStyleHints?.headerRowPattern as WinCrossPreferenceProfile['tableStyleHints']['headerRowPattern'],
      )
        ? rawStyleHints?.headerRowPattern as WinCrossPreferenceProfile['tableStyleHints']['headerRowPattern']
        : 'none',
      notes: readStringArray(rawStyleHints?.notes),
    },
    tablePatternHints: normalizedPatternHints,
  });

  const warnings: string[] = [];
  if (!rawStyleHints) {
    warnings.push('Loaded legacy WinCross profile without tableStyleHints; applied neutral compatibility defaults.');
  }
  if (!rawPatternHints) {
    warnings.push('Loaded legacy WinCross profile without tablePatternHints; applied neutral compatibility defaults.');
  }

  return {
    profile: normalizedProfile,
    warnings,
  };
}

export function normalizeWinCrossParseDiagnostics(
  input: unknown,
  warningPrefix: string[] = [],
): WinCrossParseDiagnostics {
  const record = readRecord(input);
  return WinCrossParseDiagnosticsSchema.parse({
    warnings: [...warningPrefix, ...readStringArray(record?.warnings)],
    errors: readStringArray(record?.errors),
    sectionNames: readStringArray(record?.sectionNames),
    encoding: readEncoding(record?.encoding),
  });
}
