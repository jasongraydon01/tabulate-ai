/**
 * File Discovery
 *
 * Discovers required files in a dataset folder.
 */

import fs from 'fs/promises';
import path from 'path';
import type { DatasetFiles } from './types';
import type { DatasetIntakeConfig } from '@/lib/v3/runtime/questionId/types';

export const DEFAULT_DATASET = 'data/sample-dataset';

/**
 * Find required files in a dataset folder
 *
 * Supports nested structure:
 *   dataset-folder/
 *   ├── inputs/           # Input files go here
 *   ├── tabs/             # Reference output (reference tabs)
 *   └── golden-datasets/  # For evaluation framework
 */
export async function findDatasetFiles(folder: string): Promise<DatasetFiles> {
  const absFolder = path.isAbsolute(folder) ? folder : path.join(process.cwd(), folder);

  // Check for nested structure (inputs/ subfolder)
  let inputsFolder = absFolder;
  try {
    const subfolders = await fs.readdir(absFolder);
    if (subfolders.includes('inputs')) {
      inputsFolder = path.join(absFolder, 'inputs');
    }
  } catch {
    // Continue with absFolder
  }

  const files = await fs.readdir(inputsFolder);

  // Filter out Office temp files (~$...) before searching
  const validFiles = files.filter(f => !f.startsWith('~$'));

  // Find datamap CSV (optional — .sav is the source of truth)
  const datamapFile = validFiles.find(f =>
    f.toLowerCase().includes('datamap') && f.endsWith('.csv')
  );
  const datamap = datamapFile ? path.join(inputsFolder, datamapFile) : null;

  // Find banner plan (prefer 'adjusted' > 'clean' > original)
  let banner = validFiles.find(f =>
    f.toLowerCase().includes('banner') &&
    f.toLowerCase().includes('adjusted') &&
    (f.endsWith('.docx') || f.endsWith('.pdf'))
  );
  if (!banner) {
    banner = validFiles.find(f =>
      f.toLowerCase().includes('banner') &&
      f.toLowerCase().includes('clean') &&
      (f.endsWith('.docx') || f.endsWith('.pdf'))
    );
  }
  if (!banner) {
    banner = validFiles.find(f =>
      f.toLowerCase().includes('banner') &&
      (f.endsWith('.docx') || f.endsWith('.pdf'))
    );
  }
  // banner may be null — AI will generate cuts from datamap when missing

  // Find SPSS file
  const spss = validFiles.find(f => f.endsWith('.sav'));
  if (!spss) {
    throw new Error(`No SPSS file found in ${folder}. Expected .sav file.`);
  }

  // Find survey/questionnaire document (required for SkipLogicAgent + VerificationAgent)
  // Priority: 1) file with 'survey', 'questionnaire', 'qre', or 'qnr', 2) .docx that's not a banner plan
  let survey = validFiles.find(f => {
    const lower = f.toLowerCase();
    return (lower.includes('survey') || lower.includes('questionnaire') || lower.includes('qre') || lower.includes('qnr')) &&
      (f.endsWith('.docx') || f.endsWith('.pdf'));
  });
  if (!survey) {
    // Fall back to any .docx that's not a banner plan (likely the main survey document)
    survey = validFiles.find(f =>
      f.endsWith('.docx') &&
      !f.toLowerCase().includes('banner')
    );
  }

  // Derive dataset name from folder (use the main folder, not inputs/)
  const name = path.basename(absFolder);

  return {
    datamap,
    banner: banner ? path.join(inputsFolder, banner) : null,
    spss: path.join(inputsFolder, spss),
    survey: survey ? path.join(inputsFolder, survey) : null,
    name,
  };
}

/**
 * Load dataset intake configuration from `intake.json` in the dataset folder.
 *
 * This file mirrors what the UI intake form would produce — survey-level metadata
 * like message testing flags, MaxDiff presence, demand survey classification, etc.
 *
 * Returns null if no intake.json exists (defaults apply).
 */
export async function loadDatasetIntakeConfig(
  folder: string,
): Promise<DatasetIntakeConfig | null> {
  const absFolder = path.isAbsolute(folder) ? folder : path.join(process.cwd(), folder);
  const intakePath = path.join(absFolder, 'intake.json');

  try {
    const raw = await fs.readFile(intakePath, 'utf-8');
    const parsed = JSON.parse(raw) as DatasetIntakeConfig;
    return parsed;
  } catch {
    // No intake.json — defaults apply
    return null;
  }
}
