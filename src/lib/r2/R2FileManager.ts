/**
 * Pipeline-aware R2 file operations.
 * Wraps the low-level r2.ts primitives with org/project-scoped key patterns
 * and selective output uploading.
 */
import { uploadFile, downloadFile, deleteFile, getSignedDownloadUrl, buildKey } from './r2';
import { promises as fs } from 'fs';
import * as path from 'path';

// Which output files to upload to R2 (primary deliverables + metadata + debugging artifacts)
// Supports glob patterns (e.g., 'banner/*.md') for flexible matching
const OUTPUT_FILES_TO_UPLOAD = [
  // Primary deliverables
  'results/crosstabs.xlsx',
  'results/crosstabs-weighted.xlsx',
  'results/crosstabs-unweighted.xlsx',
  'results/crosstabs-counts.xlsx',
  'results/crosstabs-weighted-counts.xlsx',
  'results/tables.json',
  'results/tables-weighted.json',
  'results/tables-unweighted.json',
  'pipeline-summary.json',
  'stages.json',
  'checkpoint.json',
  'logs/pipeline.log',
  // Regeneration-critical runtime artifacts
  'dataFile.sav',
  'survey/survey-markdown.md',

  // V3 phase-organized artifacts
  'enrichment/*.json',
  'tables/*.json',
  'planning/*.json',
  'compute/*.json',
  'compute/*.R',
  'compute/*.log',

  // Per-agent output folders (V3 reorganized layout)
  'agents/**/*.md',
  'agents/**/*.json',

  // Legacy agent traces (pre-reorganization, kept for backward compat)
  'planning/traces/*.md',
  'planning/traces/*.json',

  // Legacy agent output directories (pre-V3 layout)
  'banner/*.md',
  'banner/*.json',
  'crosstab/*.md',
  'crosstab/*.json',
  'skiplogic/*.md',
  'skiplogic/*.json',
  'filtertranslator/*.md',
  'filtertranslator/*.json',
  'verification/*.md',
  'verification/*.json',
  'tablegenerator/*.json',

  // Legacy R script directory (pre-V3 layout)
  'r/master.R',
  'r/static-validation-report.json',

  // Legacy loop-policy location (pre-reorganization, kept for backward compat)
  'loop-policy/*.md',
  'loop-policy/deterministic-resolver.json',
  'loop-policy/loop-semantics-policy.json',

  // Post-processing
  'postpass/postpass-report.json',

  // Shared export contract artifacts
  'export/export-metadata.json',
  'export/support-report.json',
  'export/table-routing.json',
  'export/job-routing-manifest.json',
  'export/loop-semantics-policy.json',
  'export/data/*.sav',

  // HITL review artifacts
  'review/*.json',

  // Validation logs and scripts
  'validation/validation-execution.log',
  'validation-execution.log',
  'validation/validation-*.R',  // Individual table validation scripts
  'validation/result-*.json',   // Individual table validation results

  // Error tracking
  'errors/errors.ndjson',

  // Legacy stage coordination files (pre-V3 layout)
  'stages/*.json',

  // Legacy DataMap outputs (pre-V3 enrichment chain, written by ValidationRunner)
  // TODO: Remove once ValidationRunner.saveDevelopmentOutputs is confirmed unnecessary in V3 flow
  '*-verbose-*.json',
  '*-crosstab-agent-*.json',
];

export interface R2FileManifest {
  inputs: Record<string, string>;   // originalFilename → R2 key
  outputs: Record<string, string>;  // relativePath → R2 key
  baseKeyPath: string;
  manifestKey: string;
  uploadReport: R2UploadReport;
}

export interface PipelineR2Metadata {
  projectName?: string;
  runTimestamp?: string;  // ISO string
}

export interface R2UploadFailure {
  relativePath: string;
  stage: 'read' | 'upload';
  error: string;
}

export interface R2UploadReport {
  missingOptional: string[];
  failed: R2UploadFailure[];
}

export interface RunInputArtifactRefs {
  dataMap: string | null;
  bannerPlan: string | null;
  spss: string;
  survey: string | null;
  messageList: string | null;
}

