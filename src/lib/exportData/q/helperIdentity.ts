import { createHash } from 'crypto';

/**
 * Deterministic helper identity utility for Q export filter variables.
 * Used at manifest build time to compute stable helper variable names and labels.
 */

function sanitize(value: string): string {
  return value
    .replace(/[^A-Za-z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export interface HelperIdentity {
  helperVarName: string;
  helperVarLabel: string;
}

/**
 * Compute deterministic helper variable name and label for a filter.
 *
 * Naming algorithm (from plan):
 * - Seed: `${filterId}|${fingerprint}|${source}|${dataFrameRef}`
 * - Hash: sha256(seed).slice(0, 10)
 * - Slugs: sourceSlug = sanitize(sourceId).slice(0, 24), frameSlug = sanitize(dataFrameRef).slice(0, 12)
 * - Prefix: htf_cut for cut filters, htf_tbl for table additional filters
 * - Candidate: `${prefix}_${sourceSlug}_${frameSlug}_${hash}`
 *   - Fallback shorten if > 80 chars: `${prefix}_${frameSlug}_${hash}`, then `${prefix}_${hash}`
 *
 * Label: `HT Filter: ${sourceId} [${dataFrameRef}]`
 */
export function computeHelperIdentity(params: {
  filterId: string;
  fingerprint: string;
  source: 'cut' | 'table';
  sourceId: string;
  dataFrameRef: string;
  columnName?: string;
}): HelperIdentity {
  const { filterId, fingerprint, source, sourceId, dataFrameRef, columnName } = params;

  const seed = `${filterId}|${fingerprint}|${source}|${dataFrameRef}`;
  const hash = createHash('sha256').update(seed).digest('hex').slice(0, 10);

  const sourceSlug = sanitize(sourceId).slice(0, 24);
  const frameSlug = sanitize(dataFrameRef).slice(0, 12);
  const prefix = source === 'cut' ? 'htf_cut' : 'htf_tbl';

  let candidate = `${prefix}_${sourceSlug}_${frameSlug}_${hash}`;
  if (candidate.length > 80) {
    candidate = `${prefix}_${frameSlug}_${hash}`;
  }
  if (candidate.length > 80) {
    candidate = `${prefix}_${hash}`;
  }

  // For cut filters, the label becomes the banner column header in Q.
  // Use the clean column name (e.g., "Male") so analysts see readable headers.
  // For table additional filters, use the technical label for diagnostics.
  const helperVarLabel = source === 'cut' && columnName
    ? columnName
    : `HT Filter: ${sourceId} [${dataFrameRef}]`;

  return {
    helperVarName: candidate,
    helperVarLabel,
  };
}
