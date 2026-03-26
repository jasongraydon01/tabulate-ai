import { z } from 'zod';

export interface RegroupSuffixPriorWeights {
  r?: number;
  c?: number;
  default?: number;
}

export interface RegroupConfig {
  enabled: boolean;
  minSiblings: number;
  maxScaleCardinality: number;
  allowedSuffixPatterns: string[];
  blockedSuffixPatterns: string[];
  allowFamilyPatterns: string[];
  blockFamilyPatterns: string[];
  minAxisMargin: number;
  maxRowsPerRegroupedTable: number;
  minRowsPerRegroupedTable: number;
  emitDecisionReport: boolean;
  suffixClassPriorWeights: {
    r: number;
    c: number;
    default: number;
  };
}

export const DEFAULT_REGROUP_CONFIG: RegroupConfig = {
  enabled: true,
  minSiblings: 3,
  maxScaleCardinality: 7,
  allowedSuffixPatterns: ['^r\\d+$'],
  blockedSuffixPatterns: [],
  allowFamilyPatterns: [],
  blockFamilyPatterns: [],
  minAxisMargin: 0.12,
  maxRowsPerRegroupedTable: 200,
  minRowsPerRegroupedTable: 2,
  emitDecisionReport: true,
  suffixClassPriorWeights: {
    r: 0.6,
    c: 0.4,
    default: 0.5,
  },
};

const RegroupSuffixPriorWeightsSchema = z.object({
  r: z.number().min(0).max(1).optional(),
  c: z.number().min(0).max(1).optional(),
  default: z.number().min(0).max(1).optional(),
}).strict();

export const RegroupConfigOverrideSchema = z.object({
  enabled: z.boolean().optional(),
  minSiblings: z.number().int().min(1).optional(),
  maxScaleCardinality: z.number().int().min(1).optional(),
  allowedSuffixPatterns: z.array(z.string()).optional(),
  blockedSuffixPatterns: z.array(z.string()).optional(),
  allowFamilyPatterns: z.array(z.string()).optional(),
  blockFamilyPatterns: z.array(z.string()).optional(),
  minAxisMargin: z.number().min(0).max(1).optional(),
  maxRowsPerRegroupedTable: z.number().int().min(1).optional(),
  minRowsPerRegroupedTable: z.number().int().min(1).optional(),
  emitDecisionReport: z.boolean().optional(),
  suffixClassPriorWeights: RegroupSuffixPriorWeightsSchema.optional(),
}).strict();

export type RegroupConfigOverride = z.infer<typeof RegroupConfigOverrideSchema>;

interface ResolveRegroupConfigParams {
  runOverride?: RegroupConfigOverride | null;
  projectOverride?: RegroupConfigOverride | null;
  env?: Record<string, string | undefined>;
}

export interface ResolveRegroupConfigResult {
  config: RegroupConfig;
  warnings: string[];
}

function parseBooleanEnv(value: string | undefined, key: string, warnings: string[]): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  warnings.push(`[regroupConfig] Invalid ${key}="${value}"; using lower-precedence value`);
  return undefined;
}

function parseNumberEnv(
  value: string | undefined,
  key: string,
  warnings: string[],
  opts: { integer?: boolean; min?: number; max?: number } = {}
): number | undefined {
  if (value === undefined) return undefined;

  const parsed = opts.integer ? Number.parseInt(value, 10) : Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    warnings.push(`[regroupConfig] Invalid ${key}="${value}"; using lower-precedence value`);
    return undefined;
  }
  if (opts.integer && !Number.isInteger(parsed)) {
    warnings.push(`[regroupConfig] Invalid ${key}="${value}" (must be integer); using lower-precedence value`);
    return undefined;
  }
  if (opts.min !== undefined && parsed < opts.min) {
    warnings.push(`[regroupConfig] Invalid ${key}="${value}" (< ${opts.min}); using lower-precedence value`);
    return undefined;
  }
  if (opts.max !== undefined && parsed > opts.max) {
    warnings.push(`[regroupConfig] Invalid ${key}="${value}" (> ${opts.max}); using lower-precedence value`);
    return undefined;
  }

  return parsed;
}

