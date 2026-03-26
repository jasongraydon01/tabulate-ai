import type { ValidationResultType } from '@/schemas/agentOutputSchema';

/**
 * Enhanced CutDefinition with fields needed for significance testing
 */
export type CutDefinition = {
  id: string;
  name: string;
  rExpression: string;
  statLetter: string;     // Stat letter for significance testing (A, B, C, etc.)
  groupName: string;      // Group this cut belongs to (for within-group comparisons)
  groupIndex: number;     // Position within group
  // Provenance tracking (populated after HITL review, empty for PipelineRunner)
  reviewAction: string;
  reviewHint: string;
  preReviewExpression: string;
};

/**
 * Group of cuts for within-group significance testing
 */
export type CutGroup = {
  groupName: string;
  cuts: CutDefinition[];
};

/**
 * Complete cuts specification with group structure for stat testing
 */
export type CutsSpec = {
  cuts: CutDefinition[];
  groups: CutGroup[];           // Preserve group structure for stat testing
  totalCut: CutDefinition | null;  // Reference to Total column
};

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Generate stat letter from index (A, B, C, ..., Z, AA, AB, ...)
 */
function getStatLetter(index: number): string {
  if (index < 26) {
    return String.fromCharCode(65 + index); // A-Z
  }
  // For 26+, use AA, AB, etc.
  const first = Math.floor(index / 26) - 1;
  const second = index % 26;
  return String.fromCharCode(65 + first) + String.fromCharCode(65 + second);
}

function getNextAvailableStatLetter(
  startIndex: number,
  reservedLetters: ReadonlySet<string>,
): { statLetter: string; nextIndex: number } {
  let candidateIndex = startIndex;

  while (true) {
    const statLetter = getStatLetter(candidateIndex);
    candidateIndex++;

    if (!reservedLetters.has(statLetter)) {
      return {
        statLetter,
        nextIndex: candidateIndex,
      };
    }
  }
}

/**
 * Disambiguate cut names that collide across groups.
 *
 * R named lists require unique keys. When two banner groups have columns with
 * the same display name (e.g., both "Brand A Usage" and "Brand B Usage"
 * have "User" / "Non-User"), the second overwrites the first in the R `cuts`
 * list. This function detects collisions and prefixes with the group name:
 *   "User" → "Brand A Usage: User" / "Brand B Usage: User"
 *
 * Only renames cuts that actually collide — unique names are left as-is.
 * Mutates the CutDefinition objects in place (same refs in cuts[] and groups[].cuts[]).
 */
function ensureUniqueCutNames(cuts: CutDefinition[]): number {
  // Count occurrences of each name (excluding Total, which is always unique)
  const nameCounts = new Map<string, number>();
  for (const cut of cuts) {
    if (cut.name === 'Total') continue;
    nameCounts.set(cut.name, (nameCounts.get(cut.name) || 0) + 1);
  }

  // Rename colliding cuts: "Name" → "GroupName: Name"
  // Then enforce global uniqueness (including same-group collisions) by
  // appending numeric suffixes: "(2)", "(3)", ...
  const usedNames = new Set<string>();
  let renamedCount = 0;
  for (const cut of cuts) {
    const originalName = cut.name;
    let candidateName = originalName;

    if (cut.name !== 'Total' && (nameCounts.get(cut.name) || 0) > 1) {
      candidateName = `${cut.groupName}: ${cut.name}`;
    }

    if (usedNames.has(candidateName)) {
      let suffix = 2;
      let suffixed = `${candidateName} (${suffix})`;
      while (usedNames.has(suffixed)) {
        suffix++;
        suffixed = `${candidateName} (${suffix})`;
      }
      candidateName = suffixed;
    }

    if (candidateName !== originalName) {
      cut.name = candidateName;
      // Update id to reflect new display name
      cut.id = `${slugify(cut.groupName)}.${slugify(candidateName)}`;
      renamedCount++;
    }
    usedNames.add(cut.name);
  }

  return renamedCount;
}

