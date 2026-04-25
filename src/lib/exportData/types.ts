import { z } from 'zod';

export const EXPORT_MANIFEST_VERSION_PHASE0 = 'phase0.v1';
export const EXPORT_MANIFEST_VERSION_PHASE1 = 'phase1.v1';
export const EXPORT_ACTIVE_MANIFEST_VERSION = EXPORT_MANIFEST_VERSION_PHASE1;

export const EXPORT_ARTIFACT_PATHS = {
  metadata: 'export/export-metadata.json',
  tableRouting: 'export/table-routing.json',
  jobRoutingManifest: 'export/job-routing-manifest.json',
  loopPolicy: 'export/loop-semantics-policy.json',
  compiledLoopContract: 'export/compiled-loop-contract.json',
  supportReport: 'export/support-report.json',
  wideSav: 'export/data/wide.sav',
} as const;

export type WeightingMode = 'weighted' | 'unweighted' | 'both';

export const ExportDataFileRefSchema = z.object({
  dataFrameRef: z.string(),
  fileName: z.string(),
  relativePath: z.string(),
  exists: z.boolean(),
  r2Key: z.string().optional(),
});

export type ExportDataFileRef = z.infer<typeof ExportDataFileRefSchema>;

export const ExportArtifactInputsSchema = z.object({
  sortedFinal: z.string(),
  resultsTables: z.string(),
  crosstabRaw: z.string(),
  loopSummary: z.string(),
  loopPolicy: z.string(),
  compiledLoopContract: z.string().optional(),
  verboseDataMap: z.string().optional(),
});

export const ExportArtifactOutputsSchema = z.object({
  metadata: z.string(),
  tableRouting: z.string(),
  jobRoutingManifest: z.string(),
  loopPolicy: z.string(),
  compiledLoopContract: z.string().optional(),
  supportReport: z.string().optional(),
});

export const ExportArtifactPathsSchema = z.object({
  inputs: ExportArtifactInputsSchema,
  outputs: ExportArtifactOutputsSchema,
});

export const ExportConvexRefsSchema = z.object({
  runId: z.string().optional(),
  projectId: z.string().optional(),
  orgId: z.string().optional(),
  pipelineId: z.string().optional(),
});

export const ExportR2RefsSchema = z.object({
  finalized: z.boolean(),
  artifacts: z.record(z.string()),
  dataFiles: z.record(z.string()),
  manifestKey: z.string().optional(),
});

export const ExportReadinessReasonCodeSchema = z.enum([
  'ready',
  'missing_required_artifact',
  'missing_required_data_file',
  'missing_required_r2_artifact_ref',
  'missing_required_r2_data_file_ref',
  'r2_not_finalized',
  'checksum_mismatch',
  'artifact_consistency_mismatch',
  'invalid_results_tables_contract',
  'not_exportable_requires_rerun',
  'unsupported_expression',
]);

export type ExportReadinessReasonCode = z.infer<typeof ExportReadinessReasonCodeSchema>;

export const ExportReadinessDimensionSchema = z.object({
  ready: z.boolean(),
  reasonCodes: z.array(ExportReadinessReasonCodeSchema),
  details: z.array(z.string()),
});

export const ExportReadinessSchema = z.object({
  evaluatedAt: z.string(),
  local: ExportReadinessDimensionSchema,
  reexport: ExportReadinessDimensionSchema,
});

export type ExportReadiness = z.infer<typeof ExportReadinessSchema>;

export const ExportIntegritySchema = z.object({
  algorithm: z.literal('sha256'),
  metadataPayloadChecksum: z.string(),
  artifactChecksums: z.record(z.string()),
  dataFileChecksums: z.record(z.string()),
  verifiedAt: z.string(),
});

export type ExportIntegrity = z.infer<typeof ExportIntegritySchema>;

export const ExportPlatformSupportStatusSchema = z.enum(['supported', 'warning', 'blocked']);
export type ExportPlatformSupportStatus = z.infer<typeof ExportPlatformSupportStatusSchema>;

export const ExportPlatformSupportSummarySchema = z.object({
  supported: z.number(),
  warning: z.number(),
  blocked: z.number(),
});

export type ExportPlatformSupportSummary = z.infer<typeof ExportPlatformSupportSummarySchema>;

