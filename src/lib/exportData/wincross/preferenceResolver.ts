import { createHash } from 'crypto';
import {
  WinCrossPreferenceProfileSchema,
  WinCrossParseDiagnosticsSchema,
  type WinCrossPreferenceProfile,
  type WinCrossParseDiagnostics,
} from '@/lib/exportData/types';
import { buildDefaultWinCrossPreferenceProfile, parseWinCrossPreferenceJob } from './parser';
import {
  normalizeWinCrossParseDiagnostics,
  normalizeWinCrossPreferenceProfile,
} from './profileNormalization';
import hcpVaccinesFixture from './fixtures/hcp-vaccines-profile.json';

export type WinCrossPreferenceSource =
  | { kind: 'default' }
  | { kind: 'embedded_reference'; referenceId: 'hcp_vaccines' }
  | { kind: 'inline_job'; content: Buffer; fileName?: string }
  | {
    kind: 'org_profile';
    profileId: string;
    profile: unknown;
    diagnostics?: unknown;
    profileName?: string;
  };

export interface WinCrossResolvedPreference {
  profile: WinCrossPreferenceProfile;
  diagnostics: WinCrossParseDiagnostics;
  source: WinCrossPreferenceSource;
  profileDigest: string;
  sourceDigest: string;
}

export function resolveWinCrossPreference(source: WinCrossPreferenceSource): WinCrossResolvedPreference {
  switch (source.kind) {
    case 'default':
      return resolveDefault(source);
    case 'embedded_reference':
      return resolveEmbeddedReference(source);
    case 'inline_job':
      return resolveInlineJob(source);
    case 'org_profile':
      return resolveOrgProfile(source);
  }
}

function resolveDefault(source: WinCrossPreferenceSource & { kind: 'default' }): WinCrossResolvedPreference {
  const profile = buildDefaultWinCrossPreferenceProfile();
  const diagnostics = WinCrossParseDiagnosticsSchema.parse({
    warnings: [],
    errors: [],
    sectionNames: [],
    encoding: 'unknown',
  });
  return {
    profile,
    diagnostics,
    source,
    profileDigest: computeProfileDigest(profile),
    sourceDigest: computeSourceDigest(source),
  };
}

function resolveEmbeddedReference(source: WinCrossPreferenceSource & { kind: 'embedded_reference' }): WinCrossResolvedPreference {
  const profile = WinCrossPreferenceProfileSchema.parse(hcpVaccinesFixture);
  const diagnostics = WinCrossParseDiagnosticsSchema.parse({
    warnings: [`Loaded embedded reference profile: ${source.referenceId}`],
    errors: [],
    sectionNames: ['VERSION', 'PREFERENCES', 'SIGFOOTER', 'GLOSSARY', 'SIDEBYSIDE'],
    encoding: 'unknown',
  });
  return {
    profile,
    diagnostics,
    source,
    profileDigest: computeProfileDigest(profile),
    sourceDigest: computeSourceDigest(source),
  };
}

function resolveInlineJob(source: WinCrossPreferenceSource & { kind: 'inline_job' }): WinCrossResolvedPreference {
  const parsed = parseWinCrossPreferenceJob(source.content);
  return {
    profile: parsed.profile,
    diagnostics: parsed.diagnostics,
    source,
    profileDigest: computeProfileDigest(parsed.profile),
    sourceDigest: computeSourceDigest(source),
  };
}

function resolveOrgProfile(source: WinCrossPreferenceSource & { kind: 'org_profile' }): WinCrossResolvedPreference {
  const normalizedProfile = normalizeWinCrossPreferenceProfile(source.profile);
  const sourceWarnings = source.profileName ? [`Loaded org profile: ${source.profileName}`] : [];
  const diagnostics = normalizeWinCrossParseDiagnostics(
    source.diagnostics,
    [...sourceWarnings, ...normalizedProfile.warnings],
  );
  const normalizedSource: WinCrossPreferenceSource = {
    ...source,
    profile: normalizedProfile.profile,
    diagnostics,
  };

  return {
    profile: normalizedProfile.profile,
    diagnostics,
    source: normalizedSource,
    profileDigest: computeProfileDigest(normalizedProfile.profile),
    sourceDigest: computeSourceDigest(normalizedSource),
  };
}

function computeProfileDigest(profile: WinCrossPreferenceProfile): string {
  return createHash('sha256').update(stableJson(profile)).digest('hex');
}

function computeSourceDigest(source: WinCrossPreferenceSource): string {
  switch (source.kind) {
    case 'default':
      return createHash('sha256').update(stableJson({ kind: 'default' })).digest('hex');
    case 'embedded_reference':
      return createHash('sha256').update(stableJson({ kind: 'embedded_reference', referenceId: source.referenceId })).digest('hex');
    case 'inline_job': {
      const contentHash = createHash('sha256').update(source.content).digest('hex');
      return createHash('sha256').update(stableJson({ kind: 'inline_job', contentHash })).digest('hex');
    }
    case 'org_profile': {
      const profileDigest = computeProfileDigest(normalizeWinCrossPreferenceProfile(source.profile).profile);
      return createHash('sha256')
        .update(stableJson({ kind: 'org_profile', profileId: source.profileId, profileDigest }))
        .digest('hex');
    }
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => stableValue(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, child]) => child !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}