/**
 * Build CutsSpec from CrosstabAgent validation output
 *
 * Generates stat letters deterministically based on column order.
 * Total column is identified by name and tracked separately for stat testing.
 * Ensures cut names are globally unique (required by R named list semantics).
 */
export function buildCutsSpec(validation: ValidationResultType): CutsSpec {
  const cuts: CutDefinition[] = [];
  const groups: CutGroup[] = [];
  let letterIndex = 0;
  let skippedCount = 0;
  const reservedStatLetters = new Set<string>(['T']);

  // Always add Total as first cut (hardcoded - doesn't depend on banner agent)
  const totalCut: CutDefinition = {
    id: 'total.total',
    name: 'Total',
    rExpression: 'rep(TRUE, nrow(data))',  // All respondents
    statLetter: 'T',
    groupName: 'Total',
    groupIndex: 0,
    reviewAction: 'ai_original',
    reviewHint: '',
    preReviewExpression: '',
  };
  cuts.push(totalCut);
  groups.push({ groupName: 'Total', cuts: [totalCut] });

  for (const group of validation.bannerCuts) {
    const groupCuts: CutDefinition[] = [];

    for (let i = 0; i < group.columns.length; i++) {
      const col = group.columns[i];

      // Skip columns with zero confidence (failed to process)
      if (col.confidence === 0) {
        console.log(`[CutsSpec] Skipping column "${col.name}" in group "${group.groupName}" (confidence: 0)`);
        skippedCount++;
        continue;
      }

      const id = `${slugify(group.groupName)}.${slugify(col.name)}`;

      // Skip Total from banner agent output (we already added it above)
      const isTotal = col.name === 'Total' || group.groupName === 'Total';
      if (isTotal) {
        continue;
      }

      const nextLetter = getNextAvailableStatLetter(letterIndex, reservedStatLetters);
      const statLetter = nextLetter.statLetter;
      letterIndex = nextLetter.nextIndex;

      // Read provenance fields (set by applyDecisions for reviewed runs, absent for PipelineRunner)
      const colAny = col as Record<string, unknown>;

      const cut: CutDefinition = {
        id,
        name: col.name,
        rExpression: col.adjusted,
        statLetter,
        groupName: group.groupName,
        groupIndex: i,
        reviewAction: (colAny.reviewAction as string) || 'ai_original',
        reviewHint: (colAny.reviewHint as string) || '',
        preReviewExpression: (colAny.preReviewExpression as string) || '',
      };

      cuts.push(cut);
      groupCuts.push(cut);
    }

    // Only add group if it has valid cuts
    if (groupCuts.length > 0) {
      groups.push({ groupName: group.groupName, cuts: groupCuts });
    }
  }

  if (skippedCount > 0) {
    console.log(`[CutsSpec] Skipped ${skippedCount} columns with zero confidence`);
  }

  // Ensure all cut names are unique across groups (R named lists require unique keys)
  const renamedCount = ensureUniqueCutNames(cuts);
  if (renamedCount > 0) {
    console.log(`[CutsSpec] Disambiguated ${renamedCount} cuts with duplicate names across groups`);
  }

  return { cuts, groups, totalCut };
}

/**
 * Get cuts belonging to a specific group
 */
export function getCutsByGroup(cutsSpec: CutsSpec, groupName: string): CutDefinition[] {
  const group = cutsSpec.groups.find(g => g.groupName === groupName);
  return group ? group.cuts : [];
}

/**
 * Get all stat letters used in the cuts spec
 */
export function getStatLetters(cutsSpec: CutsSpec): string[] {
  return cutsSpec.cuts.map(c => c.statLetter);
}

/**
 * Get group names in order
 */
export function getGroupNames(cutsSpec: CutsSpec): string[] {
  return cutsSpec.groups.map(g => g.groupName);
}