export const ExportSupportSummarySchema = z.object({
  q: ExportPlatformSupportSummarySchema,
  wincross: ExportPlatformSupportSummarySchema,
});

export type ExportSupportSummary = z.infer<typeof ExportSupportSummarySchema>;

export const ExportIdempotencySchema = z.object({
  integrityDigest: z.string(),
  jobs: z.record(z.string()),
});

export type ExportIdempotency = z.infer<typeof ExportIdempotencySchema>;

export const ExportManifestMetadataSchema = z.object({
  manifestVersion: z.string(),
  generatedAt: z.string(),
  weighting: z.object({
    weightVariable: z.string().nullable(),
    mode: z.enum(['weighted', 'unweighted', 'both']),
  }),
  sourceSavNames: z.object({
    uploaded: z.string(),
    runtime: z.string(),
  }),
  availableDataFiles: z.array(ExportDataFileRefSchema),
  artifactPaths: ExportArtifactPathsSchema,
  convexRefs: ExportConvexRefsSchema,
  r2Refs: ExportR2RefsSchema,
  warnings: z.array(z.string()),
  readiness: ExportReadinessSchema.optional(),
  integrity: ExportIntegritySchema.optional(),
  support: ExportSupportSummarySchema.optional(),
  idempotency: ExportIdempotencySchema.optional(),
});

// Backward-compatible alias while we evolve from Phase 0 naming.
export const ExportPhase0MetadataSchema = ExportManifestMetadataSchema;

export type ExportManifestMetadata = z.infer<typeof ExportManifestMetadataSchema>;
export type ExportPhase0Metadata = ExportManifestMetadata;

export const TableRoutingArtifactSchema = z.object({
  generatedAt: z.string(),
  totalTables: z.number(),
  tableToDataFrameRef: z.record(z.string()),
  countsByDataFrameRef: z.record(z.number()),
});

export type TableRoutingArtifact = z.infer<typeof TableRoutingArtifactSchema>;

export const JobRoutingEntrySchema = z.object({
  jobId: z.string(),
  dataFrameRef: z.string(),
  dataFileRelativePath: z.string(),
  tableIds: z.array(z.string()),
});

export const JobRoutingManifestSchema = z.object({
  generatedAt: z.string(),
  totalJobs: z.number(),
  totalTables: z.number(),
  jobs: z.array(JobRoutingEntrySchema),
  tableToJobId: z.record(z.string()),
});

export type JobRoutingManifest = z.infer<typeof JobRoutingManifestSchema>;

export const NormalizedExpressionSourceSchema = z.enum([
  'cut',
  'table_additional_filter',
  'filtertranslator',
]);

export const NormalizedExpressionSchema = z.object({
  source: NormalizedExpressionSourceSchema,
  sourceId: z.string(),
  original: z.string(),
  normalized: z.string().optional(),
  fingerprint: z.string().optional(),
  parseStatus: z.enum(['parsed', 'blocked']),
  reasonCodes: z.array(ExportReadinessReasonCodeSchema),
});

export type NormalizedExpression = z.infer<typeof NormalizedExpressionSchema>;

export const ExportSupportItemSchema = z.object({
  itemType: z.enum(['cut', 'table', 'filter']),
  itemId: z.string(),
  q: z.object({
    status: ExportPlatformSupportStatusSchema,
    reasonCodes: z.array(z.string()),
    fallbackStrategy: z.enum(['derived_variable', 'skip', 'manual_edit']).optional(),
  }),
  wincross: z.object({
    status: ExportPlatformSupportStatusSchema,
    reasonCodes: z.array(z.string()),
    fallbackStrategy: z.enum(['derived_variable', 'skip', 'manual_edit']).optional(),
  }),
});

export type ExportSupportItem = z.infer<typeof ExportSupportItemSchema>;

export const ExportSupportReportSchema = z.object({
  generatedAt: z.string(),
  manifestVersion: z.string(),
  expressionSummary: z.object({
    total: z.number(),
    parsed: z.number(),
    blocked: z.number(),
  }),
  expressions: z.array(NormalizedExpressionSchema),
  supportItems: z.array(ExportSupportItemSchema),
  summary: ExportSupportSummarySchema,
});