/**
 * Upload an input file to R2.
 * Key pattern: {orgId}/{projectId}/inputs/{filename}
 *
 * @deprecated Generic input uploads are no longer used in the main pipeline flow.
 * This function is kept for backward compatibility only and should not be used in new code.
 * Note: a minimal subset of regeneration-critical artifacts (currently `dataFile.sav`
 * and `survey/survey-markdown.md`) is uploaded as outputs via `OUTPUT_FILES_TO_UPLOAD`.
 */
export async function uploadInputFile(
  orgId: string,
  projectId: string,
  fileBuffer: Buffer,
  filename: string,
  contentType?: string,
): Promise<string> {
  const key = buildKey(orgId, projectId, 'inputs', filename);
  await uploadFile(key, fileBuffer, contentType);
  return key;
}

export async function uploadRunInputArtifact(params: {
  orgId: string;
  projectId: string;
  runId: string;
  filename: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
}): Promise<string> {
  const key = buildRunArtifactKey(params.orgId, params.projectId, params.runId, `inputs/${params.filename}`);
  await uploadFile(key, params.body, params.contentType ?? getContentType(params.filename));
  return key;
}

export async function uploadRunInputFiles(params: {
  orgId: string;
  projectId: string;
  runId: string;
  files: {
    dataMapFile?: File | null;
    bannerPlanFile?: File | null;
    dataFile: File;
    surveyFile?: File | null;
    messageListFile?: File | null;
  };
}): Promise<RunInputArtifactRefs> {
  const uploadOptional = async (file: File | null | undefined): Promise<string | null> => {
    if (!file) return null;
    return uploadRunInputArtifact({
      orgId: params.orgId,
      projectId: params.projectId,
      runId: params.runId,
      filename: file.name,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || undefined,
    });
  };

  const [dataMap, bannerPlan, spss, survey, messageList] = await Promise.all([
    uploadOptional(params.files.dataMapFile),
    uploadOptional(params.files.bannerPlanFile),
    uploadRunInputArtifact({
      orgId: params.orgId,
      projectId: params.projectId,
      runId: params.runId,
      filename: params.files.dataFile.name,
      body: Buffer.from(await params.files.dataFile.arrayBuffer()),
      contentType: params.files.dataFile.type || undefined,
    }),
    uploadOptional(params.files.surveyFile),
    uploadOptional(params.files.messageListFile),
  ]);

  return {
    dataMap,
    bannerPlan,
    spss,
    survey,
    messageList,
  };
}

/**
 * Check if a path pattern contains glob characters
 */
