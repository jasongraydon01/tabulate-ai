import type {
  ExportManifestMetadata,
  ExportSupportReport,
  JobRoutingManifest,
  QExportManifest,
  QExportRuntimeContract,
  QExportPackageDescriptor,
  TableRoutingArtifact,
} from '@/lib/exportData/types';
import { CrosstabRawArtifactSchema, LoopSummaryArtifactSchema, ResultsTablesArtifactSchema, SortedFinalArtifactSchema } from '@/lib/exportData/inputArtifactSchemas';
import type { LoopSemanticsPolicy } from '@/schemas/loopSemanticsPolicySchema';
import {
  Q_EXPORT_HELPER_RUNTIME_HASH,
  Q_EXPORT_RUNTIME_CONTRACT_VERSION,
  Q_EXPORT_RUNTIME_ENGINE,
  Q_EXPORT_RUNTIME_MIN_Q_VERSION,
} from './runtimeContract';
import { z } from 'zod';

export const Q_EXPORT_MANIFEST_VERSION = 'q.phase2.native.v3';
export const Q_EXPORTER_VERSION = 'q-exporter.v17';

export const Q_EXPORT_RUNTIME_CONTRACT: QExportRuntimeContract = {
  engine: Q_EXPORT_RUNTIME_ENGINE,
  contractVersion: Q_EXPORT_RUNTIME_CONTRACT_VERSION,
  helperRuntimeHash: Q_EXPORT_HELPER_RUNTIME_HASH,
  minQVersion: Q_EXPORT_RUNTIME_MIN_Q_VERSION,
};

export interface QExportResolvedArtifacts {
  metadata: ExportManifestMetadata;
  tableRouting: TableRoutingArtifact;
  jobRoutingManifest: JobRoutingManifest;
  loopPolicy: LoopSemanticsPolicy | null;
  supportReport: ExportSupportReport;
  sortedFinal: z.infer<typeof SortedFinalArtifactSchema>;
  resultsTables: z.infer<typeof ResultsTablesArtifactSchema>;
  crosstabRaw: z.infer<typeof CrosstabRawArtifactSchema>;
  loopSummary: z.infer<typeof LoopSummaryArtifactSchema>;
  verboseDataMap: unknown[] | null;
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
    verboseDataMap?: string;
  };
}

export interface QExportPackageBuildResult {
  manifest: QExportManifest;
  qScript: string;
  readme: string;
  files: Record<string, string>;
  descriptor: QExportPackageDescriptor;
}

export interface QExportServiceInput {
  runId: string;
  orgId: string;
  projectId: string;
  runResult: Record<string, unknown>;
  existingDescriptor?: QExportPackageDescriptor | null;
}

export interface QExportServiceResult {
  descriptor: QExportPackageDescriptor;
  manifest: QExportManifest;
  downloadUrls: Record<string, string>;
  cached: boolean;
}

export class QExportServiceError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: string[];

  constructor(code: string, message: string, status: number, details: string[] = []) {
    super(message);
    this.name = 'QExportServiceError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