export type ExportSupportReport = z.infer<typeof ExportSupportReportSchema>;

export const QExportFilterTermOperatorSchema = z.enum([
  'any_of',
  'equals',
  'not_equals',
  'greater_than',
  'greater_than_or_equals',
  'less_than',
  'less_than_or_equals',
  'is_missing',
]);

export type QExportFilterTermOperator = z.infer<typeof QExportFilterTermOperatorSchema>;

const QExportFilterValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export type QExportFilterTree =
  | {
      type: 'term';
      leftRef: string;
      op: QExportFilterTermOperator;
      values: Array<string | number | boolean>;
    }
  | {
      type: 'and';
      children: QExportFilterTree[];
    }
  | {
      type: 'or';
      children: QExportFilterTree[];
    }
  | {
      type: 'not';
      child: QExportFilterTree;
    }
  | {
      type: 'derived_comparison';
      leftVar: string;
      op: '==' | '!=' | '>' | '>=' | '<' | '<=';
      rightVar: string;
      helperVarName: string;
    };

export const QExportFilterTreeSchema: z.ZodType<QExportFilterTree> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('term'),
      leftRef: z.string(),
      op: QExportFilterTermOperatorSchema,
      values: z.array(QExportFilterValueSchema),
    }),
    z.object({
      type: z.literal('and'),
      children: z.array(QExportFilterTreeSchema),
    }),
    z.object({
      type: z.literal('or'),
      children: z.array(QExportFilterTreeSchema),
    }),
    z.object({
      type: z.literal('not'),
      child: QExportFilterTreeSchema,
    }),
    z.object({
      type: z.literal('derived_comparison'),
      leftVar: z.string(),
      op: z.enum(['==', '!=', '>', '>=', '<', '<=']),
      rightVar: z.string(),
      helperVarName: z.string(),
    }),
  ])
);

export const QExportFilterSchema = z.object({
  filterId: z.string(),
  source: z.enum(['cut', 'table']),
  sourceId: z.string(),
  expression: z.string(),
  normalizedExpression: z.string(),
  fingerprint: z.string(),
  filterTree: QExportFilterTreeSchema,
  parseStatus: z.enum(['parsed', 'blocked']),
  loweringStrategy: z.enum(['direct', 'derived_variable']),
  reasonCodes: z.array(z.string()),
  dataFrameRef: z.string(),
  helperVarName: z.string(),
  helperVarLabel: z.string(),
  consumerRefs: z.array(z.string()),
});

export type QExportFilter = z.infer<typeof QExportFilterSchema>;

export const QExportCutSchema = z.object({
  cutId: z.string(),
  groupName: z.string(),
  columnName: z.string(),
  expression: z.string(),
  dataFrameRef: z.string(),
  filterId: z.string().optional(),
  supportStatus: ExportPlatformSupportStatusSchema,
  reasonCodes: z.array(z.string()),
});

export type QExportCut = z.infer<typeof QExportCutSchema>;

export const QExportRowPlanSchema = z.object({
  rowIndex: z.number(),
  variable: z.string(),
  label: z.string(),
  filterValue: z.string(),
  isNet: z.boolean(),
  netComponents: z.array(z.string()),
  indent: z.number(),
  strategy: z.enum(['duplicate_value_attributes', 'synthetic_expression', 'direct_source_variable', 'blocked']),
  strategyReason: z.string(),
  selectedValues: z.array(z.union([z.string(), z.number()])),
  syntheticExpression: z.string().optional(),
  sourceLabel: z.string().optional(),
  effectiveLabel: z.string(),
  labelSource: z.enum(['row_label', 'variable_label', 'generated_placeholder']),
});

export type QExportRowPlan = z.infer<typeof QExportRowPlanSchema>;

export const QExportTableHeaderRowSchema = z.object({
  rowIndex: z.number(),
  label: z.string(),
  filterValue: z.string(),
  indent: z.number(),
});

export type QExportTableHeaderRow = z.infer<typeof QExportTableHeaderRowSchema>;

