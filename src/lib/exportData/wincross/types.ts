import type {
  ExportManifestMetadata,
  ExportSupportReport,
  JobRoutingManifest,
  TableRoutingArtifact,
  WinCrossExportManifest,
  WinCrossExportPackageDescriptor,
  WinCrossParseDiagnostics,
  WinCrossPreferenceProfile,
} from '@/lib/exportData/types';
import {
  CrosstabRawArtifactSchema,
  LoopSummaryArtifactSchema,
  ResultsTablesArtifactSchema,
  SortedFinalArtifactSchema,
} from '@/lib/exportData/inputArtifactSchemas';
import type { LoopSemanticsPolicy } from '@/schemas/loopSemanticsPolicySchema';
import type { WinCrossPreferenceSource, WinCrossResolvedPreference } from './preferenceResolver';
import { z } from 'zod';

export const WINCROSS_EXPORT_MANIFEST_VERSION = 'wincross.phase1.v1';
export const WINCROSS_EXPORTER_VERSION = 'wincross-exporter.v1';
export const WINCROSS_SERIALIZER_CONTRACT_VERSION = 'wincross-serializer.v8';

export interface WinCrossResolvedArtifacts {
  metadata: ExportManifestMetadata;
  tableRouting: TableRoutingArtifact;
  jobRoutingManifest: JobRoutingManifest;
  loopPolicy: LoopSemanticsPolicy | null;
  supportReport: ExportSupportReport;
  sortedFinal: z.infer<typeof SortedFinalArtifactSchema>;
  resultsTables: z.infer<typeof ResultsTablesArtifactSchema>;
  crosstabRaw: z.infer<typeof CrosstabRawArtifactSchema>;
  loopSummary: z.infer<typeof LoopSummaryArtifactSchema>;
  r2Keys: {
    metadata: string;
    tableRouting: string;
    jobRoutingManifest: string;
    loopPolicy: string;
    supportReport: string;
    sortedFinal: string;
    resultsTables: string;
    crosstabRaw: string;
    loopSummary: string;
  };
}

export interface WinCrossServiceInput {
  runId: string;
  orgId: string;
  projectId: string;
  runResult: Record<string, unknown>;
  existingDescriptor?: WinCrossExportPackageDescriptor | null;
  preferenceSource: WinCrossPreferenceSource;
}

export interface WinCrossServiceResult {
  descriptor: WinCrossExportPackageDescriptor;
  manifest: WinCrossExportManifest;
  downloadUrls: Record<string, string>;
  cached: boolean;
  profile: WinCrossPreferenceProfile;
  diagnostics: WinCrossParseDiagnostics;
  resolvedPreference: WinCrossResolvedPreference;
}

export class WinCrossExportServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string[];

  constructor(code: string, message: string, status: number, details: string[] = []) {
    super(message);
    this.name = 'WinCrossExportServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
