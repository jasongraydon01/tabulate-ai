'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery } from 'convex/react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, FlaskConical, Play, Trash2, Check, X, CircleDot, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { AppBreadcrumbs } from '@/components/app-breadcrumbs';
import { ConfirmDestructiveDialog } from '@/components/confirm-destructive-dialog';
import { useAuthContext } from '@/providers/auth-provider';
import { canPerform } from '@/lib/permissions';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import {
  LOAD_TEST_SEPARATOR,
  type TestDatasetManifest,
  type TestDatasetEntry,
  type LoadTestLaunchResult,
} from '@/lib/loadTest/types';

// ---------------------------------------------------------------------------
// Types for monitoring
// ---------------------------------------------------------------------------

type RunStatus = 'in_progress' | 'pending_review' | 'resuming' | 'success' | 'partial' | 'error' | 'cancelled';

interface MonitoredProject {
  projectId: string;
  projectName: string;
  datasetName: string;
  runStatus: RunStatus;
  runStage?: string;
  runProgress?: number;
  runMessage?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Helper Components
// ---------------------------------------------------------------------------

function DatasetRow({
  dataset,
  selected,
  onToggle,
}: {
  dataset: TestDatasetEntry;
  selected: boolean;
  onToggle: () => void;
}) {
  const totalMB = dataset.files.reduce((s, f) => s + f.sizeBytes, 0) / 1024 / 1024;

  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={!dataset.ready}
      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors ${
        !dataset.ready
          ? 'opacity-40 cursor-not-allowed'
          : selected
            ? 'bg-tab-blue/10 border border-tab-blue/30'
            : 'hover:bg-muted/50 border border-transparent'
      }`}
    >
      <div
        className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-colors ${
          selected ? 'bg-tab-blue border-tab-blue' : 'border-muted-foreground/30'
        }`}
      >
        {selected && <Check className="w-3 h-3 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-mono text-sm truncate block">{dataset.name}</span>
      </div>
      <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
        {dataset.hasBanner && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            banner
          </Badge>
        )}
        <span>{totalMB.toFixed(1)} MB</span>
      </div>
    </button>
  );
}

function statusColor(status: RunStatus): string {
  switch (status) {
    case 'in_progress':
    case 'resuming':
      return 'text-tab-blue';
    case 'pending_review':
      return 'text-tab-amber';
    case 'success':
      return 'text-tab-teal';
    case 'error':
    case 'cancelled':
      return 'text-tab-rose';
    case 'partial':
      return 'text-tab-amber';
    default:
      return 'text-muted-foreground';
  }
}

function statusBadgeVariant(status: RunStatus) {
  switch (status) {
    case 'in_progress':
    case 'resuming':
      return 'default' as const;
    case 'pending_review':
      return 'secondary' as const;
    case 'success':
      return 'default' as const;
    case 'error':
    case 'cancelled':
      return 'destructive' as const;
    default:
      return 'outline' as const;
  }
}

