import * as path from 'path';
import type { JobRoutingManifest, QExportBlockedItem } from '@/lib/exportData/types';
import type { SerializedTableStatus } from './serializer';

export function toWinCrossPackageDataFilePath(relativePath: string): string {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (normalized.startsWith('wincross/data/')) {
    return normalized;
  }
  if (normalized.startsWith('export/data/')) {
    return `wincross/${normalized.slice('export/'.length)}`;
  }
  if (normalized.startsWith('data/')) {
    return `wincross/${normalized}`;
  }
  return `wincross/data/${path.basename(normalized)}`;
}

export function toWinCrossJobDataFilePath(relativePath: string): string {
  const packagePath = toWinCrossPackageDataFilePath(relativePath);
  return packagePath.replace(/^wincross\//, '');
}

export function buildFrameDataPathMap(jobRouting: JobRoutingManifest | undefined): Record<string, string> {
  if (!jobRouting) return {};

  const entries = [...jobRouting.jobs]
    .sort((a, b) => a.dataFrameRef.localeCompare(b.dataFrameRef));

  const byFrame: Record<string, string> = {};
  for (const job of entries) {
    if (!byFrame[job.dataFrameRef]) {
      byFrame[job.dataFrameRef] = toWinCrossJobDataFilePath(job.dataFileRelativePath);
    }
  }
  return byFrame;
}

export function buildBlockedItemsFromTableStatuses(tableStatuses: SerializedTableStatus[]): QExportBlockedItem[] {
  return tableStatuses
    .filter((status) => status.semanticExportStatus === 'blocked')
    .map((status) => ({
      itemType: 'table' as const,
      itemId: status.tableId,
      reasonCodes: ['serializer_blocked'],
      detail: status.warnings.join(' ') || 'Serializer could not produce a valid WinCross representation.',
    }));
}