export const QExportTableStrategySchema = z.enum([
  'native_pick_one',           // PICK_ONE_SIMPLE: question.duplicate() + setLabel()
  'native_pick_one_with_nets', // PICK_ONE_WITH_NETS: above + createNET()
  'native_pick_any',           // MULTI_SELECT_WITH_NET_COMPONENTS: question.duplicate() for Pick Any
  'native_numeric_single',     // NUMERIC_SINGLE: question.duplicate() for single numeric
  'native_numeric_multi',      // NUMERIC_MULTI: question.duplicate() for multi-numeric
  'cross_variable',            // CROSS_VARIABLE_COMPARISON: per-variable duplicates → compose
  'synthetic_rows',            // BINNED_DISTRIBUTION, fallback: existing row-by-row path
  'excluded',                  // EXCLUDED tables: skip
]);

export type QExportTableStrategy = z.infer<typeof QExportTableStrategySchema>;

export const QExportBaseContextSchema = z.object({
  source: z.enum(['contract', 'legacy_fallback']),
  referenceBaseN: z.number().nullable(),
  itemBaseRange: z.tuple([z.number(), z.number()]).nullable(),
  displayBaseText: z.string().nullable(),
  displayNote: z.string().nullable(),
  compactDisclosureText: z.string().nullable(),
  baseViewRole: z.enum(['anchor', 'precision']).nullable(),
  plannerBaseComparability: z.enum([
    'shared',
    'varying_but_acceptable',
    'split_recommended',
    'ambiguous',
  ]).nullable(),
  plannerBaseSignals: z.array(z.string()),
  computeRiskSignals: z.array(z.string()),
  referenceUniverse: z.enum(['total', 'question', 'cluster', 'model']).nullable(),
  effectiveBaseMode: z.enum([
    'table_mask_then_row_observed_n',
    'table_mask_shared_n',
    'model',
  ]).nullable(),
  rebasePolicy: z.enum(['none', 'exclude_non_substantive_tail']),
});

export type QExportBaseContext = z.infer<typeof QExportBaseContextSchema>;

export const QExportTableSchema = z.object({
  tableId: z.string(),
  tableOrderIndex: z.number(),
  jobId: z.string(),
  dataFrameRef: z.string(),
  questionId: z.string(),
  questionText: z.string(),
  tableType: z.string(),
  primaryStrategy: z.enum(['row_plan_primary', 'numeric_row_plan_primary']).default('row_plan_primary'),
  tableStrategy: QExportTableStrategySchema.default('synthetic_rows'),
  sourceQuestionName: z.string().optional(),
  additionalFilter: z.string().optional(),
  additionalFilterId: z.string().optional(),
  additionalFilterBindPath: z.enum(['table_filters_variable', 'table_primary_masked']).optional(),
  supportStatus: ExportPlatformSupportStatusSchema,
  reasonCodes: z.array(z.string()),
  rowCount: z.number(),
  rows: z.array(QExportRowPlanSchema),
  headerRows: z.array(QExportTableHeaderRowSchema).default([]),
  baseContext: QExportBaseContextSchema.optional(),
});

export type QExportTable = z.infer<typeof QExportTableSchema>;

export const QExportJobSchema = z.object({
  jobId: z.string(),
  dataFrameRef: z.string(),
  dataFileRelativePath: z.string(),
  packageDataFilePath: z.string(),
  dataFileR2Key: z.string().optional(),
  tableIds: z.array(z.string()),
});

export type QExportJob = z.infer<typeof QExportJobSchema>;

export const QExportBlockedItemSchema = z.object({
  itemType: z.enum(['cut', 'table', 'filter', 'artifact']),
  itemId: z.string(),
  reasonCodes: z.array(z.string()),
  detail: z.string(),
});

export type QExportBlockedItem = z.infer<typeof QExportBlockedItemSchema>;

export const QExportRuntimeContractSchema = z.object({
  engine: z.literal('native-qscript'),
  contractVersion: z.string(),
  helperRuntimeHash: z.string(),
  minQVersion: z.string(),
});

export type QExportRuntimeContract = z.infer<typeof QExportRuntimeContractSchema>;

export const QExportBannerGroupStrategySchema = z.enum([
  'native_question',   // All cuts reference same source question — use question.duplicate()
  'synthetic_filter',  // Complex expressions — keep 0/1 filter variables + Pick Any
]);