function ProjectStatusRow({ project }: { project: MonitoredProject }) {
  const isActive = project.runStatus === 'in_progress' || project.runStatus === 'resuming';

  return (
    <div className="flex items-center gap-3 px-3 py-2 border-b border-border/50 last:border-0">
      <div className="flex-shrink-0 w-5">
        {isActive ? (
          <Loader2 className={`w-4 h-4 animate-spin ${statusColor(project.runStatus)}`} />
        ) : (
          <CircleDot className={`w-4 h-4 ${statusColor(project.runStatus)}`} />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="font-mono text-sm truncate block">{project.datasetName}</span>
        <span className="text-xs text-muted-foreground truncate block">
          {project.runMessage || project.runStage || ''}
        </span>
      </div>
      {isActive && project.runProgress !== undefined && (
        <div className="w-20 shrink-0">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-tab-blue rounded-full transition-all duration-500"
              style={{ width: `${project.runProgress}%` }}
            />
          </div>
          <span className="text-[10px] text-muted-foreground mt-0.5 block text-right">
            {project.runProgress}%
          </span>
        </div>
      )}
      <Badge variant={statusBadgeVariant(project.runStatus)} className="shrink-0 text-xs">
        {project.runStatus.replace('_', ' ')}
      </Badge>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function LoadTestPage() {
  const { convexOrgId, role } = useAuthContext();
  const isAdmin = canPerform(role, 'delete_project');

  // Dataset manifest
  const [manifest, setManifest] = useState<TestDatasetManifest | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [manifestError, setManifestError] = useState<string | null>(null);

  // Selection state
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set());

  // Launch config
  const now = new Date();
  const defaultPrefix = `Load Test ${now.getMonth() + 1}/${now.getDate()}`;
  const [namePrefix, setNamePrefix] = useState(defaultPrefix);
  const [concurrency, setConcurrency] = useState<string>('3');
  const [launching, setLaunching] = useState(false);
  const [launchResult, setLaunchResult] = useState<LoadTestLaunchResult | null>(null);

  // Elapsed timer
  const [launchStartTime, setLaunchStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup
  const [showCleanup, setShowCleanup] = useState(false);
  const [cleanupCount, setCleanupCount] = useState(0);

  // Convex queries for monitoring
  const allProjects = useQuery(
    api.projects.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<'organizations'> } : 'skip',
  );
  const allRuns = useQuery(
    api.runs.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<'organizations'> } : 'skip',
  );

  // Filter to load test projects
  const loadTestProjects = useMemo<MonitoredProject[]>(() => {
    if (!allProjects || !allRuns || !namePrefix) return [];

    const prefix = `${namePrefix}${LOAD_TEST_SEPARATOR}`;
    const matching = allProjects.filter(p => p.name.startsWith(prefix));

    return matching.map(project => {
      const run = allRuns.find(r => String(r.projectId) === String(project._id));
      const datasetName = project.name.slice(prefix.length);

      return {
        projectId: String(project._id),
        projectName: project.name,
        datasetName,
        runStatus: (run?.status ?? 'in_progress') as RunStatus,
        runStage: run?.stage ?? undefined,
        runProgress: run?.progress ?? undefined,
        runMessage: run?.message ?? undefined,
      };
    });
  }, [allProjects, allRuns, namePrefix]);

  // Count by status for monitoring panel
  const statusCounts = useMemo(() => {
    const counts = { running: 0, pending_review: 0, completed: 0, failed: 0 };
    for (const p of loadTestProjects) {
      if (p.runStatus === 'in_progress' || p.runStatus === 'resuming') counts.running++;
      else if (p.runStatus === 'pending_review') counts.pending_review++;
      else if (p.runStatus === 'success' || p.runStatus === 'partial') counts.completed++;
      else if (p.runStatus === 'error' || p.runStatus === 'cancelled') counts.failed++;
    }
    return counts;
  }, [loadTestProjects]);

  // Update cleanup count when prefix or projects change
  useEffect(() => {
    if (!allProjects || !namePrefix) {
      setCleanupCount(0);
      return;
    }
    const prefix = `${namePrefix}${LOAD_TEST_SEPARATOR}`;
    setCleanupCount(allProjects.filter(p => p.name.startsWith(prefix)).length);
  }, [allProjects, namePrefix]);

  // Elapsed timer: tick while runs are in-progress
  useEffect(() => {
    if (launchStartTime && statusCounts.running > 0) {
      timerRef.current = setInterval(() => {
        setElapsed(Date.now() - launchStartTime);
      }, 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      // Final update
      if (launchStartTime) setElapsed(Date.now() - launchStartTime);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [launchStartTime, statusCounts.running]);

  // Fetch manifest on mount
  useEffect(() => {
    if (!isAdmin) return;

    fetch('/api/dev/load-test/datasets')
      .then(async (res) => {
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || `HTTP ${res.status}`);
        }
        return res.json();
      })
      .then((data: TestDatasetManifest) => {
        setManifest(data);
        setManifestError(null);
      })
      .catch((err) => {
        setManifestError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => setManifestLoading(false));
  }, [isAdmin]);

  // Selection helpers
  const toggleDataset = useCallback((name: string) => {
    setSelectedDatasets(prev => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    if (!manifest) return;
    setSelectedDatasets(new Set(manifest.datasets.filter(d => d.ready).map(d => d.name)));
  }, [manifest]);

  const selectNone = useCallback(() => {
    setSelectedDatasets(new Set());
  }, []);

  // Launch handler
  const handleLaunch = useCallback(async () => {
    if (selectedDatasets.size === 0) return;

    setLaunching(true);
    setLaunchResult(null);
    setLaunchStartTime(Date.now());
    setElapsed(0);

    try {
      const res = await fetch('/api/dev/load-test/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          datasets: Array.from(selectedDatasets),
          concurrency: parseInt(concurrency, 10),
          namePrefix,
        }),
      });

      const data: LoadTestLaunchResult = await res.json();

      if (!res.ok) {
        toast.error('Launch failed', { description: (data as unknown as { error: string }).error });
        return;
      }

      setLaunchResult(data);

      if (data.totalLaunched > 0) {
        toast.success(`Launched ${data.totalLaunched} pipeline(s)`, {
          description: data.totalErrors > 0
            ? `${data.totalErrors} failed to launch`
            : undefined,
        });
      } else {
        toast.error('No pipelines launched', {
          description: data.errors.map(e => `${e.dataset}: ${e.error}`).join(', '),
        });
      }
    } catch (err) {
      toast.error('Launch request failed', {
        description: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setLaunching(false);
    }
  }, [selectedDatasets, concurrency, namePrefix]);

  // Cleanup handler
  const handleCleanup = useCallback(async () => {
    try {
      const res = await fetch('/api/dev/load-test/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ namePrefix }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error('Cleanup failed', { description: data.error });
        throw new Error(data.error);
      }

      toast.success(`Deleted ${data.projectsDeleted} project(s)`);
      setShowCleanup(false);
      setLaunchResult(null);
      setLaunchStartTime(null);
      setElapsed(0);
    } catch (err) {
      toast.error('Cleanup failed', {
        description: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }, [namePrefix]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!isAdmin) {
    return (
      <div>
        <AppBreadcrumbs segments={[{ label: 'Dev' }, { label: 'Load Test' }]} />
        <div className="mt-6 max-w-2xl">
          <Card>
            <CardContent className="p-6">
              <p className="text-sm text-muted-foreground">
                Admin access required. Contact your organization admin.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppBreadcrumbs segments={[{ label: 'Dev' }, { label: 'Load Test' }]} />

      <div className="mt-6 max-w-3xl space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <FlaskConical className="h-6 w-6 text-tab-indigo" />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Load Test</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Launch multiple pipelines concurrently to test system limits.
            </p>
          </div>
        </div>

        {/* Dataset Selector */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Datasets</CardTitle>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll} disabled={!manifest}>
                  Select All
                </Button>
                <Button variant="ghost" size="sm" onClick={selectNone} disabled={selectedDatasets.size === 0}>
                  Select None
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {manifestLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : manifestError ? (
              <div className="text-sm text-tab-rose py-4">
                {manifestError}
                <p className="text-muted-foreground mt-1">
                  Run <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">npx tsx scripts/upload-test-datasets-to-r2.ts</code> first.
                </p>
              </div>
            ) : manifest ? (
              <div className="max-h-[400px] overflow-y-auto space-y-1">
                {manifest.datasets.map(dataset => (
                  <DatasetRow
                    key={dataset.name}
                    dataset={dataset}
                    selected={selectedDatasets.has(dataset.name)}
                    onToggle={() => toggleDataset(dataset.name)}
                  />
                ))}
              </div>
            ) : null}

            {manifest && (
              <p className="text-xs text-muted-foreground mt-3">
                {selectedDatasets.size} of {manifest.datasets.filter(d => d.ready).length} datasets selected
                {manifest.generatedAt && (
                  <> &middot; Manifest from {new Date(manifest.generatedAt).toLocaleDateString()}</>
                )}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Launch Configuration */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Launch Configuration</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="name-prefix" className="text-sm">Name Prefix</Label>
                <Input
                  id="name-prefix"
                  value={namePrefix}
                  onChange={(e) => setNamePrefix(e.target.value)}
                  placeholder={defaultPrefix}
                  className="font-mono text-sm"
                />
                <p className="text-[10px] text-muted-foreground">
                  Projects named <code className="bg-muted px-0.5 rounded">{namePrefix} &mdash; dataset</code>
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">Concurrency</Label>
                <Select value={concurrency} onValueChange={setConcurrency}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">1 (sequential)</SelectItem>
                    <SelectItem value="3">3 (light)</SelectItem>
                    <SelectItem value="5">5 (moderate)</SelectItem>
                    <SelectItem value="10">10 (heavy)</SelectItem>
                    <SelectItem value="15">15 (stress)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                onClick={handleLaunch}
                disabled={launching || selectedDatasets.size === 0 || !namePrefix}
                className="flex-1"
              >
                {launching ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Launching...
                  </>
                ) : (
                  <>
                    <Play className="h-4 w-4 mr-2" />
                    Launch {selectedDatasets.size} Pipeline{selectedDatasets.size !== 1 ? 's' : ''}
                  </>
                )}
              </Button>

              {cleanupCount > 0 && (
                <Button
                  variant="outline"
                  onClick={() => setShowCleanup(true)}
                  className="text-tab-rose border-tab-rose/30 hover:bg-tab-rose/10"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Cleanup ({cleanupCount})
                </Button>
              )}
            </div>

            {/* Launch result */}
            {launchResult && (
              <div className="rounded-md border p-3 text-sm space-y-1">
                {launchResult.totalLaunched > 0 && (
                  <p className="text-tab-teal flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    {launchResult.totalLaunched} launched successfully
                  </p>
                )}
                {launchResult.totalErrors > 0 && (
                  <div className="text-tab-rose">
                    <p className="flex items-center gap-1.5">
                      <X className="w-3.5 h-3.5" />
                      {launchResult.totalErrors} failed
                    </p>
                    <ul className="ml-5 mt-1 space-y-0.5 text-xs text-muted-foreground">
                      {launchResult.errors.map((e, i) => (
                        <li key={i}>
                          <span className="font-mono">{e.dataset}</span>: {e.error}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {launchResult.rateLimitRejections > 0 && (
                  <p className="text-tab-amber flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    {launchResult.rateLimitRejections} rate-limited (429)
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Monitoring Panel */}
        {loadTestProjects.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Monitoring</CardTitle>
                <div className="flex gap-2">
                  {statusCounts.running > 0 && (
                    <Badge variant="default" className="bg-tab-blue text-xs">
                      {statusCounts.running} running
                    </Badge>
                  )}
                  {statusCounts.pending_review > 0 && (
                    <Badge variant="secondary" className="text-tab-amber text-xs">
                      {statusCounts.pending_review} review
                    </Badge>
                  )}
                  {statusCounts.completed > 0 && (
                    <Badge variant="default" className="bg-tab-teal text-xs">
                      {statusCounts.completed} done
                    </Badge>
                  )}
                  {statusCounts.failed > 0 && (
                    <Badge variant="destructive" className="text-xs">
                      {statusCounts.failed} failed
                    </Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Summary stats */}
              <div className="flex items-center gap-4 mb-4 text-sm text-muted-foreground">
                <span>{loadTestProjects.length} total</span>
                {elapsed > 0 && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatElapsed(elapsed)}
                  </span>
                )}
              </div>

              {/* Overall progress bar */}
              <div className="mb-4">
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-tab-teal rounded-full transition-all duration-500"
                    style={{
                      width: `${loadTestProjects.length > 0
                        ? ((statusCounts.completed + statusCounts.failed + statusCounts.pending_review) / loadTestProjects.length) * 100
                        : 0}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {statusCounts.completed + statusCounts.failed + statusCounts.pending_review} / {loadTestProjects.length} finished
                </p>
              </div>

              {/* Per-project rows */}
              <div className="max-h-[500px] overflow-y-auto border rounded-md">
                {loadTestProjects.map(project => (
                  <ProjectStatusRow key={project.projectId} project={project} />
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Cleanup Dialog */}
      <ConfirmDestructiveDialog
        open={showCleanup}
        onOpenChange={setShowCleanup}
        title="Clean up load test projects"
        description={`This will delete ${cleanupCount} project(s) matching prefix "${namePrefix} \u2014 *" and their associated runs. This cannot be undone.`}
        confirmText={namePrefix}
        confirmLabel="Type the name prefix to confirm"
        destructiveLabel="Delete Projects"
        onConfirm={handleCleanup}
      />
    </div>
  );
}