function isGlobPattern(pattern: string): boolean {
  return pattern.includes('*') || pattern.includes('?') || pattern.includes('[');
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMissingFileError(error: unknown): boolean {
  return !!error
    && typeof error === 'object'
    && 'code' in error
    && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

export function buildRunArtifactBasePath(
  orgId: string,
  projectId: string,
  runId: string,
): string {
  return `${orgId}/${projectId}/runs/${runId}`;
}

export function buildRunArtifactKey(
  orgId: string,
  projectId: string,
  runId: string,
  relativePath: string,
): string {
  return `${buildRunArtifactBasePath(orgId, projectId, runId)}/${normalizeRelativePath(relativePath)}`;
}

export async function uploadRunOutputArtifact(params: {
  orgId: string;
  projectId: string;
  runId: string;
  relativePath: string;
  body: Buffer | Uint8Array | string;
  contentType?: string;
  existingOutputs?: Record<string, string>;
}): Promise<string> {
  const relativePath = normalizeRelativePath(params.relativePath);
  const key = params.existingOutputs?.[relativePath]
    ?? buildRunArtifactKey(params.orgId, params.projectId, params.runId, relativePath);
  await uploadFile(key, params.body, params.contentType);
  return key;
}

/**
 * Expand a glob pattern to matching file paths
 * Supports: *, ?, [...] patterns
 * Returns relative paths from baseDir
 */
async function expandGlobPattern(baseDir: string, pattern: string): Promise<string[]> {
  const results: string[] = [];
  const parts = pattern.split('/');

  // Find the first part with glob pattern
  const firstGlobIndex = parts.findIndex(p => isGlobPattern(p));

  if (firstGlobIndex === -1) {
    // No glob pattern - return as-is if file exists
    const fullPath = path.join(baseDir, pattern);
    try {
      await fs.access(fullPath);
      return [pattern];
    } catch {
      return [];
    }
  }

  // Build the search path up to the glob
  const staticPrefix = parts.slice(0, firstGlobIndex).join('/');
  const searchDir = staticPrefix ? path.join(baseDir, staticPrefix) : baseDir;

  // Recursively search from the glob point
  const remainingPattern = parts.slice(firstGlobIndex).join('/');

  async function searchRecursive(dir: string, currentPattern: string, prefix: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const patternParts = currentPattern.split('/');
      const currentPart = patternParts[0];
      const hasMore = patternParts.length > 1;

      // ** matches any number of directory levels
      if (currentPart === '**') {
        const remainingAfterGlobstar = hasMore ? patternParts.slice(1).join('/') : '*';
        // Try matching remaining pattern at this level
        await searchRecursive(dir, remainingAfterGlobstar, prefix);
        // And recurse into all subdirectories with the same ** pattern
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
            await searchRecursive(path.join(dir, entry.name), currentPattern, relativePath);
          }
        }
        return;
      }

      for (const entry of entries) {
        const matches = matchGlobPart(entry.name, currentPart);

        if (!matches) continue;

        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        const fullPath = path.join(dir, entry.name);

        if (hasMore && entry.isDirectory()) {
          // Continue searching deeper
          await searchRecursive(fullPath, patternParts.slice(1).join('/'), relativePath);
        } else if (!hasMore && entry.isFile()) {
          // Found a match
          const fullRelative = staticPrefix ? `${staticPrefix}/${relativePath}` : relativePath;
          results.push(fullRelative);
        }
      }
    } catch {
      // Directory doesn't exist or not accessible
    }
  }

  await searchRecursive(searchDir, remainingPattern, '');
  return results;
}

/**
 * Match a filename against a glob pattern part (single segment)
 * Supports: * (any chars), ? (one char), [...] (char class)
 */
function matchGlobPart(name: string, pattern: string): boolean {
  if (pattern === '*') return true;
  if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('[')) {
    return name === pattern;
  }

  // Convert glob pattern to regex
  let regex = '^';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '*') {
      regex += '.*';
    } else if (c === '?') {
      regex += '.';
    } else if (c === '[') {
      const end = pattern.indexOf(']', i);
      if (end > i) {
        regex += pattern.slice(i, end + 1);
        i = end;
      } else {
        regex += '\\[';
      }
    } else {
      regex += c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }
  }
  regex += '$';

  return new RegExp(regex).test(name);
}

/**
 * Upload selected pipeline output files to R2.
 *
 * Key pattern:
 *   {orgId}/{projectId}/runs/{runId}/{relativePath}
 *
 * Only uploads files from OUTPUT_FILES_TO_UPLOAD that exist.
 * Supports glob patterns (e.g., 'banner/*.md') for flexible file matching.
 * Also uploads a manifest.json with run metadata and returns a report that
 * distinguishes optional-missing files from real upload failures.
 */