export type QExportBannerGroupStrategy = z.infer<typeof QExportBannerGroupStrategySchema>;

export const QExportBannerGroupSchema = z.object({
  groupName: z.string(),
  groupQuestionName: z.string(),
  filterIds: z.array(z.string()),
  groupStrategy: QExportBannerGroupStrategySchema.default('synthetic_filter'),
  sourceQuestionName: z.string().optional(),
});

export type QExportBannerGroup = z.infer<typeof QExportBannerGroupSchema>;

export const QExportBannerPlanSchema = z.object({
  planId: z.string(),
  dataFrameRef: z.string(),
  sourceCutFilterIds: z.array(z.string()),
  bannerQuestionName: z.string(),
  groups: z.array(QExportBannerGroupSchema),
});

export type QExportBannerPlan = z.infer<typeof QExportBannerPlanSchema>;

export const QExportManifestSchema = z.object({
  manifestVersion: z.string(),
  exporterVersion: z.string(),
  generatedAt: z.string(),
  packageId: z.string(),
  sourceManifestVersion: z.string(),
  integrityDigest: z.string(),
  artifacts: z.object({
    metadataPath: z.string(),
    tableRoutingPath: z.string(),
    jobRoutingManifestPath: z.string(),
    loopPolicyPath: z.string(),
    supportReportPath: z.string(),
    sortedFinalPath: z.string(),
    resultsTablesPath: z.string(),
    crosstabRawPath: z.string(),
    loopSummaryPath: z.string(),
    verboseDataMapPath: z.string().optional(),
  }),
  provenance: z.object({
    runId: z.string().optional(),
    projectId: z.string().optional(),
    orgId: z.string().optional(),
  }),
  runtimeContract: QExportRuntimeContractSchema,
  jobs: z.array(QExportJobSchema),
  tables: z.array(QExportTableSchema),
  cuts: z.array(QExportCutSchema),
  filters: z.array(QExportFilterSchema),
  bannerPlans: z.array(QExportBannerPlanSchema),
  blockedItems: z.array(QExportBlockedItemSchema),
  warnings: z.array(z.string()),
  supportSummary: ExportPlatformSupportSummarySchema,
  sourceSupportSummary: ExportPlatformSupportSummarySchema.optional(),
});

export type QExportManifest = z.infer<typeof QExportManifestSchema>;

export const QExportPackageDescriptorSchema = z.object({
  packageId: z.string(),
  exporterVersion: z.string(),
  manifestVersion: z.string(),
  runtimeContractVersion: z.string(),
  helperRuntimeHash: z.string(),
  generatedAt: z.string(),
  manifestHash: z.string(),
  scriptHash: z.string(),
  archivePath: z.string().optional(),
  archiveHash: z.string().optional(),
  files: z.record(z.string()),
});

export type QExportPackageDescriptor = z.infer<typeof QExportPackageDescriptorSchema>;

export const WinCrossPreferenceProfileSchema = z.object({
  version: z.string().nullable(),
  numericPreferenceVector: z.string().nullable(),
  tableOptionSignature: z.string().nullable(),
  defaultTotalLine: z.string().nullable(),
  preferenceLines: z.array(z.string()).default([]),
  tokenDictionary: z.record(z.string()),
  statsDictionary: z.record(z.string()),
  sigFooterLines: z.array(z.string()),
  bannerLines: z.array(z.string()).default([]),
  bannerMemberLines: z.array(z.string()).default([]),
  bannerDisplayLines: z.array(z.string()).default([]),
  bannerLayoutLines: z.array(z.string()).default([]),
  titleLines: z.array(z.string()),
  passthroughSections: z.record(z.array(z.string())),
  tableStyleHints: z.object({
    sourceTableCount: z.number(),
    valueReferenceColumn: z.number().nullable(),
    statLabelCaretColumn: z.number().nullable(),
    netRowSuffixToken: z.string().nullable(),
    headerLeadingSpaces: z.number().nullable(),
    headerRowPattern: z.enum([
      'none',
      'leading_label_only',
      'sectioned_label_only',
      'trailing_label_only',
      'mixed_or_unsafe',
    ]),
    notes: z.array(z.string()).default([]),
  }),
  tablePatternHints: z.object({
    tableCount: z.number(),
    useCount: z.number(),
    afCount: z.number(),
    sbaseCount: z.number(),
  }),
});

