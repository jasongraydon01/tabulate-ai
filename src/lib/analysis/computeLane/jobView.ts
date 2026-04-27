export type AnalysisComputeJobClientStatus =
  | "drafting"
  | "proposed"
  | "needs_clarification"
  | "confirmed"
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "cancelled"
  | "expired";

export interface AnalysisComputeJobCutView {
  name: string;
  original: string;
  validatedSummary?: string;
  confidence?: number;
  expressionType?: string;
  userSummary?: string;
  rawExpression?: string;
}

export interface AnalysisComputeJobView {
  id: string;
  jobType: "banner_extension_recompute" | "table_rollup_derivation" | "selected_table_cut_derivation";
  status: AnalysisComputeJobClientStatus;
  effectiveStatus: AnalysisComputeJobClientStatus;
  requestText: string;
  proposedGroup?: {
    groupName: string;
    cuts: AnalysisComputeJobCutView[];
  };
  proposedTableRollup?: {
    sourceTables: Array<{
      tableId: string;
      title: string;
      questionText: string | null;
      rollups: Array<{
        label: string;
        components: Array<{
          rowKey: string;
          label: string;
        }>;
      }>;
    }>;
  };
  proposedSelectedTableCut?: {
    sourceTable: {
      tableId: string;
      title: string;
      questionText: string | null;
    };
    groupName: string;
    cuts: Array<{
      name: string;
      original: string;
      userSummary?: string;
    }>;
  };
  reviewFlags?: {
    requiresClarification: boolean;
    requiresReview: boolean;
    reasons: string[];
    averageConfidence: number;
    policyFallbackDetected: boolean;
    draftConfidence?: number;
  };
  confirmToken?: string;
  childRun?: {
    id: string;
    status: string;
    executionState?: string;
    stage?: string;
    progress?: number;
    message?: string;
    expiredAt?: number;
    artifactsPurgedAt?: number;
    analysisUrl: string;
    analysisSessionId?: string;
  };
  derivedArtifactId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  completedAt?: number;
}

interface RawAnalysisComputeJob {
  _id: unknown;
  projectId: unknown;
  jobType: string;
  status: AnalysisComputeJobClientStatus;
  requestText: string;
  frozenBannerGroup?: unknown;
  frozenValidatedGroup?: unknown;
  frozenTableRollupSpec?: unknown;
  frozenSelectedTableCutSpec?: unknown;
  reviewFlags?: unknown;
  fingerprint?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  confirmedAt?: number;
  completedAt?: number;
  derivedArtifactId?: unknown;
}

