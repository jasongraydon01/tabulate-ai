/**
 * Shared utility for building user-friendly download filenames.
 * Used by both the download API route (Content-Disposition) and the project page (UI display).
 */

/** Map internal filenames to user-friendly variant suffixes for download naming */
export const FILENAME_TO_VARIANT_SUFFIX: Record<string, string> = {
  'crosstabs.xlsx': '',
  'crosstabs-weighted.xlsx': ' (Weighted)',
  'crosstabs-unweighted.xlsx': ' (Unweighted)',
  'crosstabs-counts.xlsx': ' (Counts)',
  'crosstabs-weighted-counts.xlsx': ' (Weighted Counts)',
};

export function buildPackageDownloadFilename(
  projectName: string,
  timestampMs: number,
  relativePath: string,
): string | null {
  const normalized = relativePath.replace(/\\/g, '/');
  const sanitizedName = sanitizeFilename(projectName);
  const date = new Date(timestampMs).toISOString().split('T')[0];

  if (normalized === 'wincross/export.zip') {
    return `TabulateAI - ${sanitizedName} - ${date} (WinCross Export).zip`;
  }

  if (normalized === 'wincross/export.job') {
    return `TabulateAI - ${sanitizedName} - ${date} (WinCross).job`;
  }

  if (normalized === 'q/export.zip') {
    return `TabulateAI - ${sanitizedName} - ${date} (Q Export).zip`;
  }

  if (normalized === 'q/setup-project.QScript') {
    return `TabulateAI - ${sanitizedName} - ${date} (QScript).QScript`;
  }

  return null;
}

/**
 * Strip characters that are illegal in filenames across OS platforms.
 * Trims leading/trailing whitespace and dots.
 */
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, '');
}

/**
 * Build a user-friendly download filename.
 *
 * @param projectName - The project name (will be sanitized)
 * @param timestampMs - Creation/completion timestamp in milliseconds
 * @param internalFilename - The internal filename key (e.g. "crosstabs.xlsx")
 * @returns Filename like "TabulateAI - My Project - 2026-02-22.xlsx"
 */
export function buildDownloadFilename(
  projectName: string,
  timestampMs: number,
  internalFilename: string,
): string {
  const sanitizedName = sanitizeFilename(projectName);
  const date = new Date(timestampMs).toISOString().split('T')[0];
  const variantSuffix = FILENAME_TO_VARIANT_SUFFIX[internalFilename] ?? '';
  return `TabulateAI - ${sanitizedName} - ${date}${variantSuffix}.xlsx`;
}
