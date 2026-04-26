export function getAnalysisEvidenceAnchorId(anchorId: string): string {
  return `analysis-evidence-${anchorId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}

export function getAnalysisCellAnchorId(cellId: string): string {
  return `analysis-cell-${cellId.replace(/[^a-zA-Z0-9_-]+/g, "-")}`;
}
