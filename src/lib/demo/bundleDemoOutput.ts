/**
 * Bundles demo pipeline output files for email attachment.
 *
 * Returns:
 *   - Excel files as standalone attachments (not zipped)
 *   - Q export as a zip (script + data file + manifest) — if Q was selected
 *   - WinCross export as a zip (job + data file + manifest) — if WinCross was selected
 */

import { promises as fs } from 'fs';
import path from 'path';
import { createDeterministicArchive, type ArchiveEntry } from '@/lib/exportData/archiveWriter';

export interface DemoAttachment {
  filename: string;
  content: Buffer;
}

export interface DemoBundleResult {
  /** Standalone Excel attachments */
  excelAttachments: DemoAttachment[];
  /** Q export zip (null if no Q export) */
  qZip: DemoAttachment | null;
  /** WinCross export zip (null if no WinCross export) */
  wincrossZip: DemoAttachment | null;
  /** Total file count across all attachments */
  totalFileCount: number;
}

export async function bundleDemoOutput(
  outputDir: string,
  projectName: string,
): Promise<DemoBundleResult> {
  const safeName = projectName.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'demo';

  // 1. Collect Excel files as standalone attachments
  const excelAttachments: DemoAttachment[] = [];
  const resultsDir = path.join(outputDir, 'results');
  try {
    const files = await fs.readdir(resultsDir);
    for (const file of files) {
      if (file.endsWith('.xlsx')) {
        const buf = await fs.readFile(path.join(resultsDir, file));
        excelAttachments.push({ filename: file, content: buf });
      }
    }
  } catch {
    // results/ doesn't exist
  }

  // 2. Build Q export zip (script + data + manifest)
  let qZip: DemoAttachment | null = null;
  const qEntries: ArchiveEntry[] = [];

  // Q script — check both locations (local export path and results path)
  await collectFiles(path.join(outputDir, 'export', 'q'), '.qs', 'q/', qEntries);
  await collectFiles(resultsDir, '.qscript', 'q/', qEntries);

  // Q manifest
  await collectFiles(path.join(outputDir, 'export'), 'q-export-manifest.local.json', '', qEntries, true);

  if (qEntries.length > 0) {
    // Include wide.sav data file
    await addDataFile(outputDir, 'data/', qEntries);
    const archive = await createDeterministicArchive(qEntries);
    qZip = {
      filename: `${safeName}-q-export.zip`,
      content: archive.buffer,
    };
  }

  // 3. Build WinCross export zip (job + data + manifest)
  let wincrossZip: DemoAttachment | null = null;
  const wcEntries: ArchiveEntry[] = [];

  // WinCross job — check both locations
  await collectFiles(path.join(outputDir, 'export', 'wincross'), '.job', 'wincross/', wcEntries);
  await collectFiles(resultsDir, '.job', 'wincross/', wcEntries);

  // WinCross manifest
  await collectFiles(path.join(outputDir, 'export'), 'wincross-export-manifest.local.json', '', wcEntries, true);

  if (wcEntries.length > 0) {
    // Include wide.sav data file
    await addDataFile(outputDir, 'data/', wcEntries);
    const archive = await createDeterministicArchive(wcEntries);
    wincrossZip = {
      filename: `${safeName}-wincross-export.zip`,
      content: archive.buffer,
    };
  }

  const totalFileCount =
    excelAttachments.length +
    (qZip ? qEntries.length : 0) +
    (wincrossZip ? wcEntries.length : 0);

  if (totalFileCount === 0) {
    throw new Error('No output files found to bundle');
  }

  return { excelAttachments, qZip, wincrossZip, totalFileCount };
}

/** Collect files by extension from a directory. */
async function collectFiles(
  dir: string,
  extOrName: string,
  prefix: string,
  entries: ArchiveEntry[],
  exactMatch = false,
): Promise<void> {
  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      const match = exactMatch ? file === extOrName : file.endsWith(extOrName);
      if (match) {
        const buf = await fs.readFile(path.join(dir, file));
        entries.push({ relativePath: `${prefix}${file}`, content: buf });
      }
    }
  } catch {
    // Directory doesn't exist — fine
  }
}

/** Add wide.sav data file to entries if it exists. */
async function addDataFile(
  outputDir: string,
  prefix: string,
  entries: ArchiveEntry[],
): Promise<void> {
  const candidates = [
    path.join(outputDir, 'export', 'data', 'wide.sav'),
    path.join(outputDir, 'dataFile.sav'),
  ];
  for (const candidate of candidates) {
    try {
      const buf = await fs.readFile(candidate);
      entries.push({ relativePath: `${prefix}wide.sav`, content: buf });
      return;
    } catch {
      // Try next candidate
    }
  }
}
