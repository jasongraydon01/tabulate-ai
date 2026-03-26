import fs from 'fs/promises';
import path from 'path';

import { getSubDir } from './persistence';

export type AgentTraceStatus = 'written' | 'skipped' | 'error' | 'missing';

export interface AgentTraceEntry {
  stageId: string;
  agentName: string;
  status: AgentTraceStatus;
  generatedAt: string;
  scratchpadPath: string | null;
  reportPath: string | null;
  artifactPaths: string[];
  note?: string;
}

export interface AgentTraceIndex {
  generatedAt: string;
  tracesDir: string;
  entries: AgentTraceEntry[];
}

interface PersistStageTraceInput {
  outputDir: string;
  stageId: string;
  agentName: string;
  status: Exclude<AgentTraceStatus, 'missing'>;
  reportFilename: string;
  summary?: Record<string, unknown>;
  scratchpadMarkdown?: string;
  scratchpadFilename?: string;
  note?: string;
}

// ---------------------------------------------------------------------------
// Agent directory routing
// ---------------------------------------------------------------------------

/** Maps (stageId, agentName) → agents/<slug> directory name. */
const STAGE_AGENT_DIR: Record<string, string> = {
  '08b':  'survey-cleanup',
  '10a':  'loop-gate',
  '10':   'ai-gate-triage',
  '11':   'ai-gate-validate',
  '13c1': 'subtype-gate',
  '13c2': 'structure-gate',
};

/** Stage 13e has two agents — disambiguate by agentName. */
const STAGE_13E_AGENT_DIR: Record<string, string> = {
  'TableContextAgent':   'table-context',
  'NETEnrichmentAgent':  'net-enrichment',
};

/** All known agent directory slugs (for index scanning). */
export const ALL_AGENT_DIRS = [
  'survey-cleanup',
  'loop-gate',
  'ai-gate-triage',
  'ai-gate-validate',
  'subtype-gate',
  'structure-gate',
  'table-context',
  'net-enrichment',
  'banner',
  'crosstab',
  'loop-semantics',
] as const;

export function resolveAgentDir(stageId: string, agentName: string): string {
  if (stageId === '13e') {
    return STAGE_13E_AGENT_DIR[agentName] ?? 'table-context';
  }
  return STAGE_AGENT_DIR[stageId] ?? agentName.toLowerCase().replace(/agent$/i, '').replace(/([A-Z])/g, '-$1').replace(/^-/, '').toLowerCase();
}

// ---------------------------------------------------------------------------
// Legacy support — old runs wrote to planning/traces/
// ---------------------------------------------------------------------------

const LEGACY_TRACES_SUBDIR = ['planning', 'traces'] as const;

const INDEX_FILENAME = 'agent-traces-index.json';

// ---------------------------------------------------------------------------
// Path helpers (per-agent directory)
// ---------------------------------------------------------------------------

function agentTraceRelPath(agentDir: string, fileName: string): string {
  return path.posix.join('agents', agentDir, fileName);
}

function agentTraceAbsPath(outputDir: string, agentDir: string, fileName: string): string {
  return path.join(outputDir, 'agents', agentDir, fileName);
}

