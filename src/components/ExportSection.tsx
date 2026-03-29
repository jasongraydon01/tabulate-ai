'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from 'convex/react';
import { toast } from 'sonner';
import {
  Archive,
  Download,
  FileCode2,
  FileSpreadsheet,
  Package2,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { ExportCard, type ExportAction } from '@/components/ExportCard';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { buildDownloadFilename } from '@/lib/utils/downloadFilename';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useAuthContext } from '@/providers/auth-provider';
import { api } from '../../convex/_generated/api';
import type { Id } from '../../convex/_generated/dataModel';

type ExportPlatform = 'q' | 'wincross';

interface ExportSectionProps {
  runId: string;
  projectId: string;
  projectName: string;
  runCreatedAt: number;
  status: string;
  expiredAt?: number;
  r2Outputs?: Record<string, string>;
  exportPackages?: Record<string, Record<string, unknown>>;
  exportReadiness?: Record<string, unknown>;
  exportErrors?: Array<{ format?: string; stage?: string; message?: string }>;
  requestedFormats: string[];
  defaultWinCrossProfileId?: string;
}

interface ExportSupportSummary {
  supported: number;
  warning: number;
  blocked: number;
}

interface ParsedDiagnostics {
  warnings: string[];
  errors: string[];
  encoding?: string;
  sectionNames: string[];
}

interface ParsedExportPackage {
  packageId?: string;
  generatedAt?: string;
  files: Record<string, string>;
  supportSummary?: ExportSupportSummary;
  blockedCount?: number;
  warningCount?: number;
  primaryDownloadPath?: string;
  archivePath?: string;
  entrypointPath?: string;
  parseDiagnostics?: ParsedDiagnostics;
}

interface GeneratedPackageResponse {
  descriptor?: Record<string, unknown>;
  supportSummary?: ExportSupportSummary;
  blockedCount?: number;
  warningCount?: number;
  parseDiagnostics?: ParsedDiagnostics;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

function parseSupportSummary(value: unknown): ExportSupportSummary | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  const supported = asNumber(record.supported);
  const warning = asNumber(record.warning);
  const blocked = asNumber(record.blocked);
  if (supported === undefined || warning === undefined || blocked === undefined) return undefined;
  return { supported, warning, blocked };
}

function parseDiagnostics(value: unknown): ParsedDiagnostics | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  return {
    warnings: asStringArray(record.warnings),
    errors: asStringArray(record.errors),
    encoding: asString(record.encoding),
    sectionNames: asStringArray(record.sectionNames),
  };
}

function parseExportPackage(value: Record<string, unknown> | undefined): ParsedExportPackage | undefined {
  if (!value) return undefined;

  const filesRecord = asRecord(value.files);
  const files = filesRecord
    ? Object.fromEntries(
      Object.entries(filesRecord).filter(([, entry]) => typeof entry === 'string'),
    ) as Record<string, string>
    : {};

  if (Object.keys(files).length === 0) return undefined;

  return {
    packageId: asString(value.packageId),
    generatedAt: asString(value.generatedAt),
    files,
    supportSummary: parseSupportSummary(value.supportSummary),
    blockedCount: asNumber(value.blockedCount),
    warningCount: asNumber(value.warningCount),
    primaryDownloadPath: asString(value.primaryDownloadPath),
    archivePath: asString(value.archivePath),
    entrypointPath: asString(value.entrypointPath),
    parseDiagnostics: parseDiagnostics(value.parseDiagnostics),
  };
}

function toDownloadHref(runId: string, relativePath: string): string {
  const encodedPath = relativePath
    .split('/')
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  return `/api/runs/${encodeURIComponent(runId)}/download/${encodedPath}`;
}

function isExportReady(exportReadiness: Record<string, unknown> | undefined): boolean {
  return asBoolean(asRecord(exportReadiness?.reexport)?.ready) === true;
}

function qPackageFromResponse(payload: GeneratedPackageResponse): ParsedExportPackage | undefined {
  const descriptor = asRecord(payload.descriptor);
  const parsed = parseExportPackage({
    ...(descriptor ?? {}),
    supportSummary: payload.supportSummary,
    blockedCount: payload.blockedCount,
    warningCount: payload.warningCount,
    primaryDownloadPath: 'q/setup-project.QScript',
    archivePath: asString(descriptor?.archivePath) ?? 'q/export.zip',
  });
  return parsed;
}

function wincrossPackageFromResponse(payload: GeneratedPackageResponse): ParsedExportPackage | undefined {
  const descriptor = asRecord(payload.descriptor);
  const parsed = parseExportPackage({
    ...(descriptor ?? {}),
    supportSummary: payload.supportSummary,
    blockedCount: payload.blockedCount,
    warningCount: payload.warningCount,
    primaryDownloadPath: asString(descriptor?.archivePath) ?? 'wincross/export.zip',
    archivePath: asString(descriptor?.archivePath) ?? 'wincross/export.zip',
    entrypointPath: asString(descriptor?.entrypointPath) ?? 'wincross/export.job',
    parseDiagnostics: payload.parseDiagnostics,
  });
  return parsed;
}