interface RawChildRun {
  _id: unknown;
  status: string;
  executionState?: string;
  stage?: string;
  progress?: number;
  message?: string;
  expiredAt?: number;
  artifactsPurgedAt?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function buildReviewFlags(value: unknown): AnalysisComputeJobView["reviewFlags"] | undefined {
  const record = asRecord(value);
  if (!record) return undefined;

  return {
    requiresClarification: record.requiresClarification === true,
    requiresReview: record.requiresReview === true,
    reasons: Array.isArray(record.reasons)
      ? record.reasons.filter((reason): reason is string => typeof reason === "string")
      : [],
    averageConfidence: optionalNumber(record.averageConfidence) ?? 0,
    policyFallbackDetected: record.policyFallbackDetected === true,
    ...(optionalNumber(record.draftConfidence) !== undefined
      ? { draftConfidence: optionalNumber(record.draftConfidence) }
      : {}),
  };
}

function buildProposedGroup(job: RawAnalysisComputeJob): AnalysisComputeJobView["proposedGroup"] | undefined {
  const bannerGroup = asRecord(job.frozenBannerGroup);
  if (!bannerGroup) return undefined;

  const groupName = optionalString(bannerGroup.groupName);
  const bannerColumns = Array.isArray(bannerGroup.columns) ? bannerGroup.columns : [];
  if (!groupName || bannerColumns.length === 0) return undefined;

  const validatedGroup = asRecord(job.frozenValidatedGroup);
  const validatedColumns = Array.isArray(validatedGroup?.columns) ? validatedGroup.columns : [];
  const validatedByName = new Map<string, Record<string, unknown>>();
  for (const entry of validatedColumns) {
    const record = asRecord(entry);
    const name = optionalString(record?.name);
    if (record && name) validatedByName.set(name, record);
  }

  const cuts = bannerColumns.flatMap<AnalysisComputeJobCutView>((entry) => {
    const record = asRecord(entry);
    const name = optionalString(record?.name);
    const original = optionalString(record?.original);
    if (!name || !original) return [];

    const validated = validatedByName.get(name);
    const confidence = optionalNumber(validated?.confidence);
    return [{
      name,
      original,
      ...(optionalString(validated?.userSummary) ? { userSummary: optionalString(validated?.userSummary) } : {}),
      ...(optionalString(validated?.reasoning) ? { validatedSummary: optionalString(validated?.reasoning) } : {}),
      ...(confidence !== undefined ? { confidence } : {}),
      ...(optionalString(validated?.expressionType) ? { expressionType: optionalString(validated?.expressionType) } : {}),
      ...(optionalString(validated?.adjusted) ? { rawExpression: optionalString(validated?.adjusted) } : {}),
    }];
  });

  return cuts.length > 0 ? { groupName, cuts } : undefined;
}

function buildProposedTableRollup(job: RawAnalysisComputeJob): AnalysisComputeJobView["proposedTableRollup"] | undefined {
  const spec = asRecord(job.frozenTableRollupSpec);
  if (!spec) return undefined;
  const sourceTables = asRecord(spec.sourceTable)
    ? [spec.sourceTable]
    : Array.isArray(spec.sourceTables)
      ? spec.sourceTables
      : [];
  const safeTables = sourceTables.flatMap((entry) => {
    const table = asRecord(entry);
    const tableId = optionalString(table?.tableId);
    const title = optionalString(table?.title);
    if (!tableId || !title) return [];
    const rollups = Array.isArray(spec.outputRows)
      ? spec.outputRows
      : Array.isArray(table?.rollups)
        ? table.rollups
        : [];
    const safeRollups = rollups.flatMap((rollupEntry) => {
      const rollup = asRecord(rollupEntry);
      const label = optionalString(rollup?.label);
      if (!label) return [];
      const components = Array.isArray(rollup?.sourceRows)
        ? rollup.sourceRows
        : Array.isArray(rollup?.components)
          ? rollup.components
          : [];
      const safeComponents = components.flatMap((componentEntry) => {
        const component = asRecord(componentEntry);
        const rowKey = optionalString(component?.rowKey);
        const componentLabel = optionalString(component?.label);
        return rowKey && componentLabel ? [{ rowKey, label: componentLabel }] : [];
      });
      return safeComponents.length >= 2 ? [{ label, components: safeComponents }] : [];
    });
    return safeRollups.length > 0
      ? [{
          tableId,
          title,
          questionText: optionalString(table?.questionText) ?? null,
          rollups: safeRollups,
        }]
      : [];
  });

  return safeTables.length > 0 ? { sourceTables: safeTables } : undefined;
}

function buildProposedSelectedTableCut(job: RawAnalysisComputeJob): AnalysisComputeJobView["proposedSelectedTableCut"] | undefined {
  const spec = asRecord(job.frozenSelectedTableCutSpec);
  if (!spec) return undefined;
  const sourceTable = asRecord(spec.sourceTable);
  const tableId = optionalString(sourceTable?.tableId);
  const title = optionalString(sourceTable?.title);
  const groupName = optionalString(spec.groupName);
  if (!tableId || !title || !groupName) return undefined;

  const validatedGroup = asRecord(asRecord(spec.resolvedComputePlan)?.validatedGroup);
  const validatedColumns = Array.isArray(validatedGroup?.columns) ? validatedGroup.columns : [];
  const validatedByName = new Map<string, Record<string, unknown>>();
  for (const entry of validatedColumns) {
    const record = asRecord(entry);
    const name = optionalString(record?.name);
    if (record && name) validatedByName.set(name, record);
  }

  const cuts = Array.isArray(spec.cuts)
    ? spec.cuts.flatMap((entry) => {
        const cut = asRecord(entry);
        const name = optionalString(cut?.name);
        const original = optionalString(cut?.original);
        if (!name || !original) return [];
        const validated = validatedByName.get(name);
        return [{
          name,
          original,
          ...(optionalString(validated?.userSummary) ? { userSummary: optionalString(validated?.userSummary) } : {}),
        }];
      })
    : [];

  return cuts.length > 0
    ? {
        sourceTable: {
          tableId,
          title,
          questionText: optionalString(sourceTable?.questionText) ?? null,
        },
        groupName,
        cuts,
      }
    : undefined;
}

function deriveEffectiveStatus(
  jobStatus: AnalysisComputeJobClientStatus,
  childRun?: RawChildRun | null,
  parentRunExpired?: boolean,
): AnalysisComputeJobClientStatus {
  if (jobStatus === "failed" || jobStatus === "cancelled" || jobStatus === "expired") {
    return jobStatus;
  }

  if (childRun && (childRun.expiredAt || childRun.artifactsPurgedAt)) return "expired";
  if (jobStatus === "success") return "success";
  if (!childRun) return parentRunExpired ? "expired" : jobStatus;

  if (childRun.status === "success" || childRun.status === "partial") return "success";
  if (childRun.status === "error") return "failed";
  if (childRun.status === "cancelled") return "cancelled";
  if (childRun.executionState === "queued") return "queued";
  if (childRun.status === "in_progress" || childRun.status === "resuming") return "running";

  return jobStatus;
}

export function buildAnalysisComputeJobView(params: {
  job: RawAnalysisComputeJob;
  childRun?: RawChildRun | null;
  childAnalysisSessionId?: string | null;
  parentRunExpired?: boolean;
}): AnalysisComputeJobView {
  const reviewFlags = buildReviewFlags(params.job.reviewFlags);
  const effectiveStatus = deriveEffectiveStatus(params.job.status, params.childRun, params.parentRunExpired);
  const canConfirm = params.job.status === "proposed"
    && effectiveStatus === "proposed"
    && Boolean(params.job.fingerprint)
    && reviewFlags?.requiresClarification !== true
    && reviewFlags?.requiresReview !== true;

  return {
    id: String(params.job._id),
    jobType: params.job.jobType === "table_rollup_derivation"
      ? "table_rollup_derivation"
      : params.job.jobType === "selected_table_cut_derivation"
        ? "selected_table_cut_derivation"
        : "banner_extension_recompute",
    status: params.job.status,
    effectiveStatus,
    requestText: params.job.requestText,
    ...(buildProposedGroup(params.job) ? { proposedGroup: buildProposedGroup(params.job) } : {}),
    ...(buildProposedTableRollup(params.job) ? { proposedTableRollup: buildProposedTableRollup(params.job) } : {}),
    ...(buildProposedSelectedTableCut(params.job) ? { proposedSelectedTableCut: buildProposedSelectedTableCut(params.job) } : {}),
    ...(reviewFlags ? { reviewFlags } : {}),
    ...(canConfirm && params.job.fingerprint ? { confirmToken: params.job.fingerprint } : {}),
    ...(params.childRun
      ? {
          childRun: {
            id: String(params.childRun._id),
            status: params.childRun.status,
            ...(params.childRun.executionState ? { executionState: params.childRun.executionState } : {}),
            ...(params.childRun.stage ? { stage: params.childRun.stage } : {}),
            ...(typeof params.childRun.progress === "number" ? { progress: params.childRun.progress } : {}),
            ...(params.childRun.message ? { message: params.childRun.message } : {}),
            ...(params.childRun.expiredAt ? { expiredAt: params.childRun.expiredAt } : {}),
            ...(params.childRun.artifactsPurgedAt ? { artifactsPurgedAt: params.childRun.artifactsPurgedAt } : {}),
            analysisUrl: `/projects/${encodeURIComponent(String(params.job.projectId))}/runs/${encodeURIComponent(String(params.childRun._id))}/analysis`,
            ...(params.childAnalysisSessionId ? { analysisSessionId: params.childAnalysisSessionId } : {}),
          },
        }
      : {}),
    ...(params.job.derivedArtifactId ? { derivedArtifactId: String(params.job.derivedArtifactId) } : {}),
    ...(params.job.error ? { error: params.job.error } : {}),
    createdAt: params.job.createdAt,
    updatedAt: params.job.updatedAt,
    ...(params.job.confirmedAt ? { confirmedAt: params.job.confirmedAt } : {}),
    ...(params.job.completedAt ? { completedAt: params.job.completedAt } : {}),
  };
}