export type WinCrossPreferenceProfile = z.infer<typeof WinCrossPreferenceProfileSchema>;

export const WinCrossRawPreferenceSectionSchema = z.object({
  rawLines: z.array(z.string()),
  vectorLine: z.string().nullable(),
  tableOptionSignatureLine: z.string().nullable(),
  defaultTotalLine: z.string().nullable(),
  tokenAssignmentLines: z.array(z.string()),
  statLabelLines: z.array(z.string()),
  otherLines: z.array(z.string()),
});

export type WinCrossRawPreferenceSection = z.infer<typeof WinCrossRawPreferenceSectionSchema>;

export const WinCrossRawBannerSectionSchema = z.object({
  rawLines: z.array(z.string()),
  layoutDirectiveLines: z.array(z.string()),
  memberLines: z.array(z.string()),
  memberLogicLines: z.array(z.string()).default([]),
  displayRowLines: z.array(z.string()).default([]),
  otherLines: z.array(z.string()),
});

export type WinCrossRawBannerSection = z.infer<typeof WinCrossRawBannerSectionSchema>;

export const WinCrossRawTableSectionSchema = z.object({
  rawLines: z.array(z.string()),
  styleHints: z.object({
    sourceTableCount: z.number(),
    valueReferenceColumn: z.number().nullable(),
    statLabelCaretColumn: z.number().nullable(),
    netRowSuffixToken: z.string().nullable(),
    headerLeadingSpaces: z.number().nullable(),
    headerRowPattern: z.enum([
      'none',
      'leading_label_only',
      'sectioned_label_only',
      'trailing_label_only',
      'mixed_or_unsafe',
    ]),
    notes: z.array(z.string()).default([]),
  }),
});

export type WinCrossRawTableSection = z.infer<typeof WinCrossRawTableSectionSchema>;

export const WinCrossRawJobModelSchema = z.object({
  encoding: z.enum(['utf16le', 'utf8', 'unknown']),
  sectionOrder: z.array(z.string()),
  rawSections: z.record(z.array(z.string())),
  versionLines: z.array(z.string()),
  preferenceSection: WinCrossRawPreferenceSectionSchema,
  sigFooterLines: z.array(z.string()),
  bannerSection: WinCrossRawBannerSectionSchema,
  tableSection: WinCrossRawTableSectionSchema,
  titleLines: z.array(z.string()),
  tablePatternHints: z.object({
    tableCount: z.number(),
    useCount: z.number(),
    afCount: z.number(),
    sbaseCount: z.number(),
  }),
});

export type WinCrossRawJobModel = z.infer<typeof WinCrossRawJobModelSchema>;

export const WinCrossParseDiagnosticsSchema = z.object({
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
  sectionNames: z.array(z.string()),
  encoding: z.enum(['utf16le', 'utf8', 'unknown']),
});

export type WinCrossParseDiagnostics = z.infer<typeof WinCrossParseDiagnosticsSchema>;

export const WinCrossBannerDisplayTemplateKindSchema = z.enum([
  'none',
  'columns_only',
  'separator_plus_columns',
  'group_plus_columns',
  'separator_group_separator_columns',
  'unsupported',
]);

export type WinCrossBannerDisplayTemplateKind = z.infer<typeof WinCrossBannerDisplayTemplateKindSchema>;

export const WinCrossBannerApplicationDiagnosticsSchema = z.object({
  templateKind: WinCrossBannerDisplayTemplateKindSchema,
  sourceDisplayLineCount: z.number(),
  generatedDisplayLineCount: z.number(),
  status: z.enum(['not_requested', 'applied', 'degraded']),
  notes: z.array(z.string()),
});

export type WinCrossBannerApplicationDiagnostics = z.infer<typeof WinCrossBannerApplicationDiagnosticsSchema>;

export const WinCrossTableTemplateKindSchema = z.enum([
  'value_rows_only',
  'value_rows_with_nets',
  'stat_rows_only_single_variable',
  'stat_rows_only_multi_variable',
  'mixed_value_and_stats',
  'label_only_fallback',
  'empty',
]);