async function ensureAgentDir(outputDir: string, agentDir: string): Promise<string> {
  const dir = path.join(getSubDir(outputDir, 'agents'), agentDir);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

// Legacy path helpers (for backward-compat reads in writeAgentTracesIndex)
function legacyTraceRelPath(fileName: string): string {
  return path.posix.join(...LEGACY_TRACES_SUBDIR, fileName);
}

function legacyTraceAbsPath(outputDir: string, fileName: string): string {
  return path.join(outputDir, ...LEGACY_TRACES_SUBDIR, fileName);
}

// ---------------------------------------------------------------------------
// Persist agent trace (writes to agents/<slug>/)
// ---------------------------------------------------------------------------

export async function persistStageAgentTrace(input: PersistStageTraceInput): Promise<void> {
  const agentDir = resolveAgentDir(input.stageId, input.agentName);
  await ensureAgentDir(input.outputDir, agentDir);

  const generatedAt = new Date().toISOString();
  const scratchpadPath =
    input.scratchpadMarkdown && input.scratchpadFilename
      ? agentTraceRelPath(agentDir, input.scratchpadFilename)
      : null;

  if (scratchpadPath && input.scratchpadMarkdown) {
    await fs.writeFile(
      agentTraceAbsPath(input.outputDir, agentDir, input.scratchpadFilename!),
      input.scratchpadMarkdown,
      'utf-8',
    );
  }

  const reportPayload = {
    stageId: input.stageId,
    agentName: input.agentName,
    status: input.status,
    generatedAt,
    scratchpadPath,
    summary: input.summary ?? {},
    note: input.note ?? null,
  };

  await fs.writeFile(
    agentTraceAbsPath(input.outputDir, agentDir, input.reportFilename),
    JSON.stringify(reportPayload, null, 2),
    'utf-8',
  );
}

// ---------------------------------------------------------------------------
// Index builder helpers
// ---------------------------------------------------------------------------

function latestMatch(
  names: string[],
  regex: RegExp,
): string | null {
  const matched = names.filter((n) => regex.test(n)).sort();
  return matched.length > 0 ? matched[matched.length - 1] : null;
}

async function readJsonSafe<T>(absPath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(absPath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

interface StageReportShape {
  status?: AgentTraceStatus;
  generatedAt?: string;
  note?: string | null;
}

/**
 * Build a trace entry for a stage-report-based agent.
 * Checks agents/<slug>/ first, then falls back to planning/traces/ (legacy).
 */
async function buildStageReportEntry(args: {
  outputDir: string;
  stageId: string;
  agentName: string;
  agentDir: string;
  reportFile: string;
  scratchpadFile: string;
}): Promise<AgentTraceEntry> {
  // Try new layout first
  const newReportAbs = agentTraceAbsPath(args.outputDir, args.agentDir, args.reportFile);
  let report = await readJsonSafe<StageReportShape>(newReportAbs);
  const useNewLayout = Boolean(report);

  // Fallback to legacy layout
  if (!report) {
    const legacyReportAbs = legacyTraceAbsPath(args.outputDir, args.reportFile);
    report = await readJsonSafe<StageReportShape>(legacyReportAbs);
  }

  if (!report) {
    return {
      stageId: args.stageId,
      agentName: args.agentName,
      status: 'missing',
      generatedAt: new Date().toISOString(),
      scratchpadPath: null,
      reportPath: null,
      artifactPaths: [],
      note: 'No stage report found',
    };
  }

  // Resolve paths based on which layout we found
  const relPath = useNewLayout
    ? (f: string) => agentTraceRelPath(args.agentDir, f)
    : (f: string) => legacyTraceRelPath(f);
  const absPath = useNewLayout
    ? (f: string) => agentTraceAbsPath(args.outputDir, args.agentDir, f)
    : (f: string) => legacyTraceAbsPath(args.outputDir, f);

  let scratchpadPath: string | null = null;
  try {
    await fs.access(absPath(args.scratchpadFile));
    scratchpadPath = relPath(args.scratchpadFile);
  } catch {
    scratchpadPath = null;
  }

  return {
    stageId: args.stageId,
    agentName: args.agentName,
    status: report.status ?? (scratchpadPath ? 'written' : 'skipped'),
    generatedAt: report.generatedAt ?? new Date().toISOString(),
    scratchpadPath,
    reportPath: relPath(args.reportFile),
    artifactPaths: [
      relPath(args.reportFile),
      ...(scratchpadPath ? [scratchpadPath] : []),
    ],
    note: report.note ?? undefined,
  };
}

interface BannerRouteMetadataShape {
  routeUsed?: 'banner_agent' | 'banner_generate';
  usedFallbackFromBannerAgent?: boolean;
  bannerGenerateInputSource?: string | null;
}

function makeEntry(args: Omit<AgentTraceEntry, 'generatedAt'>): AgentTraceEntry {
  return { ...args, generatedAt: new Date().toISOString() };
}

/**
 * Scan a directory for file names, returning empty array if dir doesn't exist.
 */
async function listDir(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Write the agent traces index
// ---------------------------------------------------------------------------

export async function writeAgentTracesIndex(outputDir: string): Promise<void> {
  const agentsDir = path.join(getSubDir(outputDir, 'agents'));
  await fs.mkdir(agentsDir, { recursive: true });

  // Scan both new layout (agents/<slug>/) and legacy (planning/traces/)
  const bannerNames = await listDir(path.join(agentsDir, 'banner'));
  const crosstabNames = await listDir(path.join(agentsDir, 'crosstab'));

  // Legacy fallback: if new-layout dirs are empty, check planning/traces/
  const legacyDir = path.join(outputDir, ...LEGACY_TRACES_SUBDIR);
  const legacyNames = (bannerNames.length === 0 && crosstabNames.length === 0)
    ? await listDir(legacyDir)
    : [];
  const usingLegacy = legacyNames.length > 0;

  // Use whichever layout has content
  const effectiveBannerNames = bannerNames.length > 0 ? bannerNames : legacyNames;
  const effectiveCrosstabNames = crosstabNames.length > 0 ? crosstabNames : legacyNames;

  const relPathFn = usingLegacy && bannerNames.length === 0
    ? (_agentDir: string, f: string) => legacyTraceRelPath(f)
    : (agentDir: string, f: string) => agentTraceRelPath(agentDir, f);

  const bannerRoute = await readJsonSafe<BannerRouteMetadataShape>(
    path.join(getSubDir(outputDir, 'planning'), 'banner-route-metadata.json'),
  );

  const bannerScratch = latestMatch(
    effectiveBannerNames,
    /^scratchpad-banner-(?!generate(?:-correction)?\.md$).+\.md$/,
  );
  const bannerVerbose = latestMatch(effectiveBannerNames, /^banner-.*-verbose-.*\.json$/);
  const bannerAgent = latestMatch(effectiveBannerNames, /^banner-.*-agent-.*\.json$/);
  const bannerRaw = effectiveBannerNames.includes('banner-output-raw.json') ? 'banner-output-raw.json' : null;

  const bannerGenerateScratch = latestMatch(effectiveBannerNames, /^scratchpad-banner-generate(?:-correction)?\.md$/);
  const bannerGenerateArtifact = effectiveBannerNames.includes('banner-generated.json') ? 'banner-generated.json' : null;
  const bannerGenerateValidation = effectiveBannerNames.includes('banner-generated-validation.json')
    ? 'banner-generated-validation.json'
    : null;

  const crosstabScratch = latestMatch(effectiveCrosstabNames, /^scratchpad-crosstab-v2-.*\.md$/);
  const crosstabRaw = effectiveCrosstabNames.includes('crosstab-output-raw.json') ? 'crosstab-output-raw.json' : null;
  const crosstabStamped = latestMatch(effectiveCrosstabNames, /^crosstab-output-(?!raw\.json$).+\.json$/);

  const entries: AgentTraceEntry[] = [];

  const bannerArtifacts = [bannerRaw, bannerVerbose, bannerAgent].filter((v): v is string => Boolean(v));
  const bannerStatus: AgentTraceStatus =
    bannerArtifacts.length > 0 || Boolean(bannerScratch)
      ? 'written'
      : bannerRoute?.routeUsed === 'banner_generate'
        ? 'skipped'
        : 'missing';
  entries.push(makeEntry({
    stageId: '20',
    agentName: 'BannerAgent',
    status: bannerStatus,
    scratchpadPath: bannerScratch ? relPathFn('banner', bannerScratch) : null,
    reportPath: null,
    artifactPaths: [
      ...bannerArtifacts.map(f => relPathFn('banner', f)),
      ...(bannerScratch ? [relPathFn('banner', bannerScratch)] : []),
    ],
    note: bannerRoute
      ? `routeUsed=${bannerRoute.routeUsed ?? 'unknown'} fallback=${String(bannerRoute.usedFallbackFromBannerAgent ?? false)}`
      : undefined,
  }));

  const bannerGenArtifacts = [bannerGenerateArtifact, bannerGenerateValidation]
    .filter((v): v is string => Boolean(v));
  const bannerGenerateStatus: AgentTraceStatus =
    bannerGenArtifacts.length > 0 || bannerGenerateScratch
      ? 'written'
      : bannerRoute?.routeUsed === 'banner_agent'
        ? 'skipped'
        : 'missing';
  entries.push(makeEntry({
    stageId: '20',
    agentName: 'BannerGenerateAgent',
    status: bannerGenerateStatus,
    scratchpadPath: bannerGenerateScratch ? relPathFn('banner', bannerGenerateScratch) : null,
    reportPath: null,
    artifactPaths: [
      ...bannerGenArtifacts.map(f => relPathFn('banner', f)),
      ...(bannerGenerateScratch ? [relPathFn('banner', bannerGenerateScratch)] : []),
    ],
    note: bannerRoute?.bannerGenerateInputSource
      ? `inputSource=${bannerRoute.bannerGenerateInputSource}`
      : undefined,
  }));

  const crosstabArtifacts = [crosstabRaw, crosstabStamped].filter((v): v is string => Boolean(v));
  entries.push(makeEntry({
    stageId: '21',
    agentName: 'CrosstabAgentV2',
    status: crosstabArtifacts.length > 0 || Boolean(crosstabScratch) ? 'written' : 'missing',
    scratchpadPath: crosstabScratch ? relPathFn('crosstab', crosstabScratch) : null,
    reportPath: null,
    artifactPaths: [
      ...crosstabArtifacts.map(f => relPathFn('crosstab', f)),
      ...(crosstabScratch ? [relPathFn('crosstab', crosstabScratch)] : []),
    ],
  }));

  entries.push(await buildStageReportEntry({
    outputDir,
    stageId: '08b',
    agentName: 'SurveyCleanupAgent',
    agentDir: 'survey-cleanup',
    reportFile: '08b-survey-cleanup-report.json',
    scratchpadFile: '08b-survey-cleanup-scratchpad.md',
  }));

  entries.push(await buildStageReportEntry({
    outputDir,
    stageId: '10a',
    agentName: 'LoopGateAgent',
    agentDir: 'loop-gate',
    reportFile: '10a-loop-gate-report.json',
    scratchpadFile: '10a-loop-gate-scratchpad.md',
  }));

  entries.push(await buildStageReportEntry({
    outputDir,
    stageId: '11',
    agentName: 'AIGateAgent',
    agentDir: 'ai-gate-validate',
    reportFile: '11-ai-gate-report.json',
    scratchpadFile: '11-ai-gate-scratchpad.md',
  }));

  entries.push(await buildStageReportEntry({
    outputDir,
    stageId: '13c1',
    agentName: 'SubtypeGateAgent',
    agentDir: 'subtype-gate',
    reportFile: '13c1-subtype-gate-report.json',
    scratchpadFile: '13c1-subtype-gate-scratchpad.md',
  }));

  entries.push(await buildStageReportEntry({
    outputDir,
    stageId: '13c2',
    agentName: 'StructureGateAgent',
    agentDir: 'structure-gate',
    reportFile: '13c2-structure-gate-report.json',
    scratchpadFile: '13c2-structure-gate-scratchpad.md',
  }));

  entries.push(await buildStageReportEntry({
    outputDir,
    stageId: '13e',
    agentName: 'TableContextAgent',
    agentDir: 'table-context',
    reportFile: '13e-table-context-report.json',
    scratchpadFile: '13e-table-context-scratchpad.md',
  }));

  const index: AgentTraceIndex = {
    generatedAt: new Date().toISOString(),
    tracesDir: 'agents',
    entries,
  };

  await fs.writeFile(
    path.join(agentsDir, INDEX_FILENAME),
    JSON.stringify(index, null, 2),
    'utf-8',
  );
}
