export function getPreparingReviewMessage(flaggedColumnCount: number): string {
  return `Preparing review (${flaggedColumnCount} columns flagged) — completing table assembly...`;
}

export function getPendingReviewMessage(flaggedColumnCount: number): string {
  return `Review required - ${flaggedColumnCount} columns pending confirmation`;
}
