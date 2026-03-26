/**
 * LoopDetector.ts
 *
 * Detects loop/iteration patterns in variable names using tokenization
 * and diversity analysis. Pure functions, no external dependencies.
 *
 * Algorithm (two-pass "Anchor & Satellite"):
 * 1. Tokenize each variable name into alpha/numeric/separator tokens
 * 2. Create a skeleton pattern (e.g., 'A4_1' → 'A-N-_-N')
 * 3. Group variables by skeleton
 * 4. For each numeric position, compute diversity (unique bases per iteration value)
 * 5. Pass 1: Strict thresholds (diversity >= 3, iterations >= 2) → "anchors"
 * 6. Pass 2: Rejected groups with matching iteration signature → "satellites"
 *
 * NOTE: The detector groups by skeleton pattern (naming structure). These
 * skeleton-based groups are INTERNAL — they help identify the iterator
 * position for each naming pattern. LoopCollapser.mergeLoopGroups() then
 * merges groups with the same iteration values into a single unified group
 * for R script generation. Do NOT rely on skeleton groups as the final
 * loop structure.
 */

import type { Token, LoopGroup, LoopDetectionResult } from './types';

// =============================================================================
// Tokenization
// =============================================================================

/**
 * Tokenize a variable name into alpha, numeric, and separator tokens.
 * e.g., 'A4_1' → [{alpha,'A'}, {numeric,'4'}, {sep,'_'}, {numeric,'1'}]
 */
export function tokenize(varName: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < varName.length) {
    const char = varName[i];

    if (/[a-zA-Z]/.test(char)) {
      // Collect consecutive alpha chars
      let value = '';
      while (i < varName.length && /[a-zA-Z]/.test(varName[i])) {
        value += varName[i];
        i++;
      }
      tokens.push({ type: 'alpha', value });
    } else if (/[0-9]/.test(char)) {
      // Collect consecutive digits
      let value = '';
      while (i < varName.length && /[0-9]/.test(varName[i])) {
        value += varName[i];
        i++;
      }
      tokens.push({ type: 'numeric', value });
    } else {
      // Separator (_, -, etc.)
      tokens.push({ type: 'separator', value: char });
      i++;
    }
  }

  return tokens;
}

/**
 * Create a skeleton pattern from tokens.
 * Replaces specific values with type indicators.
 * e.g., [{alpha,'A'}, {numeric,'4'}, {sep,'_'}, {numeric,'1'}] → 'A-N-_-N'
 *
 * Alpha tokens keep their value (they distinguish question stems).
 * Numeric tokens become 'N'.
 * Separator tokens keep their value.
 */
export function createSkeleton(tokens: Token[]): string {
  return tokens
    .map((t) => {
      switch (t.type) {
        case 'alpha':
          return t.value;
        case 'numeric':
          return 'N';
        case 'separator':
          return t.value;
      }
    })
    .join('-');
}

// =============================================================================
// Loop Detection — Helpers
// =============================================================================

interface SkeletonAnalysis {
  bestPosition: number;
  bestDiversity: number;
  bestIterations: string[];
  bestBases: string[];
  /** The separator token value at position-1 of the iterator (e.g., '_'), or null */
  separatorType: string | null;
}

type TokenizedMember = { name: string; tokens: Token[]; skeleton: string };

/**
 * Analyze a skeleton group to find the best iterator position.
 * Returns null if no valid position found (< 2 iterations at every position).
 * Callers decide acceptance thresholds on the returned analysis.
 */
function analyzeSkeletonGroup(
  members: TokenizedMember[],
): SkeletonAnalysis | null {
  const sampleTokens = members[0].tokens;
  const numericPositions: number[] = [];
  for (let i = 0; i < sampleTokens.length; i++) {
    if (sampleTokens[i].type === 'numeric') {
      numericPositions.push(i);
    }
  }

  if (numericPositions.length < 2) return null; // Need at least 2 numeric positions

  // Only consider positions preceded by a separator (like '_') as loop iterator candidates.
  // This filters out grid dimensions (r1, c1) which are preceded by alpha tokens.
  const loopCandidatePositions = numericPositions.filter((pos) => {
    if (pos === 0) return true; // First position is always a candidate
    return sampleTokens[pos - 1].type === 'separator';
  });

  let bestPosition = -1;
  let bestDiversity = 0;
  let bestIterations: string[] = [];
  let bestBases: string[] = [];

  for (const pos of loopCandidatePositions) {
    // Group by the value at this position → for each value, collect unique bases
    const iterationToVariables = new Map<string, Set<string>>();

    for (const member of members) {
      const iterValue = member.tokens[pos].value;

      // Build the base by replacing this position's value with a placeholder
      const baseParts = member.tokens.map((t, i) =>
        i === pos ? '*' : t.value
      );
      const base = baseParts.join('');

      if (!iterationToVariables.has(iterValue)) {
        iterationToVariables.set(iterValue, new Set());
      }
      iterationToVariables.get(iterValue)!.add(base);
    }

    const iterations = Array.from(iterationToVariables.keys());
    if (iterations.length < 2) continue; // Need at least 2 iterations

    // Diversity = number of unique bases across all iterations
    const allBases = new Set<string>();
    for (const bases of iterationToVariables.values()) {
      for (const base of bases) {
        allBases.add(base);
      }
    }
    const diversity = allBases.size;

    if (diversity > bestDiversity) {
      bestDiversity = diversity;
      bestPosition = pos;
      bestIterations = iterations.sort((a, b) => parseInt(a) - parseInt(b));
      bestBases = Array.from(allBases).sort();
    }
  }

  if (bestPosition === -1) return null;

  // Determine separator type: the token immediately before the iterator position
  let separatorType: string | null = null;
  if (bestPosition > 0 && sampleTokens[bestPosition - 1].type === 'separator') {
    separatorType = sampleTokens[bestPosition - 1].value;
  }

  return { bestPosition, bestDiversity, bestIterations, bestBases, separatorType };
}

