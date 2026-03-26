'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Loader2, RefreshCcw, Tags } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import {
  DEFAULT_TABLE_LABEL_VOCABULARY,
  TABLE_LABEL_SLOT_LABELS,
  TABLE_LABEL_SLOT_ORDER,
  resolveTableLabelVocabulary,
  type TableLabelSlot,
  type TableLabelVocabulary,
} from '@/lib/tablePresentation/labelVocabulary';

interface LatestRunSummary {
  runId: string;
  status: string;
  canRebuild: boolean;
}

interface SaveResponse {
  labelVocabulary?: unknown;
  usedSlots?: string[];
  rebuild?: { runId?: string } | null;
  warnings?: string[];
}

interface TableLabelsEditorProps {
  projectId: string;
  initialLabelVocabulary?: unknown;
  canEdit: boolean;
}

const TEMPLATE_SLOT_SET = new Set<TableLabelSlot>([
  'rankFormat',
  'topBoxFormat',
  'bottomBoxFormat',
]);

export function TableLabelsEditor({
  projectId,
  initialLabelVocabulary,
  canEdit,
}: TableLabelsEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [latestRun, setLatestRun] = useState<LatestRunSummary | null>(null);
  const [usedSlots, setUsedSlots] = useState<TableLabelSlot[]>([...TABLE_LABEL_SLOT_ORDER]);
  const [vocabulary, setVocabulary] = useState<TableLabelVocabulary>(
    () => resolveTableLabelVocabulary(initialLabelVocabulary),
  );

  useEffect(() => {
    let isMounted = true;

    async function load() {
      try {
        const response = await fetch(
          `/api/projects/${encodeURIComponent(projectId)}/table-presentation`,
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(
            typeof payload.error === 'string'
              ? payload.error
              : 'Failed to load table label settings',
          );
        }
        if (!isMounted) return;

        setVocabulary(resolveTableLabelVocabulary(payload.labelVocabulary));
        setUsedSlots(parseUsedSlots(payload.usedSlots));
        setLatestRun(parseLatestRun(payload.latestRun));
      } catch (error) {
        if (!isMounted) return;
        toast.error('Failed to load table labels', {
          description: error instanceof Error ? error.message : 'Unknown error',
        });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    void load();
    return () => {
      isMounted = false;
    };
  }, [projectId]);

  const visibleSlots = useMemo(
    () => (usedSlots.length > 0 ? usedSlots : [...TABLE_LABEL_SLOT_ORDER]),
    [usedSlots],
  );
  const canRebuild = latestRun?.canRebuild === true;
  const actionLabel = canRebuild ? 'Apply & Rebuild' : 'Save Table Labels';

  async function handleSave() {
    setIsSaving(true);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/table-presentation`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ labelVocabulary: vocabulary }),
        },
      );
      const payload = await response.json().catch(() => ({})) as SaveResponse & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(payload.error ?? 'Failed to update table labels');
      }

      setVocabulary(resolveTableLabelVocabulary(payload.labelVocabulary));
      setUsedSlots(parseUsedSlots(payload.usedSlots));

      const warningDescription = payload.warnings?.length
        ? payload.warnings.join(' ')
        : undefined;

      if (payload.rebuild?.runId) {
        toast.success('Table labels updated and outputs rebuilt', {
          description: warningDescription,
        });
      } else {
        toast.success('Table labels saved', {
          description: warningDescription ?? 'Future runs will use the updated vocabulary.',
        });
      }
    } catch (error) {
      toast.error('Failed to update table labels', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsSaving(false);
    }
  }

  function handleReset() {
    setVocabulary(DEFAULT_TABLE_LABEL_VOCABULARY);
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card className="mb-8">
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="gap-3">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Tags className="h-5 w-5 text-muted-foreground" />
                  Table Labels
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{visibleSlots.length} active label slots</Badge>
                  <Badge variant="outline">
                    {canRebuild ? 'Latest run can rebuild' : 'Future runs only'}
                  </Badge>
                </div>
              </div>
              <ChevronDown
                className={cn(
                  'mt-1 h-5 w-5 shrink-0 text-muted-foreground transition-transform',
                  isOpen && 'rotate-180',
                )}
              />
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            <div className="rounded-lg border border-tab-blue/20 bg-tab-blue/5 p-4 text-sm text-muted-foreground">
              <p>
                These labels control system-generated table rows and headers such as ranking rows,
                T2B/B2B summaries, NET prefixes, base rows, and stat labels.
              </p>
              <p className="mt-2">
                Template slots support <code>{'{N}'}</code>, <code>{'{ordinal}'}</code>, and{' '}
                <code>{'{word}'}</code>.
              </p>
            </div>

            <div className="rounded-lg border p-4 text-sm text-muted-foreground">
              {isLoading ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Checking the latest run for used label slots and rebuildable artifacts...
                </div>
              ) : canRebuild ? (
                <p>
                  Applying changes will rebuild the latest completed run&apos;s Excel workbooks and refresh
                  cached Q / WinCross export packages.
                </p>
              ) : latestRun ? (
                <p>
                  Changes will be saved to the project config, but the latest run does not have rebuildable
                  artifacts. Future runs will use the updated labels.
                </p>
              ) : (
                <p>
                  No completed run exists yet. Changes will be saved now and applied the next time this
                  project runs.
                </p>
              )}
            </div>

            {!canEdit && (
              <p className="text-sm text-muted-foreground">
                You can view the active vocabulary here, but only project members with edit access can change it.
              </p>
            )}

            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {visibleSlots.map((slot) => (
                <div key={slot} className="space-y-2 rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Label htmlFor={`table-label-${slot}`}>{TABLE_LABEL_SLOT_LABELS[slot]}</Label>
                    {vocabulary[slot] === DEFAULT_TABLE_LABEL_VOCABULARY[slot] && (
                      <Badge variant="secondary" className="shrink-0">
                        Default
                      </Badge>
                    )}
                  </div>
                  <Input
                    id={`table-label-${slot}`}
                    value={vocabulary[slot]}
                    onChange={(event) =>
                      setVocabulary((current) => ({
                        ...current,
                        [slot]: event.target.value,
                      }))
                    }
                    disabled={!canEdit || isSaving}
                    placeholder={DEFAULT_TABLE_LABEL_VOCABULARY[slot]}
                  />
                  {TEMPLATE_SLOT_SET.has(slot) && (
                    <p className="text-xs text-muted-foreground">
                      Supports <code>{'{N}'}</code>, <code>{'{ordinal}'}</code>, and{' '}
                      <code>{'{word}'}</code>.
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Only slots detected in the project&apos;s current tables are shown.
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleReset}
                  disabled={!canEdit || isSaving}
                >
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Reset to Defaults
                </Button>
                <Button onClick={handleSave} disabled={!canEdit || isSaving || isLoading}>
                  {isSaving ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Saving...
                    </>
                  ) : (
                    actionLabel
                  )}
                </Button>
              </div>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}

function parseUsedSlots(value: unknown): TableLabelSlot[] {
  if (!Array.isArray(value)) return [...TABLE_LABEL_SLOT_ORDER];
  const slotSet = new Set<string>(TABLE_LABEL_SLOT_ORDER);
  const parsed = value.filter(
    (slot): slot is TableLabelSlot => typeof slot === 'string' && slotSet.has(slot),
  );
  return parsed.length > 0 ? parsed : [...TABLE_LABEL_SLOT_ORDER];
}

function parseLatestRun(value: unknown): LatestRunSummary | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.runId !== 'string'
    || typeof record.status !== 'string'
    || typeof record.canRebuild !== 'boolean'
  ) {
    return null;
  }
  return {
    runId: record.runId,
    status: record.status,
    canRebuild: record.canRebuild,
  };
}
