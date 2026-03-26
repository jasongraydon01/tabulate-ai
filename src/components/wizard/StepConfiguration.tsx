'use client';

import { useEffect, useMemo } from 'react';
import { useFormContext } from 'react-hook-form';
import { useQuery } from 'convex/react';
import type { WizardFormValues, DataValidationResult } from '@/schemas/wizardSchema';
import type { ExportFormat } from '@/schemas/projectConfigSchema';
import {
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent } from '@/components/ui/card';
import { ThemePicker } from './ThemePicker';
import { cn } from '@/lib/utils';
import { useAuthContext } from '@/providers/auth-provider';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';
import { InfoTooltip } from '@/components/ui/info-tooltip';

interface StepConfigurationProps {
  validationResult: DataValidationResult;
  demoMode?: boolean;
}

export function StepConfiguration({ validationResult, demoMode = false }: StepConfigurationProps) {
  const form = useFormContext<WizardFormValues>();
  const { convexOrgId } = useAuthContext();
  const displayMode = form.watch('displayMode');
  const rawExportFormats = form.watch('exportFormats');
  const exportFormats = useMemo(() => rawExportFormats ?? [], [rawExportFormats]);
  const selectedWinCrossProfileId = form.watch('wincrossProfileId') ?? '';
  const wincrossProfiles = useQuery(
    api.wincrossPreferenceProfiles.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<'organizations'> } : 'skip',
  );

  useEffect(() => {
    if (!exportFormats.includes('wincross')) return;
    if (!wincrossProfiles || wincrossProfiles.length === 0) return;
    if (selectedWinCrossProfileId) return;

    const fallbackProfileId = wincrossProfiles.find((profile) => profile.isDefault)?._id
      ?? wincrossProfiles[0]?._id;
    if (fallbackProfileId) {
      form.setValue('wincrossProfileId', String(fallbackProfileId), {
        shouldDirty: false,
      });
    }
  }, [exportFormats, form, selectedWinCrossProfileId, wincrossProfiles]);

  const toggleExportFormat = (
    checked: boolean,
    format: ExportFormat,
    currentFormats: ExportFormat[],
    onChange: (value: ExportFormat[]) => void,
  ) => {
    const nextFormats = checked
      ? [...new Set([...currentFormats, format])]
      : currentFormats.filter((value) => value !== format);
    const orderedFormats: ExportFormat[] = (['excel', 'q', 'wincross'] as const)
      .filter((value): value is ExportFormat => nextFormats.includes(value));
    onChange(orderedFormats);
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Display mode */}
      <FormField
        control={form.control}
        name="displayMode"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Display Mode</FormLabel>
            <FormControl>
              <RadioGroup
                value={field.value}
                onValueChange={field.onChange}
                className="grid grid-cols-1 gap-3 sm:grid-cols-3"
              >
                {[
                  { value: 'frequency', label: 'Percentages', desc: 'Column percentages' },
                  { value: 'counts', label: 'Counts', desc: 'Raw frequency counts' },
                  { value: 'both', label: 'Both', desc: 'Separate sheets / workbooks' },
                ].map((option) => (
                  <label key={option.value} className="cursor-pointer">
                    <RadioGroupItem value={option.value} className="sr-only" />
                    <Card
                      className={cn(
                        'transition-all hover:border-foreground/20',
                        field.value === option.value && 'ring-2 ring-primary border-primary'
                      )}
                    >
                      <CardContent className="p-3 text-center">
                        <span className="text-sm font-medium">{option.label}</span>
                        <p className="text-xs text-muted-foreground mt-0.5">{option.desc}</p>
                      </CardContent>
                    </Card>
                  </label>
                ))}
              </RadioGroup>
            </FormControl>
          </FormItem>
        )}
      />

      {/* Separate workbooks (only when displayMode === 'both') */}
      {displayMode === 'both' && (
        <FormField
          control={form.control}
          name="separateWorkbooks"
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 rounded-lg border p-4">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
              <FormLabel className="text-sm inline-flex items-center gap-1.5">
                Separate workbooks
                <InfoTooltip text="Generate two .xlsx files instead of two sheets in one workbook." />
              </FormLabel>
            </FormItem>
          )}
        />
      )}

      {/* Color theme */}
      <FormField
        control={form.control}
        name="theme"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Color Theme</FormLabel>
            <FormControl>
              <ThemePicker value={field.value} onChange={field.onChange} />
            </FormControl>
          </FormItem>
        )}
      />

      {/* Hide excluded tables */}
      <FormField
        control={form.control}
        name="hideExcludedTables"
        render={({ field }) => (
          <FormItem className="flex items-center gap-3 rounded-lg border p-4">
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
            <FormLabel className="text-sm inline-flex items-center gap-1.5">
              Hide excluded tables sheet
              <InfoTooltip text="Omit the red Excluded Tables sheet from the Excel output. Excluded tables will still be tracked internally." />
            </FormLabel>
          </FormItem>
        )}
      />

      {/* Stat testing threshold */}
      <FormField
        control={form.control}
        name="statTestingThreshold"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="inline-flex items-center gap-1.5">
              Significance Threshold
              <InfoTooltip text="Confidence level for column-proportion tests. 90% is standard for market research." />
            </FormLabel>
            <div className="flex items-center gap-2">
              <FormControl>
                <Input
                  type="number"
                  min={50}
                  max={99}
                  className="w-24 font-mono"
                  value={field.value}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <span className="text-sm text-muted-foreground">%</span>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Min base size */}
      <FormField
        control={form.control}
        name="minBaseSize"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="inline-flex items-center gap-1.5">
              Minimum Base Size
              <InfoTooltip text="Suppress stat testing for columns below this base. 0 = no minimum." />
            </FormLabel>
            <div className="flex items-center gap-2">
              <FormControl>
                <Input
                  type="number"
                  min={0}
                  className="w-24 font-mono"
                  value={field.value}
                  onChange={(e) => field.onChange(Number(e.target.value))}
                />
              </FormControl>
              <span className="text-sm text-muted-foreground">respondents</span>
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Weight variable */}
      <FormField
        control={form.control}
        name="weightVariable"
        render={({ field }) => (
          <FormItem>
            <FormLabel className="inline-flex items-center gap-1.5">
              Weight Variable
              <InfoTooltip
                text={
                  validationResult.weightCandidates.length > 0
                    ? 'Detected from your data. Select to apply weighted analysis.'
                    : 'No weight variables detected in your data.'
                }
              />
            </FormLabel>
            <Select
              value={field.value || '__none__'}
              onValueChange={(val) => field.onChange(val === '__none__' ? undefined : val)}
            >
              <FormControl>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="None (unweighted)" />
                </SelectTrigger>
              </FormControl>
              <SelectContent>
                <SelectItem value="__none__">None (unweighted)</SelectItem>
                {validationResult.weightCandidates.map((c) => (
                  <SelectItem key={c.column} value={c.column}>
                    <span className="font-mono">{c.column}</span>
                    {c.label && (
                      <span className="text-muted-foreground ml-2">— {c.label}</span>
                    )}
                    <span className="text-muted-foreground ml-2">(mean: {c.mean.toFixed(3)})</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormItem>
        )}
      />

      {/* Export formats */}
      <FormField
        control={form.control}
        name="exportFormats"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Export Formats</FormLabel>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {[
                {
                  value: 'excel' as const,
                  label: 'Excel',
                  description: 'Primary workbook output',
                },
                {
                  value: 'q' as const,
                  label: 'Q',
                  description: 'Q-script export',
                },
                {
                  value: 'wincross' as const,
                  label: 'WinCross',
                  description: 'WinCross export',
                },
              ].map((option) => {
                const isSelected = (field.value ?? []).includes(option.value);
                return (
                  <label key={option.value} className="cursor-pointer">
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={isSelected}
                      onChange={(event) => toggleExportFormat(
                        event.target.checked,
                        option.value,
                        (field.value ?? []) as ExportFormat[],
                        field.onChange,
                      )}
                    />
                    <Card
                      className={cn(
                        'transition-all hover:border-foreground/20',
                        isSelected && 'ring-2 ring-primary border-primary'
                      )}
                    >
                      <CardContent className="p-3 text-center">
                        <span className="text-sm font-medium">{option.label}</span>
                        <p className="mt-0.5 text-xs text-muted-foreground">{option.description}</p>
                      </CardContent>
                    </Card>
                  </label>
                );
              })}
            </div>
            <FormMessage />
          </FormItem>
        )}
      />

      {exportFormats.includes('wincross') && (
        demoMode ? (
          <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            WinCross export will use the TabulateAI default profile. Subscribe to upload custom profiles for your organization.
          </div>
        ) : (
          <FormField
            control={form.control}
            name="wincrossProfileId"
            render={({ field }) => (
              <FormItem>
                <FormLabel className="inline-flex items-center gap-1.5">
                  WinCross Profile
                  <InfoTooltip text="Choose a saved org profile when WinCross exports should match a client-specific house style." />
                </FormLabel>
                {wincrossProfiles === undefined ? (
                  <FormControl>
                    <Input value="Loading profiles..." disabled />
                  </FormControl>
                ) : wincrossProfiles.length > 0 ? (
                  <FormControl>
                    <Select value={field.value || ''} onValueChange={field.onChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a saved WinCross profile" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">TabulateAI default</SelectItem>
                        {wincrossProfiles.map((profile) => (
                          <SelectItem key={String(profile._id)} value={String(profile._id)}>
                            {profile.name}{profile.isDefault ? ' (Default)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                ) : (
                  <div className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                    No saved WinCross profiles yet. The export will use the default serializer profile.
                  </div>
                )}
              </FormItem>
            )}
          />
        )
      )}
    </div>
  );
}
