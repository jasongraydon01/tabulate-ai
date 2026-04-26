export interface ProjectRunLineageFields {
  status?: string;
  origin?: string;
  parentRunId?: unknown;
  analysisComputeJobId?: unknown;
  lineageKind?: string;
}

export function isAnalysisComputeRun(run: ProjectRunLineageFields | null | undefined): boolean {
  return Boolean(
    run
    && (
      run.origin === 'analysis_compute'
      || run.parentRunId
      || run.analysisComputeJobId
      || run.lineageKind === 'banner_extension'
    ),
  );
}

export function isCompletedRun(run: { status?: string } | null | undefined): boolean {
  return run?.status === 'success' || run?.status === 'partial';
}

export function isProjectDefaultCandidate(run: ProjectRunLineageFields | null | undefined): boolean {
  if (!run) return false;
  return !isAnalysisComputeRun(run) || isCompletedRun(run);
}

export function selectPrimaryProjectRun<T extends ProjectRunLineageFields>(
  runs: readonly T[] | null | undefined,
): T | undefined {
  if (!runs || runs.length === 0) return undefined;
  return runs.find(isProjectDefaultCandidate) ?? runs[0];
}