export async function uploadPipelineOutputs(
  orgId: string,
  projectId: string,
  runId: string,
  localOutputDir: string,
  metadata?: PipelineR2Metadata,
): Promise<R2FileManifest> {
  const baseKeyPath = buildRunArtifactBasePath(orgId, projectId, runId);
  const manifestKey = buildRunArtifactKey(orgId, projectId, runId, 'manifest.json');
  const uploadReport: R2UploadReport = {
    missingOptional: [],
    failed: [],
  };
  const manifest: R2FileManifest = {
    inputs: {},
    outputs: {},
    baseKeyPath,
    manifestKey,
    uploadReport,
  };

  const manifestData = {
    runId,
    projectId,
    projectName: metadata?.projectName || 'Unknown',
    orgId,
    created: metadata?.runTimestamp || new Date().toISOString(),
    baseKeyPath,
  };
  try {
    const manifestBuffer = Buffer.from(JSON.stringify(manifestData, null, 2));
    await uploadFile(manifestKey, manifestBuffer, 'application/json');
    console.log(`[R2] Uploaded manifest.json → ${manifestKey}`);
  } catch (error) {
    uploadReport.failed.push({
      relativePath: 'manifest.json',
      stage: 'upload',
      error: toErrorMessage(error),
    });
    console.warn(`[R2] Failed to upload manifest.json: ${toErrorMessage(error)}`);
  }

  // Expand patterns to actual file paths
  const filesToUpload = new Set<string>();
  for (const pattern of OUTPUT_FILES_TO_UPLOAD) {
    if (isGlobPattern(pattern)) {
      const matches = await expandGlobPattern(localOutputDir, pattern);
      for (const match of matches) {
        filesToUpload.add(normalizeRelativePath(match));
      }
      if (matches.length > 0) {
        console.log(`[R2] Pattern '${pattern}' matched ${matches.length} file(s)`);
      }
    } else {
      filesToUpload.add(normalizeRelativePath(pattern));
    }
  }

  // Upload output files
  const uploadPromises = [...filesToUpload].sort((a, b) => a.localeCompare(b)).map(async (relativePath) => {
    const localPath = path.join(localOutputDir, relativePath);
    try {
      const buffer = await fs.readFile(localPath);
      const key = buildRunArtifactKey(orgId, projectId, runId, relativePath);
      const contentType = getContentType(relativePath);
      try {
        await uploadFile(key, buffer, contentType);
        manifest.outputs[relativePath] = key;
        console.log(`[R2] Uploaded ${relativePath} → ${key}`);
      } catch (error) {
        uploadReport.failed.push({
          relativePath,
          stage: 'upload',
          error: toErrorMessage(error),
        });
        console.warn(`[R2] Failed to upload ${relativePath}: ${toErrorMessage(error)}`);
      }
    } catch (error) {
      if (isMissingFileError(error)) {
        uploadReport.missingOptional.push(relativePath);
        return;
      }
      uploadReport.failed.push({
        relativePath,
        stage: 'read',
        error: toErrorMessage(error),
      });
      console.warn(`[R2] Failed to read ${relativePath}: ${toErrorMessage(error)}`);
    }
  });

  await Promise.all(uploadPromises);
  if (uploadReport.failed.length > 0) {
    console.warn(
      `[R2] Upload completed with ${uploadReport.failed.length} failure(s): ${uploadReport.failed.map((entry) => entry.relativePath).join(', ')}`,
    );
  }
  return manifest;
}

/**
 * Get a presigned download URL for an R2 key.
 * Optionally sets Content-Disposition so the browser saves with a friendly filename.
 */
export async function getDownloadUrl(
  key: string,
  expiresInSeconds: number = 3600,
  responseContentDisposition?: string,
): Promise<string> {
  return getSignedDownloadUrl(key, expiresInSeconds, responseContentDisposition);
}

export function buildExportPackageBasePath(
  orgId: string,
  projectId: string,
  runId: string,
  platform: 'q' | 'wincross',
  packageId: string,
): string {
  return `${buildRunArtifactBasePath(orgId, projectId, runId)}/exports/${platform}/${packageId}`;
}

export function buildQExportPackageBasePath(
  orgId: string,
  projectId: string,
  runId: string,
  packageId: string,
): string {
  return buildExportPackageBasePath(orgId, projectId, runId, 'q', packageId);
}

export async function getDownloadUrlsForArtifactMap(
  files: Record<string, string>,
  expiresInSeconds: number = 3600,
): Promise<Record<string, string>> {
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b));
  const resolved = await Promise.all(
    entries.map(async ([relativePath, key]) => {
      const disposition = `attachment; filename="${path.basename(relativePath)}"`;
      const url = await getSignedDownloadUrl(key, expiresInSeconds, disposition);
      return [relativePath, url] as const;
    }),
  );
  return Object.fromEntries(resolved);
}

export async function uploadExportPackageArtifacts(
  orgId: string,
  projectId: string,
  runId: string,
  platform: 'q' | 'wincross',
  packageId: string,
  artifacts: Record<string, string | Buffer>,
): Promise<Record<string, string>> {
  const basePath = buildExportPackageBasePath(orgId, projectId, runId, platform, packageId);
  const uploaded: Record<string, string> = {};
  const entries = Object.entries(artifacts).sort(([a], [b]) => a.localeCompare(b));

  await Promise.all(entries.map(async ([relativePath, content]) => {
    const key = `${basePath}/${relativePath}`;
    const contentType = getContentType(relativePath);
    await uploadFile(key, content, contentType);
    uploaded[relativePath] = key;
    console.log(`[R2] Uploaded ${platform} export artifact: ${relativePath} → ${key}`);
  }));

  return uploaded;
}

