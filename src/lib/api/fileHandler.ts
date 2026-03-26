import { runAllGuardrails } from '@/guardrails/inputValidation';
import { saveUploadedFile } from '@/lib/storage';
import { uploadInputFile } from '@/lib/r2/R2FileManager';
import type { SavedFilePaths, ParsedWizardFiles, SavedWizardPaths } from './types';

// ---------------------------------------------------------------------------
// Per-file size limits (bytes)
// ---------------------------------------------------------------------------
const FILE_SIZE_LIMITS = {
  dataFile:    100 * 1024 * 1024, // 100 MB — .sav files can be large
  dataMap:      25 * 1024 * 1024, // 25 MB
  survey:       25 * 1024 * 1024, // 25 MB — PDF/DOCX
  bannerPlan:   25 * 1024 * 1024, // 25 MB — PDF/DOCX/XLSX
  messageList:  10 * 1024 * 1024, // 10 MB
} as const;

function mbString(bytes: number): string {
  return `${Math.round(bytes / 1024 / 1024)}MB`;
}

/**
 * Check a single file against its size limit.
 * Returns an error string if oversized, or null if OK.
 */
function checkFileSize(file: File, limitKey: keyof typeof FILE_SIZE_LIMITS, label: string): string | null {
  const limit = FILE_SIZE_LIMITS[limitKey];
  if (file.size > limit) {
    return `${label} is too large (${mbString(file.size)}). Maximum is ${mbString(limit)}.`;
  }
  return null;
}

/** Thrown when an uploaded file exceeds its per-type size limit. */
export class FileSizeLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FileSizeLimitError';
  }
}

export interface ParsedUploadData {
  dataMapFile: File;
  bannerPlanFile: File;
  dataFile: File;
  surveyFile: File | null;
  loopStatTestingMode: 'suppress' | 'complement' | undefined;
}

/**
 * Parse upload form data into typed file objects.
 * Returns null if required files are missing.
 * Throws with a descriptive message if any file exceeds its size limit.
 */
export function parseUploadFormData(formData: FormData): ParsedUploadData | null {
  const dataMapFile = formData.get('dataMap') as File | null;
  const bannerPlanFile = formData.get('bannerPlan') as File | null;
  const dataFile = formData.get('dataFile') as File | null;
  const surveyFile = formData.get('surveyDocument') as File | null;
  const loopStatTestingRaw = formData.get('loopStatTestingMode');
  const loopStatTestingMode =
    loopStatTestingRaw === 'suppress' || loopStatTestingRaw === 'complement'
      ? loopStatTestingRaw
      : undefined;

  if (!dataMapFile || !bannerPlanFile || !dataFile) return null;

  // Per-file size limits
  const sizeErrors = [
    checkFileSize(dataFile, 'dataFile', 'Data file (.sav)'),
    checkFileSize(dataMapFile, 'dataMap', 'Data map'),
    checkFileSize(bannerPlanFile, 'bannerPlan', 'Banner plan'),
    surveyFile ? checkFileSize(surveyFile, 'survey', 'Survey document') : null,
  ].filter(Boolean);

  if (sizeErrors.length > 0) {
    throw new FileSizeLimitError(sizeErrors.join(' '));
  }

  return { dataMapFile, bannerPlanFile, dataFile, surveyFile, loopStatTestingMode };
}

/**
 * Run input guardrails on uploaded files.
 */
export async function validateUploadedFiles(files: {
  dataMap: File;
  bannerPlan: File;
  dataFile: File;
}): Promise<{ success: boolean; errors: string[]; warnings: string[] }> {
  return runAllGuardrails(files);
}

/**
 * Save uploaded files to temporary storage and return paths.
 * If r2Scope is provided, also uploads to R2 in parallel.
 * Throws if any file save fails.
 */
export async function saveFilesToStorage(
  data: ParsedUploadData,
  sessionId: string,
  _r2Scope?: { orgId: string; projectId: string },
): Promise<SavedFilePaths> {
  const { dataMapFile, bannerPlanFile, dataFile, surveyFile } = data;

  const fileSavePromises = [
    saveUploadedFile(dataMapFile, sessionId, `dataMap.${dataMapFile.name.split('.').pop()}`),
    saveUploadedFile(bannerPlanFile, sessionId, `bannerPlan.${bannerPlanFile.name.split('.').pop()}`),
    saveUploadedFile(dataFile, sessionId, `dataFile.${dataFile.name.split('.').pop()}`),
  ];

  if (surveyFile) {
    fileSavePromises.push(
      saveUploadedFile(surveyFile, sessionId, `survey.${surveyFile.name.split('.').pop()}`)
    );
  }

  const fileResults = await Promise.all(fileSavePromises);

  const failedSaves = fileResults.filter(r => !r.success);
  if (failedSaves.length > 0) {
    throw new Error(`Failed to save uploaded files: ${failedSaves.map(r => r.error).join(', ')}`);
  }

  const result: SavedFilePaths = {
    dataMapPath: fileResults[0].filePath!,
    bannerPlanPath: fileResults[1].filePath!,
    spssPath: fileResults[2].filePath!,
    surveyPath: surveyFile ? fileResults[3]?.filePath ?? null : null,
  };

  // Input files are no longer uploaded to R2 (cost optimization).
  // Users already have these files locally, and pipeline only needs temp storage during execution.
  // If needed for re-runs, users can re-upload (same UX as creating a new project).

  return result;
}