export function ExportSection({
  runId,
  projectId,
  projectName,
  runCreatedAt,
  status,
  expiredAt,
  r2Outputs,
  exportPackages,
  exportReadiness,
  exportErrors,
  requestedFormats: _requestedFormats,
  defaultWinCrossProfileId,
}: ExportSectionProps) {
  const { convexOrgId } = useAuthContext();

  const ready = isExportReady(exportReadiness);
  const profiles = useQuery(
    api.wincrossPreferenceProfiles.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<'organizations'> } : 'skip',
  );

  const initialQPackage = useMemo(
    () => parseExportPackage(asRecord(exportPackages?.q)),
    [exportPackages],
  );
  const initialWinCrossPackage = useMemo(
    () => parseExportPackage(asRecord(exportPackages?.wincross)),
    [exportPackages],
  );

  const [localQPackage, setLocalQPackage] = useState<ParsedExportPackage | undefined>(initialQPackage);
  const [localWinCrossPackage, setLocalWinCrossPackage] = useState<ParsedExportPackage | undefined>(initialWinCrossPackage);
  const [generating, setGenerating] = useState<Record<ExportPlatform, boolean>>({
    q: false,
    wincross: false,
  });
  const [selectedProfileId, setSelectedProfileId] = useState(defaultWinCrossProfileId ?? '__default__');

  const qPackage = localQPackage ?? initialQPackage;
  const wincrossPackage = localWinCrossPackage ?? initialWinCrossPackage;
  const availableProfiles = useMemo(() => Array.isArray(profiles) ? profiles : [], [profiles]);
  const resolvedProfileId = selectedProfileId || defaultWinCrossProfileId || '__default__';

  useEffect(() => {
    if (selectedProfileId) return;
    setSelectedProfileId(defaultWinCrossProfileId || '__default__');
  }, [availableProfiles, defaultWinCrossProfileId, selectedProfileId]);

  if (expiredAt) {
    return (
      <div className="rounded-lg border border-border bg-muted/30 p-6 text-center">
        <p className="text-sm font-medium">Artifacts expired</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Download files and export packages were removed after the 30-day retention period.
          Run history and metadata are still available.
        </p>
      </div>
    );
  }

  const excelOutputs = Object.keys(r2Outputs ?? {})
    .filter((path) => path.endsWith('.xlsx'))
    .sort();

  const sharedExportErrors = (exportErrors ?? []).filter((entry) => !entry.format || entry.format === 'shared');
  const canGenerate = status === 'success' || status === 'partial';

  async function generateExport(platform: ExportPlatform) {
    if (generating[platform]) return;

    setGenerating((current) => ({ ...current, [platform]: true }));
    try {
      const response = await fetch(`/api/runs/${encodeURIComponent(runId)}/exports/${platform}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: platform === 'wincross'
          ? JSON.stringify(
            resolvedProfileId !== '__default__'
              ? { profileId: resolvedProfileId }
              : { preferenceSource: 'default' },
          )
          : undefined,
      });

      const payload = await response.json().catch(() => ({} as GeneratedPackageResponse));
      if (!response.ok) {
        const message = typeof payload.message === 'string'
          ? payload.message
          : typeof payload.error === 'string'
            ? payload.error
            : `Failed to generate ${platform} export`;
        throw new Error(message);
      }

      if (platform === 'q') {
        setLocalQPackage(qPackageFromResponse(payload));
      } else {
        setLocalWinCrossPackage(wincrossPackageFromResponse(payload));
      }

      toast.success(
        platform === 'q' ? 'Q export ready' : 'WinCross export ready',
        {
          description: platform === 'q'
            ? 'The Q package was generated from the completed run.'
            : 'The WinCross package was generated from the completed run.',
        },
      );
    } catch (error) {
      toast.error(
        platform === 'q' ? 'Failed to generate Q export' : 'Failed to generate WinCross export',
        {
          description: error instanceof Error ? error.message : 'Unknown error',
        },
      );
    } finally {
      setGenerating((current) => ({ ...current, [platform]: false }));
    }
  }

  const qActions: ExportAction[] = qPackage
    ? [
      ...(qPackage.archivePath
        ? [{
          key: 'download-q-zip',
          label: 'Download ZIP',
          href: toDownloadHref(runId, qPackage.archivePath),
          tooltip: 'Complete package — QScript, data files, and setup instructions',
        }]
        : []),
      {
        key: 'download-qscript',
        label: 'Download QScript',
        href: toDownloadHref(runId, qPackage.primaryDownloadPath ?? 'q/setup-project.QScript'),
        variant: 'outline',
        tooltip: 'QScript file only — for importing directly into Q',
      },
      {
        key: 'regenerate-q',
        label: 'Regenerate',
        variant: 'outline',
        onClick: () => generateExport('q'),
        loading: generating.q,
      },
    ]
    : [
      {
        key: 'generate-q',
        label: 'Generate Q Export',
        onClick: () => generateExport('q'),
        loading: generating.q,
        disabled: !ready || !canGenerate,
      },
    ];

const winCrossActions: ExportAction[] = wincrossPackage
    ? [
      {
        key: 'download-wincross-zip',
        label: 'Download ZIP',
        href: toDownloadHref(runId, wincrossPackage.archivePath ?? wincrossPackage.primaryDownloadPath ?? 'wincross/export.zip'),
        tooltip: 'Complete package — .job file, data, and all supporting files',
      },
      {
        key: 'download-wincross-job',
        label: 'Download .job',
        href: toDownloadHref(runId, wincrossPackage.entrypointPath ?? 'wincross/export.job'),
        variant: 'outline',
        tooltip: '.job file only — for importing directly into WinCross',
      },
      {
        key: 'regenerate-wincross',
        label: 'Regenerate',
        variant: 'outline',
        onClick: () => generateExport('wincross'),
        loading: generating.wincross,
      },
    ]
    : [
      {
        key: 'generate-wincross',
        label: 'Generate WinCross Export',
        onClick: () => generateExport('wincross'),
        loading: generating.wincross,
        disabled: !ready || !canGenerate,
      },
    ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <ExportCard
          title="Excel"
          description="Primary TabulateAI workbooks from the completed run."
          icon={FileSpreadsheet}
          statusLabel={excelOutputs.length > 0 ? `${excelOutputs.length} workbook${excelOutputs.length === 1 ? '' : 's'} ready` : 'Not available yet'}
          statusTone={excelOutputs.length > 0 ? 'success' : 'muted'}
          actions={[]}
        >
          {excelOutputs.length > 0 ? (
            <div className="space-y-2">
              {excelOutputs.map((outputPath) => {
                const filename = outputPath.split('/').pop() ?? outputPath;
                const friendlyFilename = buildDownloadFilename(projectName, runCreatedAt, filename);
                return (
                  <a
                    key={outputPath}
                    href={toDownloadHref(runId, outputPath)}
                    download={friendlyFilename}
                    className="flex items-center justify-between gap-3 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{friendlyFilename}</p>
                      <p className="text-xs text-muted-foreground">{filename}</p>
                    </div>
                    <Badge variant="outline" className="shrink-0">
                      <Download className="mr-1 h-3 w-3" />
                      Download
                    </Badge>
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              {canGenerate ? 'No workbook files are currently available for this run.' : 'Workbook downloads are not available until the run completes.'}
            </p>
          )}
        </ExportCard>

        <ExportCard
          title="Q Export"
          description="Generate a Q starter package from the completed run without re-running the pipeline."
          icon={FileCode2}
          statusLabel={qPackage ? 'Package ready' : ready ? 'Ready to generate' : 'Waiting on export artifacts'}
          statusTone={qPackage ? 'success' : ready ? 'info' : 'warning'}
          blockedCount={qPackage?.supportSummary?.blocked}
          actions={qActions}
        >
          {qPackage?.packageId && (
            <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
              Package ID
              <InfoTooltip text={qPackage.packageId} />
            </p>
          )}
        </ExportCard>

        <ExportCard
          title="WinCross Export"
          description="Generate a WinCross package from the completed run using a saved org profile or the system default."
          icon={Archive}
          statusLabel={wincrossPackage ? 'Package ready' : ready ? 'Ready to generate' : 'Waiting on export artifacts'}
          statusTone={wincrossPackage ? 'success' : ready ? 'info' : 'warning'}
          blockedCount={wincrossPackage?.supportSummary?.blocked}
          actions={winCrossActions}
        >
          <div className="space-y-3">
            {wincrossPackage?.packageId && (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
                Package ID
                <InfoTooltip text={wincrossPackage.packageId} />
              </p>
            )}
            <div className="space-y-1.5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                WinCross profile
              </p>
              <Select value={resolvedProfileId} onValueChange={setSelectedProfileId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a WinCross profile" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__default__">TabulateAI default</SelectItem>
                  {availableProfiles.map((profile) => (
                    <SelectItem key={String(profile._id)} value={String(profile._id)}>
                      {profile.name}{profile.isDefault ? ' (Org default)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </ExportCard>
      </div>

      {sharedExportErrors.length > 0 && (
        <div className="rounded-lg border border-tab-amber/30 bg-tab-amber/5 p-4">
          <div className="mb-2 flex items-center gap-2">
            <Package2 className="h-4 w-4 text-tab-amber" />
            <p className="text-sm font-medium">Export readiness notes</p>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            {sharedExportErrors.map((entry, index) => (
              <p key={`${entry.stage ?? 'shared'}-${index}`}>
                {entry.message}
              </p>
            ))}
            <p>
              Run reference: <span className="font-mono">{projectId}/{runId}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