export async function uploadQExportPackageArtifacts(
  orgId: string,
  projectId: string,
  runId: string,
  packageId: string,
  artifacts: Record<string, string | Buffer>,
): Promise<Record<string, string>> {
  return uploadExportPackageArtifacts(orgId, projectId, runId, 'q', packageId, artifacts);
}

export async function uploadWinCrossExportPackageArtifacts(
  orgId: string,
  projectId: string,
  runId: string,
  packageId: string,
  artifacts: Record<string, string | Buffer>,
): Promise<Record<string, string>> {
  return uploadExportPackageArtifacts(orgId, projectId, runId, 'wincross', packageId, artifacts);
}

/**
 * Download a file from R2 to a local path.
 * Creates parent directories as needed.
 */
export async function downloadToTemp(
  key: string,
  localPath: string,
): Promise<void> {
  const buffer = await downloadFile(key);
  await fs.mkdir(path.dirname(localPath), { recursive: true });
  await fs.writeFile(localPath, buffer);
}

// -------------------------------------------------------------------------
// Review State Persistence (HITL R2 backup)
// -------------------------------------------------------------------------

/** R2 keys for review state files, stored in Convex run.result.reviewR2Keys */
export interface ReviewR2Keys {
  reviewState?: string;      // crosstab-review-state.json
  pipelineSummary?: string;  // pipeline-summary.json
  pathBResult?: string;      // path-b-result.json
  /** @deprecated Path C is removed from active pipeline flow. Kept for backward compatibility. */
  pathCResult?: string;      // path-c-result.json
  spssInput?: string;        // original SPSS file (already in R2 from upload)
  // V3 artifacts required for post-review compute (container restart recovery)
  v3QuestionIdFinal?: string;  // enrichment/12-questionid-final.json (stage 12)
  v3TableEnriched?: string;    // tables/13e-table-enriched.json (stage 13e)
  v3TableJson?: string;        // tables/13d-table-canonical.json (stage 13d, backward compatibility)
  v3Checkpoint?: string;       // checkpoint.json (root of outputDir)
  dataFileSav?: string;        // dataFile.sav (root of outputDir, needed for R execution)
}

/**
 * Upload a single review file to R2.
 * Key pattern: {orgId}/{projectId}/runs/{runId}/review/{filename}
 * Returns the R2 key on success.
 */
export async function uploadReviewFile(
  orgId: string,
  projectId: string,
  runId: string,
  localFilePath: string,
  filename: string,
): Promise<string> {
  const buffer = await fs.readFile(localFilePath);
  const key = buildRunArtifactKey(orgId, projectId, runId, `review/${filename}`);
  const contentType = getContentType(filename);
  await uploadFile(key, buffer, contentType);
  console.log(`[R2] Uploaded review file: ${filename} → ${key}`);
  return key;
}

/**
 * Download all review files from R2 into a local directory.
 * SPSS goes into {localDir}/inputs/, JSON files go into root.
 * Returns map of logical name → local path for downloaded files.
 */