/** @deprecated Input files are no longer uploaded to R2. Function kept for backward compatibility. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function uploadInputToR2(file: File, orgId: string, projectId: string): Promise<string> {
  const buffer = Buffer.from(await file.arrayBuffer());
  return uploadInputFile(orgId, projectId, buffer, file.name);
}

// =============================================================================
// Wizard-specific file handling (Phase 3.3)
// =============================================================================

/**
 * Parse wizard FormData into typed file objects.
 * The wizard does NOT require a datamap (the .sav IS the datamap).
 * Returns null if required files are missing.
 * Throws with a descriptive message if any file exceeds its size limit.
 */
export function parseWizardFormData(formData: FormData): ParsedWizardFiles | null {
  const dataFile = formData.get('dataFile') as File | null;
  const surveyFile = formData.get('surveyDocument') as File | null;
  const bannerPlanFile = formData.get('bannerPlan') as File | null;
  const messageListFile = formData.get('messageList') as File | null;

  if (!dataFile || !surveyFile) return null;

  // Per-file size limits
  const sizeErrors = [
    checkFileSize(dataFile, 'dataFile', 'Data file (.sav)'),
    checkFileSize(surveyFile, 'survey', 'Survey document'),
    bannerPlanFile ? checkFileSize(bannerPlanFile, 'bannerPlan', 'Banner plan') : null,
    messageListFile ? checkFileSize(messageListFile, 'messageList', 'Message list') : null,
  ].filter(Boolean);

  if (sizeErrors.length > 0) {
    throw new FileSizeLimitError(sizeErrors.join(' '));
  }

  return { dataFile, surveyFile, bannerPlanFile, messageListFile };
}

/**
 * Save wizard files to temporary storage and return paths.
 * If r2Scope is provided, also uploads to R2 in parallel.
 */
export async function saveWizardFilesToStorage(
  data: ParsedWizardFiles,
  sessionId: string,
  _r2Scope?: { orgId: string; projectId: string },
): Promise<SavedWizardPaths> {
  const { dataFile, surveyFile, bannerPlanFile, messageListFile } = data;

  const fileSavePromises = [
    saveUploadedFile(dataFile, sessionId, `dataFile.${dataFile.name.split('.').pop()}`),
    saveUploadedFile(surveyFile, sessionId, `survey.${surveyFile.name.split('.').pop()}`),
  ];

  if (bannerPlanFile) {
    fileSavePromises.push(
      saveUploadedFile(bannerPlanFile, sessionId, `bannerPlan.${bannerPlanFile.name.split('.').pop()}`)
    );
  }
  if (messageListFile) {
    fileSavePromises.push(
      saveUploadedFile(messageListFile, sessionId, `messageList.${messageListFile.name.split('.').pop()}`)
    );
  }

  const fileResults = await Promise.all(fileSavePromises);

  const failedSaves = fileResults.filter(r => !r.success);
  if (failedSaves.length > 0) {
    throw new Error(`Failed to save uploaded files: ${failedSaves.map(r => r.error).join(', ')}`);
  }

  let nextIdx = 2; // 0 = dataFile, 1 = survey
  const result: SavedWizardPaths = {
    spssPath: fileResults[0].filePath!,
    surveyPath: fileResults[1].filePath!,
    bannerPlanPath: bannerPlanFile ? fileResults[nextIdx++]?.filePath ?? null : null,
    messageListPath: messageListFile ? fileResults[nextIdx++]?.filePath ?? null : null,
  };

  // Input files are no longer uploaded to R2 (cost optimization).
  // Users already have these files locally, and pipeline only needs temp storage during execution.
  // If needed for re-runs, users can re-upload (same UX as creating a new project).

  return result;
}

/**
 * Sanitize dataset name for use in file paths.
 */
export function sanitizeDatasetName(filename: string): string {
  return filename
    .replace(/\.(sav|csv|xlsx?)$/i, '')
    .replace(/[^a-zA-Z0-9-_]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}
