import type {
  CanonicalBaseDisclosure,
  CanonicalBaseNoteToken,
  CanonicalBaseRangeDisclosure,
} from './types';

export interface BaseDisclosurePresentationInput {
  baseDisclosure?: CanonicalBaseDisclosure | null;
  baseText?: string | null;
  userNote?: string | null;
  basePolicy?: string | null;
}

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

function buildLegacyNoteTokens(basePolicy: string | null | undefined): CanonicalBaseNoteToken[] {
  const policy = normalizeText(basePolicy) ?? '';
  return policy.includes('rebased') ? ['rebased-exclusion'] : [];
}

function formatQuotedLabelList(labels: string[]): string {
  if (labels.length === 0) return 'non-substantive responses';
  if (labels.length === 1) return `"${labels[0]}"`;
  if (labels.length === 2) return `"${labels[0]}" and "${labels[1]}"`;
  return `${labels.slice(0, -1).map(label => `"${label}"`).join(', ')}, and "${labels[labels.length - 1]}"`;
}

function buildRebasedExclusionNote(excludedResponseLabels: string[] | null | undefined): string {
  const labels = (excludedResponseLabels ?? []).map(label => label.trim()).filter(Boolean);
  if (labels.length === 0) {
    return 'Rebased to exclude non-substantive responses';
  }

  return `Rebased to exclude ${formatQuotedLabelList(labels)} from base`;
}

export function renderBaseDisclosureNoteParts(
  tokens: CanonicalBaseNoteToken[],
  rangeDisclosure: CanonicalBaseRangeDisclosure | null,
  excludedResponseLabels?: string[] | null,
): string[] {
  const noteTokens = new Set(tokens);
  const notes: string[] = [];

  if (noteTokens.has('anchor-base-varies-by-item')) {
    if (noteTokens.has('anchor-base-range') && rangeDisclosure) {
      notes.push(`Base varies by item (n=${rangeDisclosure.min}-${rangeDisclosure.max})`);
    } else {
      notes.push('Base varies by item');
    }
  } else if (noteTokens.has('anchor-base-range') && rangeDisclosure) {
    notes.push(`Base range: n=${rangeDisclosure.min}-${rangeDisclosure.max}`);
  }

  if (noteTokens.has('rebased-exclusion')) {
    notes.push(buildRebasedExclusionNote(excludedResponseLabels));
  }

  if (noteTokens.has('low-base-caution')) {
    notes.push('Caution: Low base size');
  }

  return notes;
}

export function buildBaseNoteParts(input: BaseDisclosurePresentationInput): string[] {
  const preservedNote = normalizeText(input.userNote);
  if (preservedNote) {
    return preservedNote.split(/\s*;\s*/).map(part => part.trim()).filter(Boolean);
  }

  if (input.baseDisclosure) {
    return renderBaseDisclosureNoteParts(
      input.baseDisclosure.defaultNoteTokens,
      input.baseDisclosure.rangeDisclosure,
      input.baseDisclosure.excludedResponseLabels,
    );
  }

  return renderBaseDisclosureNoteParts(buildLegacyNoteTokens(input.basePolicy), null);
}

export function buildBaseNoteText(input: BaseDisclosurePresentationInput): string | null {
  const notes = buildBaseNoteParts(input);
  return notes.length > 0 ? notes.join('; ') : null;
}

export function resolveDisplayBaseText(input: BaseDisclosurePresentationInput): string | null {
  const explicitBaseText = normalizeText(input.baseText);
  if (explicitBaseText) return explicitBaseText;

  if (input.baseDisclosure?.defaultBaseText) {
    return normalizeText(input.baseDisclosure.defaultBaseText);
  }

  return null;
}

export function buildCompactBaseDisclosureText(
  input: BaseDisclosurePresentationInput,
): string | null {
  const displayBaseText = resolveDisplayBaseText(input);
  const noteText = buildBaseNoteText(input);

  if (displayBaseText && noteText) return `${displayBaseText}; ${noteText}`;
  return displayBaseText ?? noteText;
}