export async function downloadReviewFiles(
  reviewR2Keys: ReviewR2Keys,
  localOutputDir: string,
): Promise<Record<string, string>> {
  await fs.mkdir(localOutputDir, { recursive: true });
  const downloaded: Record<string, string> = {};

  const jsonFiles: Array<{ key: keyof ReviewR2Keys; filename: string; legacyFilename?: string }> = [
    { key: 'reviewState', filename: 'crosstab-review-state.json' },
    { key: 'pipelineSummary', filename: 'pipeline-summary.json' },
    // Path B result lives in stages/ subdirectory; Path C key is legacy-only
    { key: 'pathBResult', filename: 'stages/path-b-result.json' },
    { key: 'pathCResult', filename: 'stages/path-c-result.json' },
    // V3 artifacts needed for post-review compute (new paths + legacy fallback)
    { key: 'v3QuestionIdFinal', filename: 'enrichment/12-questionid-final.json', legacyFilename: 'stages/questionid-final.json' },
    { key: 'v3TableEnriched', filename: 'tables/13e-table-enriched.json', legacyFilename: 'tables/13d-table-canonical.json' },
    { key: 'v3TableJson', filename: 'tables/13d-table-canonical.json', legacyFilename: 'stages/table.json' },
    { key: 'v3Checkpoint', filename: 'checkpoint.json', legacyFilename: 'stages/v3-checkpoint.json' },
  ];

  for (const { key, filename, legacyFilename } of jsonFiles) {
    const r2Key = reviewR2Keys[key];
    if (!r2Key) continue;
    try {
      const localPath = path.join(localOutputDir, filename);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await downloadToTemp(r2Key, localPath);
      downloaded[key] = localPath;
      console.log(`[R2] Downloaded review file: ${filename}`);
    } catch (err) {
      // Fallback: try legacy path for runs that started before the directory restructure
      const fallbackFilename = legacyFilename || (filename.startsWith('stages/') ? filename.replace('stages/', '') : null);
      if (fallbackFilename) {
        try {
          const fallbackPath = path.join(localOutputDir, fallbackFilename);
          await fs.mkdir(path.dirname(fallbackPath), { recursive: true });
          await downloadToTemp(r2Key, fallbackPath);
          downloaded[key] = fallbackPath;
          console.log(`[R2] Downloaded review file (fallback): ${fallbackFilename}`);
          continue;
        } catch {
          // Both paths failed
        }
      }
      console.warn(`[R2] Failed to download review file ${filename}:`, err);
    }
  }

  // dataFile.sav goes into root of outputDir (needed for R execution)
  if (reviewR2Keys.dataFileSav) {
    try {
      const localPath = path.join(localOutputDir, 'dataFile.sav');
      await downloadToTemp(reviewR2Keys.dataFileSav, localPath);
      downloaded['dataFileSav'] = localPath;
      console.log('[R2] Downloaded dataFile.sav for R execution');
    } catch (err) {
      console.warn('[R2] Failed to download dataFile.sav:', err);
    }
  }

  // SPSS goes into inputs/ subdirectory
  if (reviewR2Keys.spssInput) {
    try {
      const inputsDir = path.join(localOutputDir, 'inputs');
      await fs.mkdir(inputsDir, { recursive: true });
      // Extract original filename from R2 key (last segment)
      const spssFilename = reviewR2Keys.spssInput.split('/').pop() || 'dataFile.sav';
      const localPath = path.join(inputsDir, spssFilename);
      await downloadToTemp(reviewR2Keys.spssInput, localPath);
      downloaded['spssInput'] = localPath;
      console.log(`[R2] Downloaded SPSS file: ${spssFilename}`);
    } catch (err) {
      console.warn('[R2] Failed to download SPSS file:', err);
    }
  }

  return downloaded;
}

/**
 * Delete review files from R2 after pipeline completion.
 * Skips spssInput key (shared with initial input upload).
 * Non-fatal — errors are logged but not thrown.
 */
export async function deleteReviewFiles(reviewR2Keys: ReviewR2Keys): Promise<void> {
  // Auto-enumerate all keys except spssInput (shared with initial input upload)
  const keysToDelete: string[] = [];
  for (const [field, value] of Object.entries(reviewR2Keys)) {
    if (field === 'spssInput') continue; // shared — do not delete
    if (typeof value === 'string' && value) keysToDelete.push(value);
  }

  for (const key of keysToDelete) {
    try {
      await deleteFile(key);
      console.log(`[R2] Deleted review file: ${key}`);
    } catch (err) {
      console.warn(`[R2] Failed to delete review file ${key}:`, err);
    }
  }
}

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case '.xlsx': return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.json': return 'application/json';
    case '.job': return 'text/plain';
    case '.qscript': return 'text/plain';
    case '.zip': return 'application/zip';
    case '.r': return 'text/plain';
    case '.md': return 'text/markdown';
    case '.log': return 'text/plain';
    case '.ndjson': return 'application/x-ndjson';
    case '.sav': return 'application/octet-stream';
    default: return 'application/octet-stream';
  }
}
