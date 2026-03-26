'use client';

import { useQuery } from 'convex/react';
import type { WizardFormValues, DataValidationResult } from '@/schemas/wizardSchema';
import type { WizardFiles } from './StepUploadFiles';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDown, FileText, Settings, Beaker, Database } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { THEMES } from '@/lib/excel/themes';
import type { StudyMethodology } from '@/schemas/projectConfigSchema';
import { useAuthContext } from '@/providers/auth-provider';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

interface StepReviewLaunchProps {
  values: WizardFormValues;
  files: WizardFiles;
  validationResult: DataValidationResult;
}

export function StepReviewLaunch({ values, files, validationResult }: StepReviewLaunchProps) {
  const { convexOrgId } = useAuthContext();
  const [statsOpen, setStatsOpen] = useState(false);
  const wincrossProfiles = useQuery(
    api.wincrossPreferenceProfiles.listByOrg,
    convexOrgId ? { orgId: convexOrgId as Id<'organizations'> } : 'skip',
  );

  const themeName = THEMES[values.theme]?.displayName ?? values.theme;
  const selectedWinCrossProfileName = wincrossProfiles?.find(
    (profile) => String(profile._id) === values.wincrossProfileId,
  )?.name;

  const displayModeLabel =
    values.displayMode === 'frequency'
      ? 'Percentages'
      : values.displayMode === 'counts'
        ? 'Counts'
        : 'Both (Percentages + Counts)';

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      {/* Project info */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-4 w-4" />
            Project
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <SummaryRow label="Name" value={values.projectName} />
          <SummaryRow label="Study type" value={formatMethodology(values.studyMethodology)} />
          {values.analysisMethod === 'maxdiff' && (
            <SummaryRow label="Analysis" value="MaxDiff" />
          )}
          {values.isWaveStudy && <SummaryRow label="Wave study" value="Yes" />}
          {values.studyMethodology === 'segmentation' && values.segmentationHasAssignments && (
            <SummaryRow label="" value="Includes segment assignments" />
          )}
          {values.studyMethodology === 'demand' && values.hasChoiceModelExercise && (
            <SummaryRow label="" value="Includes choice model exercise" />
          )}
          {values.analysisMethod === 'maxdiff' && (
            <>
              {(() => {
                const msgs = values.maxdiffMessages ?? [];
                const alternates = msgs.filter(m => m.variantOf?.trim());
                if (msgs.length > 0) {
                  return (
                    <SummaryRow
                      label="Messages"
                      value={`${msgs.length} messages${alternates.length > 0 ? ` (${alternates.length} alternate${alternates.length > 1 ? 's' : ''})` : ''}`}
                    />
                  );
                }
                return <SummaryRow label="Messages" value="From .sav labels (may be truncated)" />;
              })()}
              {values.maxdiffHasAnchoredScores && (
                <SummaryRow label="" value="Anchored probability scores included" />
              )}
            </>
          )}
          <SummaryRow
            label="Banner"
            value={values.bannerMode === 'upload' ? 'Uploaded banner plan' : 'Auto-generated'}
          />
          {values.researchObjectives && (
            <SummaryRow label="Objectives" value={values.researchObjectives} truncate />
          )}
          {values.bannerHints && (
            <SummaryRow label="Banner hints" value={values.bannerHints} truncate />
          )}
        </CardContent>
      </Card>

      {/* Files */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4" />
            Files
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <FileRow label="Data file" file={files.dataFile} />
          <FileRow label="Survey" file={files.surveyDocument} />
          {values.bannerMode === 'upload' && (
            <FileRow label="Banner plan" file={files.bannerPlan} />
          )}
          {files.messageList && (
            <FileRow label="Message list" file={files.messageList} />
          )}
          {validationResult.status === 'success' && (
            <div className="flex gap-3 mt-2">
              <Badge variant="outline" className="font-mono text-xs">
                {validationResult.rowCount.toLocaleString()} respondents
              </Badge>
              <Badge variant="outline" className="font-mono text-xs">
                {validationResult.columnCount.toLocaleString()} variables
              </Badge>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Configuration */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings className="h-4 w-4" />
            Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <SummaryRow label="Display mode" value={displayModeLabel} />
          {values.displayMode === 'both' && (
            <SummaryRow
              label="Workbooks"
              value={values.separateWorkbooks ? 'Separate files' : 'Single file, two sheets'}
            />
          )}
          <SummaryRow label="Theme" value={themeName} />
          <SummaryRow label="Significance" value={`${values.statTestingThreshold}%`} />
          <SummaryRow
            label="Min base"
            value={values.minBaseSize === 0 ? 'None' : String(values.minBaseSize)}
          />
          <SummaryRow
            label="Weight"
            value={values.weightVariable || 'Unweighted'}
            mono={!!values.weightVariable}
          />
          {values.loopStatTestingMode && (
            <SummaryRow
              label="Loop stat testing"
              value={values.loopStatTestingMode === 'suppress' ? 'Suppress' : 'Complement'}
            />
          )}
          <SummaryRow
            label="Export formats"
            value={values.exportFormats.map(formatExportFormat).join(', ')}
          />
          {values.exportFormats.includes('wincross') && values.wincrossProfileId && (
            <SummaryRow
              label="WinCross profile"
              value={selectedWinCrossProfileName ?? values.wincrossProfileId}
              mono={!selectedWinCrossProfileName}
            />
          )}
          <SummaryRow
            label="Regrouping config"
            value={values.regroupUseCustomConfig ? 'Custom override' : 'Defaults (env/project)'}
          />
          {values.regroupUseCustomConfig && (
            <>
              <SummaryRow label="Regroup enabled" value={values.regroupEnabled ? 'Yes' : 'No'} />
              <SummaryRow label="Min siblings" value={String(values.regroupMinSiblings)} />
              <SummaryRow label="Scale cardinality max" value={String(values.regroupMaxScaleCardinality)} />
              <SummaryRow label="Axis margin" value={String(values.regroupMinAxisMargin)} />
              <SummaryRow label="Rows per table" value={`${values.regroupMinRowsPerRegroupedTable} - ${values.regroupMaxRowsPerRegroupedTable}`} />
            </>
          )}
        </CardContent>
      </Card>

      {/* Statistical Assumptions */}
      <Collapsible open={statsOpen} onOpenChange={setStatsOpen}>
        <Card>
          <CollapsibleTrigger className="w-full">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Beaker className="h-4 w-4" />
                Statistical Assumptions
                <ChevronDown
                  className={cn('ml-auto h-4 w-4 transition-transform', statsOpen && 'rotate-180')}
                />
              </CardTitle>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <SummaryRow label="Proportion test" value="Unpooled z-test (column proportions)" />
              <SummaryRow label="Mean test" value="Welch's t-test (unequal variances)" />
              <SummaryRow label="Multiple comparison" value="Pairwise letters across banner columns" />
              <SummaryRow
                label="Loop stat testing"
                value="Entity-anchored groups suppress within-group comparisons"
              />
              <SummaryRow
                label="Confidence"
                value={`${values.statTestingThreshold}% (p < ${(1 - values.statTestingThreshold / 100).toFixed(2)})`}
              />
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}

function SummaryRow({
  label,
  value,
  mono,
  truncate,
}: {
  label: string;
  value: string;
  mono?: boolean;
  truncate?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-sm text-muted-foreground shrink-0">{label}</span>
      <span
        className={cn(
          'text-sm text-right',
          mono && 'font-mono',
          truncate && 'truncate max-w-[300px]'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function FileRow({ label, file }: { label: string; file: File | null }) {
  if (!file) return null;
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-mono truncate max-w-[250px]">{file.name}</span>
    </div>
  );
}

function formatMethodology(value: StudyMethodology): string {
  switch (value) {
    case 'message_testing':
      return 'Message Testing';
    case 'concept_testing':
      return 'Concept Testing';
    case 'segmentation':
      return 'Segmentation';
    case 'demand':
      return 'Demand Study';
    default:
      return 'Standard';
  }
}

function formatExportFormat(value: string): string {
  switch (value) {
    case 'q':
      return 'Q';
    case 'wincross':
      return 'WinCross';
    default:
      return 'Excel';
  }
}