function parseListEnv(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  if (!value.trim()) return [];
  return value
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function parseEnvRegroupConfig(env: Record<string, string | undefined>, warnings: string[]): RegroupConfigOverride {
  const enabled = parseBooleanEnv(env.REGROUP_ENABLED, 'REGROUP_ENABLED', warnings);
  const minSiblings = parseNumberEnv(env.REGROUP_MIN_SIBLINGS, 'REGROUP_MIN_SIBLINGS', warnings, { integer: true, min: 1 });
  const maxScaleCardinality = parseNumberEnv(env.REGROUP_MAX_SCALE_CARDINALITY, 'REGROUP_MAX_SCALE_CARDINALITY', warnings, { integer: true, min: 1 });
  const minAxisMargin = parseNumberEnv(env.REGROUP_MIN_AXIS_MARGIN, 'REGROUP_MIN_AXIS_MARGIN', warnings, { min: 0, max: 1 });
  const maxRowsPerRegroupedTable = parseNumberEnv(env.REGROUP_MAX_ROWS_PER_TABLE, 'REGROUP_MAX_ROWS_PER_TABLE', warnings, { integer: true, min: 1 });
  const minRowsPerRegroupedTable = parseNumberEnv(env.REGROUP_MIN_ROWS_PER_TABLE, 'REGROUP_MIN_ROWS_PER_TABLE', warnings, { integer: true, min: 1 });
  const emitDecisionReport = parseBooleanEnv(env.REGROUP_EMIT_DECISION_REPORT, 'REGROUP_EMIT_DECISION_REPORT', warnings);

  const result: RegroupConfigOverride = {};
  const allowedSuffixPatterns = parseListEnv(env.REGROUP_ALLOWED_SUFFIX_PATTERNS);
  const blockedSuffixPatterns = parseListEnv(env.REGROUP_BLOCKED_SUFFIX_PATTERNS);
  const allowFamilyPatterns = parseListEnv(env.REGROUP_ALLOW_FAMILY_PATTERNS);
  const blockFamilyPatterns = parseListEnv(env.REGROUP_BLOCK_FAMILY_PATTERNS);

  if (allowedSuffixPatterns !== undefined) result.allowedSuffixPatterns = allowedSuffixPatterns;
  if (blockedSuffixPatterns !== undefined) result.blockedSuffixPatterns = blockedSuffixPatterns;
  if (allowFamilyPatterns !== undefined) result.allowFamilyPatterns = allowFamilyPatterns;
  if (blockFamilyPatterns !== undefined) result.blockFamilyPatterns = blockFamilyPatterns;

  if (enabled !== undefined) result.enabled = enabled;
  if (minSiblings !== undefined) result.minSiblings = minSiblings;
  if (maxScaleCardinality !== undefined) result.maxScaleCardinality = maxScaleCardinality;
  if (minAxisMargin !== undefined) result.minAxisMargin = minAxisMargin;
  if (maxRowsPerRegroupedTable !== undefined) result.maxRowsPerRegroupedTable = maxRowsPerRegroupedTable;
  if (minRowsPerRegroupedTable !== undefined) result.minRowsPerRegroupedTable = minRowsPerRegroupedTable;
  if (emitDecisionReport !== undefined) result.emitDecisionReport = emitDecisionReport;

  return result;
}

function toValidatedOverride(
  sourceName: string,
  override: RegroupConfigOverride | null | undefined,
  warnings: string[]
): RegroupConfigOverride {
  if (!override) return {};
  const parsed = RegroupConfigOverrideSchema.safeParse(override);
  if (parsed.success) return parsed.data;

  warnings.push(`[regroupConfig] Invalid ${sourceName} override ignored: ${parsed.error.message}`);
  return {};
}

function mergeConfig(
  base: RegroupConfig,
  envOverride: RegroupConfigOverride,
  projectOverride: RegroupConfigOverride,
  runOverride: RegroupConfigOverride
): RegroupConfig {
  const merged: RegroupConfig = {
    ...base,
    suffixClassPriorWeights: {
      ...base.suffixClassPriorWeights,
    },
  };

  const applyOverride = (override: RegroupConfigOverride) => {
    if (override.enabled !== undefined) merged.enabled = override.enabled;
    if (override.minSiblings !== undefined) merged.minSiblings = override.minSiblings;
    if (override.maxScaleCardinality !== undefined) merged.maxScaleCardinality = override.maxScaleCardinality;
    if (override.allowedSuffixPatterns !== undefined) merged.allowedSuffixPatterns = override.allowedSuffixPatterns;
    if (override.blockedSuffixPatterns !== undefined) merged.blockedSuffixPatterns = override.blockedSuffixPatterns;
    if (override.allowFamilyPatterns !== undefined) merged.allowFamilyPatterns = override.allowFamilyPatterns;
    if (override.blockFamilyPatterns !== undefined) merged.blockFamilyPatterns = override.blockFamilyPatterns;
    if (override.minAxisMargin !== undefined) merged.minAxisMargin = override.minAxisMargin;
    if (override.maxRowsPerRegroupedTable !== undefined) merged.maxRowsPerRegroupedTable = override.maxRowsPerRegroupedTable;
    if (override.minRowsPerRegroupedTable !== undefined) merged.minRowsPerRegroupedTable = override.minRowsPerRegroupedTable;
    if (override.emitDecisionReport !== undefined) merged.emitDecisionReport = override.emitDecisionReport;
    if (override.suffixClassPriorWeights) {
      if (override.suffixClassPriorWeights.r !== undefined) merged.suffixClassPriorWeights.r = override.suffixClassPriorWeights.r;
      if (override.suffixClassPriorWeights.c !== undefined) merged.suffixClassPriorWeights.c = override.suffixClassPriorWeights.c;
      if (override.suffixClassPriorWeights.default !== undefined) merged.suffixClassPriorWeights.default = override.suffixClassPriorWeights.default;
    }
  };

  applyOverride(envOverride);
  applyOverride(projectOverride);
  applyOverride(runOverride);

  if (merged.minRowsPerRegroupedTable > merged.maxRowsPerRegroupedTable) {
    merged.minRowsPerRegroupedTable = merged.maxRowsPerRegroupedTable;
  }

  return merged;
}

export function resolveRegroupConfig(params: ResolveRegroupConfigParams = {}): ResolveRegroupConfigResult {
  const warnings: string[] = [];
  const env = params.env || process.env;

  const envOverride = toValidatedOverride('env', parseEnvRegroupConfig(env, warnings), warnings);
  const projectOverride = toValidatedOverride('project', params.projectOverride, warnings);
  const runOverride = toValidatedOverride('run', params.runOverride, warnings);

  const config = mergeConfig(DEFAULT_REGROUP_CONFIG, envOverride, projectOverride, runOverride);
  return { config, warnings };
}

export function parseRegroupEnabledFlag(value: string | undefined): boolean | undefined {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return undefined;
}

export function parseRegroupConfigJson(input: unknown): RegroupConfigOverride {
  return RegroupConfigOverrideSchema.parse(input);
}

export function buildRegroupSummaryLine(report: {
  totals: {
    detected: number;
    candidate: number;
    applied: number;
    fallback: number;
    reverted: number;
    skipped: number;
  };
  families: Array<{ fallbackReason?: string }>;
}): string {
  const fallbackCounts = new Map<string, number>();
  for (const family of report.families) {
    if (!family.fallbackReason) continue;
    fallbackCounts.set(family.fallbackReason, (fallbackCounts.get(family.fallbackReason) || 0) + 1);
  }

  const topReasons = [...fallbackCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([reason, count]) => `${reason}:${count}`)
    .join(', ');

  const t = report.totals;
  return `detected=${t.detected} candidate=${t.candidate} applied=${t.applied} fallback=${t.fallback} reverted=${t.reverted} skipped=${t.skipped}${topReasons ? ` reasons=[${topReasons}]` : ''}`;
}