export type WinCrossTableTemplateKind = z.infer<typeof WinCrossTableTemplateKindSchema>;

export const WinCrossTableDisplayTemplateKindSchema = z.enum([
  'empty',
  'plain_rows',
  'indented_rows',
  'leading_header_rows',
  'sectioned_header_rows',
  'trailing_header_rows',
]);

export type WinCrossTableDisplayTemplateKind = z.infer<typeof WinCrossTableDisplayTemplateKindSchema>;

export const WinCrossTableUseStrategySchema = z.enum([
  'none',
  'direct_reuse',
  'substitution_reuse',
]);

export type WinCrossTableUseStrategy = z.infer<typeof WinCrossTableUseStrategySchema>;

export const WinCrossTableAfStrategySchema = z.enum([
  'none',
  'native_single_variable_stat',
  'native_single_variable_stat_with_interim_values',
  'raw_additional_filter',
]);

export type WinCrossTableAfStrategy = z.infer<typeof WinCrossTableAfStrategySchema>;

export const WinCrossTableApplicationDiagnosticSchema = z.object({
  tableId: z.string(),
  ordinal: z.number(),
  templateKind: WinCrossTableTemplateKindSchema,
  displayTemplateKind: WinCrossTableDisplayTemplateKindSchema,
  headerRowCount: z.number(),
  indentedBodyRowCount: z.number(),
  appliedStyleHints: z.array(z.string()).default([]),
  skippedStyleHints: z.array(z.string()).default([]),
  unsafeStyleHints: z.array(z.string()).default([]),
  useStrategy: WinCrossTableUseStrategySchema,
  afStrategy: WinCrossTableAfStrategySchema,
  status: z.enum(['basic', 'parity', 'blocked', 'degraded']),
  notes: z.array(z.string()),
});

export type WinCrossTableApplicationDiagnostic = z.infer<typeof WinCrossTableApplicationDiagnosticSchema>;

export const WinCrossApplicationDiagnosticsSchema = z.object({
  banner: WinCrossBannerApplicationDiagnosticsSchema,
  tables: z.array(WinCrossTableApplicationDiagnosticSchema),
});

export type WinCrossApplicationDiagnostics = z.infer<typeof WinCrossApplicationDiagnosticsSchema>;

export const WinCrossExportManifestSchema = z.object({
  manifestVersion: z.string(),
  exporterVersion: z.string(),
  generatedAt: z.string(),
  packageId: z.string(),
  sourceManifestVersion: z.string(),
  integrityDigest: z.string(),
  tableCount: z.number(),
  useCount: z.number(),
  afCount: z.number(),
  blockedCount: z.number().default(0),
  profileSource: z.enum(['default', 'reference_job', 'embedded_reference', 'inline_job', 'org_profile']),
  profileDigest: z.string().default(''),
  serializerContractVersion: z.string().default(''),
  blockedItems: z.array(QExportBlockedItemSchema),
  warnings: z.array(z.string()),
  applicationDiagnostics: WinCrossApplicationDiagnosticsSchema.optional(),
  supportSummary: ExportPlatformSupportSummarySchema,
});

export type WinCrossExportManifest = z.infer<typeof WinCrossExportManifestSchema>;

export const WinCrossExportPackageDescriptorSchema = z.object({
  packageId: z.string(),
  exporterVersion: z.string(),
  manifestVersion: z.string(),
  generatedAt: z.string(),
  manifestHash: z.string(),
  jobHash: z.string(),
  profileDigest: z.string().default(''),
  sourceDigest: z.string().default(''),
  serializerContractVersion: z.string().default(''),
  archivePath: z.string().optional(),
  archiveHash: z.string().optional(),
  entrypointPath: z.string().optional(),
  files: z.record(z.string()),
});

export type WinCrossExportPackageDescriptor = z.infer<typeof WinCrossExportPackageDescriptorSchema>;

export interface ExportArtifactRefs {
  manifestVersion: string;
  metadataPath: string;
  tableRoutingPath: string;
  jobRoutingManifestPath: string;
  loopPolicyPath: string;
  supportReportPath?: string;
  dataFiles: ExportDataFileRef[];
  r2Refs: z.infer<typeof ExportR2RefsSchema>;
  readiness?: ExportReadiness;
}
