import { buildSurveyOutline, segmentSurvey } from '../survey/surveyChunker';
import { extractSurveyQuestionIds } from '../survey/surveyQuestionFilter';

export type CandidateDimension = 'table' | 'row' | 'column' | 'unknown';

export interface CandidateEvidence {
  lineNumber: number;
  snippet: string;
  context: string;
}

export interface SkipLogicCandidate {
  candidateId: string;
  questionId: string;
  inferredDimension: CandidateDimension;
  evidence: CandidateEvidence[];
  sourceTags: string[];
  contextBlock: string;
}

export interface CandidateExtractionResult {
  candidates: SkipLogicCandidate[];
  surveyOutline: string;
  surveyQuestionIds: string[];
  questionContexts: Record<string, string>;
  stats: {
    linesScanned: number;
    candidateLinesMatched: number;
    candidatesExtracted: number;
    groupedRangesExpanded: number;
  };
}

const QUESTION_LINE_PATTERN = /^\s*(?:#{1,3}\s+)?([A-Z][A-Za-z]*\d+[a-z]?)[\s.:\)]/;

const CANDIDATE_PATTERNS: Array<{ tag: string; regex: RegExp; dimension: CandidateDimension }> = [
  { tag: 'ask-if', regex: /\bask\s+if\b/i, dimension: 'table' },
  { tag: 'show-if', regex: /\bshow\s+if\b/i, dimension: 'table' },
  { tag: 'skip-to', regex: /\bskip\s+to\b/i, dimension: 'table' },
  { tag: 'base', regex: /\bbase\s*:/i, dimension: 'table' },
  { tag: 'if-for-any-row', regex: /\bif\b[^\n]{0,180}\bfor\s+any\s+row\b/i, dimension: 'table' },
  { tag: 'only-show-rows', regex: /\bonly\s+show\s+rows?\b/i, dimension: 'row' },
  { tag: 'show-rows-for-which', regex: /\bshow\s+rows?\s+for\s+which\b/i, dimension: 'row' },
  { tag: 'only-show-therapy', regex: /\bonly\s+show\s+therapy\b/i, dimension: 'row' },
  { tag: 'only-show-columns', regex: /\bonly\s+show\s+columns?\b/i, dimension: 'column' },
  { tag: 'column-shown-only-if', regex: /\bcolumn\s*\d+[^\n]{0,120}\bshown\s+only\s+if\b/i, dimension: 'column' },
  { tag: 'do-not-show-columns', regex: /\bdo\s+not\s+show\s+columns?\b/i, dimension: 'column' },
];

const NEGATIVE_PATTERNS: RegExp[] = [
  /\bask\s+all\b/i,
  /\bshow\s+row\s+headers?\b/i,
  /\bnumerical\s+open\s+end\b/i,
  /\bautosum\b/i,
  /\bmust\s+add\s+to\b/i,
  /\brange\s+\d+\s*-\s*\d+/i,
  /\ballow\s+\d+\s*-\s*\d+\s+if\b/i,
  /\bif\b[^\n]{0,120}\bshow\s*:/i,
  /\basked\s+to\s+pass\s+on\b/i,
];

const PRE_QUESTION_DIRECTIVE_PATTERN = /^\s*\[?\s*(?:ask\s+if|show\s+if|if\b|base\s*:|skip\s+to|only\s+show|show\s+rows?\s+for\s+which)\b/i;

function normalizeLine(raw: string): string {
  return raw
    .replace(/\{\{PROG:/gi, '')
    .replace(/\{\{TERM:/gi, '')
    .replace(/\}\}/g, '')
    .replace(/\\\[/g, '[')
    .replace(/\\\]/g, ']')
    .replace(/\*\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseQuestionIdOnLine(line: string): string {
  const match = line.match(QUESTION_LINE_PATTERN);
  return match?.[1] || '';
}

function hasNegativeSignal(line: string): boolean {
  return NEGATIVE_PATTERNS.some((pattern) => pattern.test(line));
}

function hasCandidateSignal(line: string): boolean {
  return CANDIDATE_PATTERNS.some((pattern) => pattern.regex.test(line));
}

function isLikelyCandidateLine(line: string): boolean {
  if (!line) return false;
  if (/\bterminate\b/i.test(line)) return false;
  if (hasNegativeSignal(line)) return false;
  return hasCandidateSignal(line);
}

function inferDimension(line: string): CandidateDimension {
  const matched = CANDIDATE_PATTERNS.filter((p) => p.regex.test(line));
  if (matched.length === 0) return 'unknown';

  const hasRow = matched.some((m) => m.dimension === 'row');
  const hasColumn = matched.some((m) => m.dimension === 'column');
  const hasTable = matched.some((m) => m.dimension === 'table');

  if (hasRow && !hasColumn && !hasTable) return 'row';
  if (hasColumn && !hasRow && !hasTable) return 'column';
  if (hasTable && !hasRow && !hasColumn) return 'table';
  return 'unknown';
}

function extractPatternTags(line: string): string[] {
  const tags = CANDIDATE_PATTERNS.filter((p) => p.regex.test(line)).map((p) => p.tag);

  if (
    /\b(?:ask\s+if|show\s+if|skip\s+to|base\s*:|only\s+show\s+rows?|only\s+show\s+therapy|show\s+rows?\s+for\s+which)\b/i.test(
      line
    )
  ) {
    tags.push('explicit-question-gate');
  }

  return [...new Set(tags)];
}

function parseQuestionToken(token: string): { prefix: string; num: number; suffix: string } | null {
  const match = token.match(/^([A-Za-z]+)(\d+)([a-z]?)$/);
  if (!match) return null;

  return {
    prefix: match[1],
    num: parseInt(match[2], 10),
    suffix: match[3] || '',
  };
}

function toQuestionId(prefix: string, num: number, suffix: string): string {
  return `${prefix}${num}${suffix}`;
}

function expandRangeToken(startToken: string, endTokenRaw: string, knownQuestionIds: Set<string>): string[] {
  const start = parseQuestionToken(startToken);
  if (!start) return [startToken];

  const normalizedEnd = /^[0-9]/.test(endTokenRaw) ? `${start.prefix}${endTokenRaw}` : endTokenRaw;
  const end = parseQuestionToken(normalizedEnd);
  if (!end || start.prefix !== end.prefix) {
    return [startToken, normalizedEnd];
  }

  if (start.num === end.num && start.suffix && end.suffix) {
    const from = start.suffix.charCodeAt(0);
    const to = end.suffix.charCodeAt(0);
    if (from <= to && to - from <= 12) {
      const expanded = Array.from({ length: to - from + 1 }, (_, i) =>
        toQuestionId(start.prefix, start.num, String.fromCharCode(from + i))
      );
      const filtered = expanded.filter((id) => knownQuestionIds.has(id));
      return filtered.length > 0 ? filtered : expanded;
    }
  }

  if (!start.suffix && !end.suffix) {
    const minNum = Math.min(start.num, end.num);
    const maxNum = Math.max(start.num, end.num);
    if (maxNum - minNum <= 40) {
      const expanded = Array.from({ length: maxNum - minNum + 1 }, (_, i) =>
        toQuestionId(start.prefix, minNum + i, '')
      );
      const filtered = expanded.filter((id) => knownQuestionIds.has(id));
      return filtered.length > 0 ? filtered : expanded;
    }
  }

  return [startToken, normalizedEnd];
}

function extractStandaloneQuestionIds(text: string): string[] {
  const matches = text.match(/\b[A-Z][A-Za-z]*\d+[a-z]?\b/g) || [];
  return [...new Set(matches.map((m) => m.trim()))];
}

function extractTargetFragment(line: string): string {
  const match = line.match(/\b(?:ask|show|skip\s+to)\s+(.{1,180}?)(?=\bif\b|\bwhere\b|[\].,;:]|$)/i);
  return match?.[1]?.trim() || '';
}

function extractExplicitTargetsFromLine(
  line: string,
  knownQuestionIds: Set<string>
): { targets: string[]; expandedCount: number } {
  // For "ASK IF ..."/"SHOW IF ..." lines, condition IDs are source references, not targets.
  if (/\b(?:ask|show)\s+if\b/i.test(line)) {
    return { targets: [], expandedCount: 0 };
  }

  const targetFragment = extractTargetFragment(line);
  if (!targetFragment) {
    return { targets: [], expandedCount: 0 };
  }

  let expandedCount = 0;
  const fromRanges: string[] = [];
  const rangeRegex = /\b([A-Z][A-Za-z]*\d+[a-z]?)\s*(?:-|to)\s*([A-Z]?[A-Za-z]*\d+[a-z]?|\d+[a-z]?)\b/gi;

  let rangeMatch = rangeRegex.exec(targetFragment);
  while (rangeMatch) {
    const expanded = expandRangeToken(rangeMatch[1], rangeMatch[2], knownQuestionIds);
    if (expanded.length > 1) expandedCount += expanded.length - 1;
    fromRanges.push(...expanded);
    rangeMatch = rangeRegex.exec(targetFragment);
  }

  const noRanges = targetFragment.replace(rangeRegex, ' ');
  const standalone = extractStandaloneQuestionIds(noRanges);
  const combined = [...new Set([...fromRanges, ...standalone])];

  if (combined.length === 0) return { targets: [], expandedCount };

  const known = combined.filter((id) => knownQuestionIds.has(id));
  return { targets: known.length > 0 ? known : combined, expandedCount };
}

function normalizeQuestionId(id: string): string {
  return id.replace(/[^A-Za-z0-9]/g, '').trim();
}

function buildLineContext(lines: string[], lineIndex: number, window = 2): string {
  const start = Math.max(0, lineIndex - window);
  const end = Math.min(lines.length - 1, lineIndex + window);
  return lines.slice(start, end + 1).join('\n').trim();
}

interface NeighborInfo {
  currentQuestionId: string;
  currentDistance: number;
  nextQuestionId: string;
  nextDistance: number;
}

function getNeighborInfo(
  lineIndex: number,
  anchors: Array<{ questionId: string; lineIndex: number }>
): NeighborInfo {
  let currentQuestionId = '';
  let currentDistance = Number.MAX_SAFE_INTEGER;
  let nextQuestionId = '';
  let nextDistance = Number.MAX_SAFE_INTEGER;

  for (const anchor of anchors) {
    if (anchor.lineIndex <= lineIndex) {
      currentQuestionId = anchor.questionId;
      currentDistance = lineIndex - anchor.lineIndex;
      continue;
    }

    nextQuestionId = anchor.questionId;
    nextDistance = anchor.lineIndex - lineIndex;
    break;
  }

  return { currentQuestionId, currentDistance, nextQuestionId, nextDistance };
}

function shouldAttachToNextQuestion(line: string, info: NeighborInfo): boolean {
  if (!info.nextQuestionId) return false;
  const hasPreQuestionCue =
    PRE_QUESTION_DIRECTIVE_PATTERN.test(line) ||
    /\[\s*(?:ask\s+if|show\s+if)\b/i.test(line);
  if (!hasPreQuestionCue) return false;
  if (info.nextDistance > 4) return false;

  if (!info.currentQuestionId) return true;
  return info.currentDistance > info.nextDistance;
}

function mergeDimension(a: CandidateDimension, b: CandidateDimension): CandidateDimension {
  if (a === b) return a;
  if (a === 'unknown') return b;
  if (b === 'unknown') return a;
  return 'unknown';
}

export function extractSkipLogicCandidates(surveyMarkdown: string): CandidateExtractionResult {
  const surveyQuestionIds = extractSurveyQuestionIds(surveyMarkdown);
  const knownQuestionIds = new Set(surveyQuestionIds);

  const segments = segmentSurvey(surveyMarkdown);
  const questionContexts: Record<string, string> = {};
  for (const seg of segments) {
    if (seg.questionId && !questionContexts[seg.questionId]) {
      questionContexts[seg.questionId] = seg.text;
    }
  }

  const lines = surveyMarkdown.split('\n');
  const anchors = lines
    .map((line, idx) => ({ line, idx }))
    .map(({ line, idx }) => {
      const match = line.match(QUESTION_LINE_PATTERN);
      if (!match) return null;
      return { questionId: match[1], lineIndex: idx };
    })
    .filter((item): item is { questionId: string; lineIndex: number } => item !== null);

  const candidateMap = new Map<string, SkipLogicCandidate>();

  let candidateLinesMatched = 0;
  let groupedRangesExpanded = 0;

  for (let i = 0; i < lines.length; i++) {
    const normalizedLine = normalizeLine(lines[i]);
    if (!isLikelyCandidateLine(normalizedLine)) continue;

    candidateLinesMatched++;

    const questionOnLine = parseQuestionIdOnLine(normalizedLine);
    const neighborInfo = getNeighborInfo(i, anchors);

    const explicit = extractExplicitTargetsFromLine(normalizedLine, knownQuestionIds);
    groupedRangesExpanded += explicit.expandedCount;

    let targets: string[] = explicit.targets;

    if (targets.length === 0) {
      if (questionOnLine) {
        targets = [questionOnLine];
      } else if (shouldAttachToNextQuestion(normalizedLine, neighborInfo)) {
        targets = [neighborInfo.nextQuestionId];
      } else if (neighborInfo.currentQuestionId) {
        targets = [neighborInfo.currentQuestionId];
      }
    }

    const normalizedTargets = [...new Set(targets.map(normalizeQuestionId).filter(Boolean))];
    if (normalizedTargets.length === 0) continue;

    const inferred = inferDimension(normalizedLine);
    const sourceTags = extractPatternTags(normalizedLine);

    for (const questionId of normalizedTargets) {
      const existing = candidateMap.get(questionId);
      const evidenceEntry: CandidateEvidence = {
        lineNumber: i + 1,
        snippet: normalizedLine,
        context: buildLineContext(lines, i),
      };

      if (!existing) {
        const contextSource = questionContexts[questionId] || buildLineContext(lines, i, 5);
        const contextBlock = contextSource.length > 6000
          ? `${contextSource.slice(0, 6000)}\n...`
          : contextSource;

        candidateMap.set(questionId, {
          candidateId: `cand_${questionId.toLowerCase()}`,
          questionId,
          inferredDimension: inferred,
          evidence: [evidenceEntry],
          sourceTags,
          contextBlock,
        });
        continue;
      }

      existing.inferredDimension = mergeDimension(existing.inferredDimension, inferred);
      existing.sourceTags = [...new Set([...existing.sourceTags, ...sourceTags])];

      const alreadyPresent = existing.evidence.some(
        (ev) => ev.lineNumber === evidenceEntry.lineNumber && ev.snippet === evidenceEntry.snippet
      );
      if (!alreadyPresent) {
        existing.evidence.push(evidenceEntry);
      }
    }
  }

  const ordered = [...candidateMap.values()].sort((a, b) => {
    const aIdx = surveyQuestionIds.indexOf(a.questionId);
    const bIdx = surveyQuestionIds.indexOf(b.questionId);

    if (aIdx !== -1 && bIdx !== -1 && aIdx !== bIdx) return aIdx - bIdx;
    if (aIdx !== -1 && bIdx === -1) return -1;
    if (aIdx === -1 && bIdx !== -1) return 1;
    return a.questionId.localeCompare(b.questionId);
  });

  return {
    candidates: ordered,
    surveyOutline: buildSurveyOutline(surveyMarkdown),
    surveyQuestionIds,
    questionContexts,
    stats: {
      linesScanned: lines.length,
      candidateLinesMatched,
      candidatesExtracted: ordered.length,
      groupedRangesExpanded,
    },
  };
}

export function buildCandidateFromQuestionContext(args: {
  questionId: string;
  inferredDimension: CandidateDimension;
  evidenceSnippet: string;
  questionContexts: Record<string, string>;
}): SkipLogicCandidate {
  const contextSource = args.questionContexts[args.questionId] || args.evidenceSnippet;
  const contextBlock = contextSource.length > 6000
    ? `${contextSource.slice(0, 6000)}\n...`
    : contextSource;

  return {
    candidateId: `missing_${args.questionId.toLowerCase()}`,
    questionId: args.questionId,
    inferredDimension: args.inferredDimension,
    evidence: [
      {
        lineNumber: -1,
        snippet: args.evidenceSnippet,
        context: args.evidenceSnippet,
      },
    ],
    sourceTags: ['missing-sweep'],
    contextBlock,
  };
}