/**
 * Build an adoption key from iteration values + separator type.
 * Used to match satellites to their anchor loops.
 */
function buildAdoptionKey(iterations: string[], separatorType: string | null): string {
  return `${iterations.join(',')}_sep=${separatorType ?? 'none'}`;
}

// =============================================================================
// Loop Detection — Main
// =============================================================================

/**
 * Detect loop patterns in a list of variable names.
 *
 * Two-pass "Anchor & Satellite" algorithm:
 *   Pass 1 — Strict thresholds find high-confidence "anchors" (diversity >= 3).
 *   Pass 2 — Rejected groups that share an anchor's iteration signature
 *            (same iterations + same separator) are adopted as "satellites".
 */
export function detectLoops(variableNames: string[]): LoopDetectionResult {
  if (variableNames.length === 0) {
    return { hasLoops: false, loops: [], nonLoopVariables: [] };
  }

  // Step 1: Tokenize and group by skeleton
  const tokenized: TokenizedMember[] = variableNames.map((name) => ({
    name,
    tokens: tokenize(name),
    skeleton: '',
  }));

  for (const item of tokenized) {
    item.skeleton = createSkeleton(item.tokens);
  }

  // Group by skeleton
  const skeletonGroups = new Map<string, TokenizedMember[]>();
  for (const item of tokenized) {
    const group = skeletonGroups.get(item.skeleton) || [];
    group.push(item);
    skeletonGroups.set(item.skeleton, group);
  }

  // Step 2: Analyze all skeleton groups and split into anchors vs rejected
  const detectedLoops: LoopGroup[] = [];
  const loopVariableSet = new Set<string>();
  const anchorMap = new Map<string, true>(); // adoption key → exists
  const rejectedGroups: Array<{
    skeleton: string;
    analysis: SkeletonAnalysis;
    members: TokenizedMember[];
  }> = [];

  for (const [skeleton, members] of skeletonGroups.entries()) {
    // Need at least 2 variables to even analyze (single variable can't be a loop)
    if (members.length < 2) continue;

    const analysis = analyzeSkeletonGroup(members);
    if (!analysis) continue;

    // Pass 1: Strict thresholds — certified anchors
    if (analysis.bestDiversity >= 3 && analysis.bestIterations.length >= 2) {
      const loop: LoopGroup = {
        skeleton,
        iteratorPosition: analysis.bestPosition,
        iterations: analysis.bestIterations,
        bases: analysis.bestBases,
        variables: members.map((m) => m.name),
        diversity: analysis.bestDiversity,
      };

      detectedLoops.push(loop);
      for (const member of members) {
        loopVariableSet.add(member.name);
      }

      // Register this anchor's adoption key
      const key = buildAdoptionKey(analysis.bestIterations, analysis.separatorType);
      anchorMap.set(key, true);
    } else {
      // Stash for Pass 2
      rejectedGroups.push({ skeleton, analysis, members });
    }
  }

  // Pass 2: Satellite adoption — sweep rejected groups
  for (const { skeleton, analysis, members } of rejectedGroups) {
    // Must have at least 2 members and 2 detected iterations
    if (members.length < 2) continue;
    if (analysis.bestIterations.length < 2) continue;

    // Does a certified anchor with the same iteration signature exist?
    const adoptionKey = buildAdoptionKey(analysis.bestIterations, analysis.separatorType);
    if (anchorMap.has(adoptionKey)) {
      const loop: LoopGroup = {
        skeleton,
        iteratorPosition: analysis.bestPosition,
        iterations: analysis.bestIterations,
        bases: analysis.bestBases,
        variables: members.map((m) => m.name),
        diversity: analysis.bestDiversity,
      };

      detectedLoops.push(loop);
      for (const member of members) {
        loopVariableSet.add(member.name);
      }
    }
  }

  // Collect non-loop variables
  const nonLoopVariables = variableNames.filter(
    (name) => !loopVariableSet.has(name)
  );

  return {
    hasLoops: detectedLoops.length > 0,
    loops: detectedLoops,
    nonLoopVariables,
  };
}
