/**
 * V3 Runtime — Step 08a: Survey Parser + Deterministic Label Application
 *
 * Parses survey markdown into structured question/answer artifacts and applies
 * deterministic label reconciliation onto enriched QuestionIdEntry[].
 *
 * Ported from: scripts/v3-enrichment/08a-survey-parser.ts
 *
 * Logic summary:
 *   1) Load survey markdown (cached or via SurveyProcessor)
 *   2) Parse into ParsedSurveyQuestion[] using surveyChunker segments
 *   3) Reconcile: for each entry, find matching survey question, update
 *      questionText if survey is better, update item labels by code match
 *      or Jaccard text similarity
 *
 * No file I/O for output — the orchestrator handles artifact persistence.
 */

import fs from 'fs/promises';
import path from 'path';

import { processSurvey } from '@/lib/processors/SurveyProcessor';
import { findDatasetFiles } from '@/lib/pipeline/FileDiscovery';
import { segmentSurvey, type SurveySegment } from '@/lib/survey/surveyChunker';
import { matchesQuestionId } from '@/lib/survey/surveyQuestionFilter';

import type {
  QuestionIdEntry,
  SurveyMetadata,
  ParsedSurveyQuestion,
  ParsedAnswerOption,
  ParsedQuestionType,
  ParsedFormat,
} from '../types';

// =============================================================================
// Internal Types
// =============================================================================

interface NumberedHit {
  code: number;
  text: string;
  raw: string;
  start: number;
  source: 'numbered_list' | 'table';
}

/** Diff record for a single entry's label changes (audit trail). */
export interface LabelDiffEntry {
  questionId: string;
  anchorQuestionId: string;
  surveyQuestionId: string | null;
  questionTextChanged: boolean;
  itemLabelChanges: Array<{
    column: string;
    oldLabel: string;
    newLabel: string;
    method: 'code' | 'text';
    confidence: number;
  }>;
}

/** Stats from the reconciliation pass. */
export interface LinkStats {
  baseQuestionCount: number;
  matchedToSurveyCount: number;
  surveyTextHydrated: number;
  questionTextUpdates: number;
  itemLabelUpdates: number;
  entriesWithAnyChange: number;
  unmatchedBaseCount: number;
}

// =============================================================================
// Constants
// =============================================================================

const STRIP_MARKDOWN_FOR_ID = /\*+/g;

// =============================================================================
// Text Cleaning Helpers
// =============================================================================

/**
 * Remove PROG/TERM macros, markdown formatting, and collapse whitespace.
 */
function cleanText(input: string): string {
  return input
    .replace(/\{\{(?:PROG|TERM):[\s\S]*?\}\}/gi, ' ')
    .replace(/[_*`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Normalize a label to lowercase alphanumeric tokens for comparison.
 */
function normalizeLabel(input: string): string {
  return cleanText(input)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Tokenize a label into a set of lowercase tokens (length >= 2).
 */
function tokenizeLabel(input: string): Set<string> {
  return new Set(
    normalizeLabel(input)
      .split(' ')
      .map(t => t.trim())
      .filter(Boolean)
      .filter(t => t.length >= 2),
  );
}

/**
 * Jaccard similarity between two token sets.
 * Returns 1.0 for two empty sets.
 */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Returns true if the text is a placeholder (insert/pipe/anchor directives,
 * bare numbers, or very short strings).
 */
function isPlaceholderText(input: string): boolean {
  const t = normalizeLabel(input);
  if (!t) return true;
  if (t.length < 3) return true;
  if (/\b(insert|pipe|randomize|show|anchor|go to|continue|terminate)\b/i.test(t)) return true;
  if (/^\d+$/.test(t)) return true;
  return false;
}

// =============================================================================
// Extraction Helpers
// =============================================================================

function extractProgNotes(raw: string): string[] {
  return [...raw.matchAll(/\{\{PROG:[\s\S]*?\}\}/gi)].map(m => m[0]);
}

function extractStrikethrough(raw: string): string[] {
  return [...raw.matchAll(/~~([\s\S]*?)~~/g)].map(m => m[1].trim()).filter(Boolean);
}

function extractInstructionText(raw: string): string | null {
  const italicMatches = [...raw.matchAll(/_([^_]{2,250})_/g)].map(m => cleanText(m[1])).filter(Boolean);
  if (italicMatches.length === 0) return null;

  const explicit = italicMatches.find(m => /\b(select|rank|please|sum|estimate|apply)\b/i.test(m));
  return explicit ?? italicMatches[0] ?? null;
}

function stripTableArtifactsFromStem(input: string): string {
  let stem = input;

  // Cut at explicit markdown separator row if present.
  const sepIdx = stem.indexOf('| ---');
  if (sepIdx >= 0) {
    stem = stem.slice(0, sepIdx);
  }

  // Cut at the first obvious inline table scaffold (e.g., " | | | ").
  const scaffoldMatch = stem.match(/\s\|\s*\|\s*/);
  if (scaffoldMatch && scaffoldMatch.index !== undefined) {
    stem = stem.slice(0, scaffoldMatch.index);
  }

  // Cut at first standalone table row line.
  const lineTableMatch = stem.match(/\n\s*\|/);
  if (lineTableMatch && lineTableMatch.index !== undefined) {
    stem = stem.slice(0, lineTableMatch.index);
  }

  return stem.trim();
}

// =============================================================================
// Answer Option Extraction
// =============================================================================

/**
 * Extract numbered list items (e.g., "1. Option text") from raw survey text.
 */
function extractNumberedListHits(raw: string): NumberedHit[] {
  const hits: NumberedHit[] = [];
  const pattern = /(^|\n)\s*(\d{1,3})\.?\s+([^\n]+)(?=\n|$)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const code = Number(match[2]);
    if (!Number.isFinite(code)) continue;
    const text = match[3].trim();
    const start = match.index + match[1].length;
    hits.push({ code, text, raw: match[0], start, source: 'numbered_list' });
  }

  return hits;
}

/**
 * Extract table-formatted answer options (e.g., "| 1 | Option text |").
 */
function extractTableHits(raw: string): NumberedHit[] {
  const hits: NumberedHit[] = [];
  const pattern = /\|\s*(\d{1,3})\s*\|\s*([^|\n]{1,600}?)(?=\s*\|)/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw)) !== null) {
    const code = Number(match[1]);
    if (!Number.isFinite(code)) continue;
    const text = match[2].trim();
    hits.push({ code, text, raw: match[0], start: match.index, source: 'table' });
  }

  return hits;
}

/**
 * Returns true if `values` is a strictly sequential run of integers (length >= 4).
 */
function isSequential(values: number[]): boolean {
  if (values.length < 4) return false;
  const uniq = [...new Set(values)];
  if (uniq.length !== values.length) return false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] - values[i - 1] !== 1) return false;
  }
  return true;
}

/**
 * Detect Likert/rating scale artifacts in the raw text and suppress
 * numbered hits that are just scale column headers rather than answer options.
 */
function detectScaleArtifacts(
  raw: string,
  hits: NumberedHit[],
): { scaleLabels: Array<{ value: number; label: string }> | null; suppressHitIndexes: Set<number> } {
  const suppressHitIndexes = new Set<number>();
  const seqPattern = /\|\s*((?:\d{1,2}\s*\|\s*){4,11})/g;

  let bestSeq: number[] | null = null;
  let bestSeqIdx = -1;
  let match: RegExpExecArray | null;

  while ((match = seqPattern.exec(raw)) !== null) {
    const nums = [...match[1].matchAll(/\d{1,2}/g)].map(m => Number(m[0]));
    if (!isSequential(nums)) continue;
    if (!bestSeq || nums.length > bestSeq.length) {
      bestSeq = nums;
      bestSeqIdx = match.index;
    }
  }

  if (!bestSeq) {
    return { scaleLabels: null, suppressHitIndexes };
  }

  for (let i = 0; i < hits.length; i++) {
    const hit = hits[i];
    if (!bestSeq.includes(hit.code)) continue;
    const t = cleanText(hit.text);
    if (!t || /^\d+$/.test(t) || t.length <= 2) {
      suppressHitIndexes.add(i);
    }
  }

  const windowStart = Math.max(0, bestSeqIdx - 260);
  const windowEnd = Math.min(raw.length, bestSeqIdx + 260);
  const window = raw.slice(windowStart, windowEnd);

  const cells = window
    .split('|')
    .map(c => cleanText(c))
    .filter(Boolean)
    .filter(c => !/^\d+$/.test(c))
    .filter(c => !/^[-\s]+$/.test(c));

  let labels: string[] = [];
  if (cells.length >= bestSeq.length) {
    labels = cells.slice(0, bestSeq.length);
  } else if (cells.length >= 2) {
    labels = bestSeq.map((v, idx) => {
      if (idx === 0) return cells[0];
      if (idx === bestSeq!.length - 1) return cells[cells.length - 1];
      return String(v);
    });
  } else {
    labels = bestSeq.map(v => String(v));
  }

  const scaleLabels = bestSeq.map((value, idx) => ({
    value,
    label: labels[idx] ?? String(value),
  }));

  return { scaleLabels, suppressHitIndexes };
}

/**
 * De-duplicate hits by (source, code, normalizedText, start).
 */
function dedupeHits(hits: NumberedHit[]): NumberedHit[] {
  const seen = new Set<string>();
  const out: NumberedHit[] = [];

  for (const hit of hits.sort((a, b) => a.start - b.start)) {
    const key = `${hit.source}|${hit.code}|${normalizeLabel(hit.text)}|${hit.start}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }

  return out;
}

// =============================================================================
// Routing & Programming Note Extraction
// =============================================================================

function getRouting(raw: string): string | null {
  const upper = raw.toUpperCase();
  if (/\{\{TERM:\s*[^}]*TERMINATE/.test(upper) || /\bTERMINATE\b/.test(upper)) return 'TERMINATE';
  if (/\bCONTINUE\b/.test(upper)) return 'CONTINUE';
  const goTo = upper.match(/\bGO TO\s+([A-Z]\d+[A-Z]?)\b/);
  if (goTo) return `GO TO ${goTo[1]}`;
  return null;
}

function getProgNote(raw: string): string | null {
  const match = raw.match(/\{\{PROG:[\s\S]*?\}\}/i);
  return match ? match[0] : null;
}

// =============================================================================
// Question Type & Format Detection
// =============================================================================

function detectQuestionType(
  raw: string,
  instructionText: string | null,
  answerOptions: ParsedAnswerOption[],
  scaleLabels: Array<{ value: number; label: string }> | null,
): ParsedQuestionType {
  const lowerRaw = raw.toLowerCase();
  const lowerInstruction = (instructionText || '').toLowerCase();

  if (scaleLabels && answerOptions.length > 0) return 'grid';

  if (answerOptions.length > 0) {
    if (lowerInstruction.includes('select all')) return 'multi_select';
    if (lowerInstruction.includes('select one') || lowerInstruction.includes('select only one'))
      return 'single_select';
    return 'single_select';
  }

  if (raw.includes('___') || lowerRaw.includes('enter whole number') || lowerRaw.includes('insert numeric')) {
    return 'numeric';
  }

  if (/\[oe\]/i.test(raw) || (lowerRaw.includes('specify') && answerOptions.length === 0)) {
    return 'open_end';
  }

  return 'unknown';
}

function detectFormat(
  raw: string,
  answerOptionHits: NumberedHit[],
  scaleLabels: Array<{ value: number; label: string }> | null,
): ParsedFormat {
  if (scaleLabels && answerOptionHits.length > 0) return 'grid_with_items';
  if (answerOptionHits.some(h => h.source === 'table')) return 'table';
  if (answerOptionHits.some(h => h.source === 'numbered_list')) return 'numbered_list';
  if (raw.includes('___')) return 'free_entry';
  return 'unknown';
}

// =============================================================================
// Segment Parsing
// =============================================================================

/**
 * Parse a single survey segment (one question block) into a structured
 * ParsedSurveyQuestion.
 */
function parseSegment(segment: SurveySegment): ParsedSurveyQuestion {
  const rawText = segment.text.trim();
  const listHits = extractNumberedListHits(rawText);
  const tableHits = extractTableHits(rawText);
  const allHits = dedupeHits([...listHits, ...tableHits]);

  const scale = detectScaleArtifacts(rawText, allHits);
  const filteredHits = allHits.filter((_, idx) => !scale.suppressHitIndexes.has(idx));

  const answerOptions: ParsedAnswerOption[] = [];
  for (const hit of filteredHits) {
    const cleaned = cleanText(hit.text);
    if (!cleaned || isPlaceholderText(cleaned)) continue;

    const progNote = getProgNote(hit.raw) ?? getProgNote(hit.text);
    const routing = getRouting(hit.raw + ' ' + hit.text);
    const anchor = /\bANCHOR\b/i.test(hit.raw + ' ' + hit.text);
    const isOther = /\bother\b/i.test(cleaned) && /\b(specify|other:)\b/i.test(cleaned);

    answerOptions.push({
      code: hit.code,
      text: cleaned,
      isOther,
      anchor,
      routing,
      progNote,
    });
  }

  const firstAnswerIndex =
    filteredHits.length > 0 ? Math.min(...filteredHits.map(h => h.start)) : -1;

  const stemCandidate = firstAnswerIndex >= 0 ? rawText.slice(0, firstAnswerIndex) : rawText;
  const questionText = cleanText(stripTableArtifactsFromStem(stemCandidate));

  const instructionText = extractInstructionText(
    firstAnswerIndex >= 0 ? rawText.slice(0, firstAnswerIndex) : rawText,
  );

  const questionType = detectQuestionType(rawText, instructionText, answerOptions, scale.scaleLabels);
  const format = detectFormat(rawText, filteredHits, scale.scaleLabels);

  return {
    questionId: segment.questionId,
    rawText,
    questionText,
    instructionText,
    answerOptions,
    scaleLabels: scale.scaleLabels,
    questionType,
    format,
    progNotes: extractProgNotes(rawText),
    strikethroughSegments: extractStrikethrough(rawText),
    sectionHeader: segment.sectionHeader || null,
  };
}

// =============================================================================
// Survey Markdown Parser (exported)
// =============================================================================

/**
 * Parse survey markdown into structured ParsedSurveyQuestion[].
 *
 * Uses surveyChunker to split into segments, then parses each segment.
 * When duplicate question IDs exist, keeps the richer one (more options, longer text).
 *
 * Exported separately so downstream modules can use it without the full
 * reconciliation pipeline.
 */
export function parseSurveyMarkdown(markdown: string): ParsedSurveyQuestion[] {
  const segments = segmentSurvey(markdown).filter(s => s.questionId && s.questionId.length > 0);
  const byQid = new Map<string, ParsedSurveyQuestion>();

  for (const segment of segments) {
    const parsed = parseSegment(segment);
    const existing = byQid.get(parsed.questionId);

    if (!existing) {
      byQid.set(parsed.questionId, parsed);
      continue;
    }

    // Keep the richer version when duplicates exist
    const existingScore = existing.answerOptions.length * 10 + existing.rawText.length;
    const parsedScore = parsed.answerOptions.length * 10 + parsed.rawText.length;
    if (parsedScore > existingScore) {
      byQid.set(parsed.questionId, parsed);
    }
  }

  return [...byQid.values()].sort((a, b) =>
    a.questionId.localeCompare(b.questionId, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

// =============================================================================
// Survey Markdown Loading
// =============================================================================

/**
 * Candidate locations for a cached survey markdown file.
 */
function getMarkdownCacheCandidates(datasetPath: string): string[] {
  return [
    path.join(datasetPath, 'inputs', 'survey-markdown.md'),
    path.join(datasetPath, 'inputs', 'survey.md'),
    path.join(datasetPath, 'survey-markdown.md'),
    path.join(datasetPath, 'survey.md'),
  ];
}

/**
 * Load survey markdown, preferring a cached .md file in the dataset directory.
 * Falls back to processing the DOCX via SurveyProcessor.
 *
 * @returns The markdown string and its source.
 */
async function loadSurveyMarkdown(
  datasetPath: string,
  surveyDocPath: string,
): Promise<{ markdown: string; source: 'cached-markdown' | 'processed-docx' }> {
  // Try cached markdown first
  for (const candidate of getMarkdownCacheCandidates(datasetPath)) {
    try {
      const content = await fs.readFile(candidate, 'utf-8');
      if (content.trim().length > 0) {
        return { markdown: content, source: 'cached-markdown' };
      }
    } catch {
      // no-op — file doesn't exist
    }
  }

  // Fall back to processing the DOCX
  const tmpDir = path.join('/tmp', 'v3-survey-parser-08a', path.basename(datasetPath));
  await fs.mkdir(tmpDir, { recursive: true });
  const processed = await processSurvey(surveyDocPath, tmpDir);
  if (!processed.markdown || processed.markdown.trim().length === 0) {
    const warningText = processed.warnings.length > 0
      ? processed.warnings.join(' | ')
      : 'no processor warnings';
    throw new Error(`SurveyProcessor produced empty markdown (${warningText})`);
  }

  return { markdown: processed.markdown, source: 'processed-docx' };
}

// =============================================================================
// Label Application — Helpers
// =============================================================================

/**
 * Strip a leading question ID prefix from text (e.g., "Q3. How often..." -> "How often...").
 */
function stripLeadingQuestionId(text: string, qid: string): string {
  const normalized = text.replace(STRIP_MARKDOWN_FOR_ID, '').trim();
  const pattern = new RegExp(`^${qid}[\\s.:\\)]\\s*`, 'i');
  return normalized.replace(pattern, '').trim();
}

/**
 * Determine whether the candidate survey question text should replace
 * the current question text on an entry.
 */
function shouldReplaceQuestionText(current: string, candidate: string): boolean {
  const cur = cleanText(current);
  const next = cleanText(candidate);
  if (!next || isPlaceholderText(next)) return false;
  if (normalizeLabel(cur) === normalizeLabel(next)) return false;
  // Current text is just a bare question ID (e.g., "S9")
  if (/^[A-Z][A-Za-z]*\d+[a-z]?$/i.test(cur)) return true;
  if (next.length >= cur.length) return true;
  if (normalizeLabel(next).includes(normalizeLabel(cur)) && next.length > cur.length) return true;
  return false;
}

/**
 * Extract a numeric code from a column name suffix.
 * Handles grid row codes (e.g., S9r3c1 -> 3) and iteration suffixes (e.g., Q5_7 -> 7).
 */
function extractItemCode(column: string): number | null {
  const rMatch = column.match(/r(\d+)(?:c\d+)?$/i);
  if (rMatch) return Number(rMatch[1]);

  const suffixMatch = column.match(/(?:_|^)(\d{1,3})$/);
  if (suffixMatch) return Number(suffixMatch[1]);

  return null;
}

/**
 * Build a map from answer option code (as string) to the list of options with that code.
 */
function buildOptionCodeMap(question: ParsedSurveyQuestion): Map<string, ParsedAnswerOption[]> {
  const map = new Map<string, ParsedAnswerOption[]>();
  for (const opt of question.answerOptions) {
    const key = String(opt.code);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(opt);
  }
  return map;
}

/**
 * From a list of options with the same code, pick the best one
 * (most alphabetic content, longest text), excluding placeholders.
 */
function chooseBestOption(options: ParsedAnswerOption[]): ParsedAnswerOption | null {
  if (options.length === 0) return null;
  const candidates = options.filter(opt => !isPlaceholderText(opt.text));
  if (candidates.length === 0) return null;

  return candidates.sort((a, b) => {
    const aAlpha = (a.text.match(/[A-Za-z]/g) || []).length;
    const bAlpha = (b.text.match(/[A-Za-z]/g) || []).length;
    if (aAlpha !== bAlpha) return bAlpha - aAlpha;
    return b.text.length - a.text.length;
  })[0];
}

/**
 * Find the best matching option by Jaccard text similarity.
 * Returns null if best score < 0.62.
 */
function findBestOptionByText(
  currentLabel: string,
  options: ParsedAnswerOption[],
): { option: ParsedAnswerOption; score: number } | null {
  if (options.length === 0) return null;
  const currentTokens = tokenizeLabel(currentLabel);
  let best: { option: ParsedAnswerOption; score: number } | null = null;

  for (const option of options) {
    if (isPlaceholderText(option.text)) continue;
    const score = jaccard(currentTokens, tokenizeLabel(option.text));
    if (!best || score > best.score) {
      best = { option, score };
    }
  }

  return best && best.score >= 0.62 ? best : null;
}

/**
 * Determine whether a candidate label should replace the current item label.
 */
function shouldReplaceItemLabel(current: string, candidate: string): boolean {
  const curNorm = normalizeLabel(current);
  const nextNorm = normalizeLabel(candidate);
  if (!nextNorm || isPlaceholderText(candidate)) return false;
  if (curNorm === nextNorm) return false;
  if (nextNorm.length > curNorm.length) return true;
  if (/^[a-z]\d+/i.test(curNorm) && nextNorm.length >= 4) return true;
  return true;
}

// =============================================================================
// Label Application — Main Reconciliation
// =============================================================================

/**
 * Reconcile enriched entries against parsed survey questions.
 *
 * For each entry:
 *   1. Find the matching survey question (by questionId or loopQuestionId)
 *   2. Hydrate surveyText from the parsed raw text
 *   3. Update questionText if the survey has a richer stem
 *   4. Update item labels by code match or Jaccard text similarity
 *
 * @param entries The current QuestionIdEntry[] to reconcile
 * @param parsedQuestions Parsed survey questions from parseSurveyMarkdown
 * @param options.allowSuffixMatch Whether to use suffix matching for question IDs
 * @returns Reconciled entries, diffs for audit, and stats
 */
function reconcileBaseEntries(
  entries: QuestionIdEntry[],
  parsedQuestions: ParsedSurveyQuestion[],
  options: { allowSuffixMatch: boolean },
): { reconciled: QuestionIdEntry[]; diffs: LabelDiffEntry[]; stats: LinkStats } {
  const parsedById = new Map(parsedQuestions.map(q => [q.questionId, q]));
  const parsedIds = parsedQuestions.map(q => q.questionId);

  let matchedToSurveyCount = 0;
  let surveyTextHydrated = 0;
  let questionTextUpdates = 0;
  let itemLabelUpdates = 0;
  let entriesWithAnyChange = 0;
  let unmatchedBaseCount = 0;

  const diffs: LabelDiffEntry[] = [];

  const reconciled = entries.map(entry => {
    const anchorQuestionId = entry.loopQuestionId || entry.questionId;
    const matchedSurveyId = parsedById.has(anchorQuestionId)
      ? anchorQuestionId
      : options.allowSuffixMatch
        ? matchesQuestionId(anchorQuestionId, parsedIds, parsedQuestions) || null
        : null;

    if (!matchedSurveyId) {
      unmatchedBaseCount++;
      diffs.push({
        questionId: entry.questionId,
        anchorQuestionId,
        surveyQuestionId: null,
        questionTextChanged: false,
        itemLabelChanges: [],
      });
      return {
        ...entry,
        items: (entry.items || []).map(item => {
          const currentLabel = typeof item.label === 'string' ? item.label : '';
          const savLabel = item.savLabel ?? currentLabel;
          const scaleLabels = item.scaleLabels?.map(sl => ({
            ...sl,
            savLabel: sl.savLabel ?? sl.label,
          }));
          return { ...item, savLabel, scaleLabels };
        }),
      };
    }

    matchedToSurveyCount++;
    const parsed = parsedById.get(matchedSurveyId)!;
    let changed = false;

    // Hydrate surveyText from parsed raw text
    let nextSurveyText = entry.surveyText ?? null;
    const parsedRaw = parsed.rawText.trim();
    if (parsedRaw.length > 0 && parsedRaw !== (entry.surveyText ?? '')) {
      nextSurveyText = parsedRaw;
      surveyTextHydrated++;
      changed = true;
    }

    // Update questionText if survey has a better stem
    let nextQuestionText = entry.questionText;
    const parsedStem = stripLeadingQuestionId(parsed.questionText, matchedSurveyId);
    if (parsedStem && shouldReplaceQuestionText(entry.questionText, parsedStem)) {
      nextQuestionText = parsedStem;
      questionTextUpdates++;
      changed = true;
    }

    // Update item labels by code match or text similarity
    const optionMap = buildOptionCodeMap(parsed);
    const allOptions = parsed.answerOptions;
    const itemLabelChanges: LabelDiffEntry['itemLabelChanges'] = [];

    const nextItems = (entry.items || []).map(item => {
      const currentLabel = typeof item.label === 'string' ? item.label : '';
      const code = extractItemCode(item.column);

      // Snapshot .sav label — idempotent on pipeline resume (preserves existing savLabel)
      const savLabel = item.savLabel ?? currentLabel;
      const scaleLabels = item.scaleLabels?.map(sl => ({
        ...sl,
        savLabel: sl.savLabel ?? sl.label,
      }));

      let candidate: ParsedAnswerOption | null = null;
      let method: 'code' | 'text' = 'code';
      let confidence = 1;

      // Try code-based match first
      if (code !== null) {
        candidate = chooseBestOption(optionMap.get(String(code)) || []);
      }

      // Fall back to text similarity
      if (!candidate) {
        const textMatch = findBestOptionByText(currentLabel, allOptions);
        if (textMatch) {
          candidate = textMatch.option;
          method = 'text';
          confidence = Number(textMatch.score.toFixed(3));
        }
      }

      if (!candidate) return { ...item, savLabel, scaleLabels };
      if (!shouldReplaceItemLabel(currentLabel, candidate.text)) return { ...item, savLabel, scaleLabels };

      itemLabelUpdates++;
      changed = true;
      itemLabelChanges.push({
        column: item.column,
        oldLabel: currentLabel,
        newLabel: candidate.text,
        method,
        confidence,
      });

      return {
        ...item,
        label: candidate.text,
        savLabel,
        surveyLabel: candidate.text,
        scaleLabels,
      };
    });

    if (changed) entriesWithAnyChange++;

    diffs.push({
      questionId: entry.questionId,
      anchorQuestionId,
      surveyQuestionId: matchedSurveyId,
      questionTextChanged: nextQuestionText !== entry.questionText,
      itemLabelChanges,
    });

    return {
      ...entry,
      surveyText: nextSurveyText,
      questionText: nextQuestionText,
      items: nextItems,
    };
  });

  return {
    reconciled,
    diffs,
    stats: {
      baseQuestionCount: entries.length,
      matchedToSurveyCount,
      surveyTextHydrated,
      questionTextUpdates,
      itemLabelUpdates,
      entriesWithAnyChange,
      unmatchedBaseCount,
    },
  };
}

// =============================================================================
// Main Entry Point
// =============================================================================

export interface SurveyParserInput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  datasetPath: string;
}

export interface SurveyParserOutput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  surveyParsed: ParsedSurveyQuestion[];
  /** Raw survey markdown for downstream agents (null if no survey doc) */
  surveyMarkdown: string | null;
}

/**
 * Run the survey parser step (08a).
 *
 * Loads survey markdown (from cache or by processing DOCX), parses it into
 * structured questions, then reconciles entry labels against the parsed
 * survey content.
 *
 * If no survey file is found for the dataset, returns entries unchanged
 * with an empty surveyParsed array.
 *
 * @param input - Entries to enrich, metadata, and dataset path
 * @returns Enriched entries, updated metadata, and parsed survey questions
 */
export async function runSurveyParser(input: SurveyParserInput): Promise<SurveyParserOutput> {
  const { entries, metadata, datasetPath } = input;

  // Discover dataset files to find the survey document
  const files = await findDatasetFiles(datasetPath);

  // If no survey file or not DOCX, return entries unchanged
  if (!files.survey) {
    return { entries, metadata, surveyParsed: [], surveyMarkdown: null };
  }
  if (!files.survey.toLowerCase().endsWith('.docx')) {
    return { entries, metadata, surveyParsed: [], surveyMarkdown: null };
  }

  // Load survey markdown (cached or processed from DOCX)
  const { markdown } = await loadSurveyMarkdown(datasetPath, files.survey);

  // Parse into structured questions
  const surveyParsed = parseSurveyMarkdown(markdown);

  // Reconcile entry labels against parsed survey content
  const { reconciled } = reconcileBaseEntries(entries, surveyParsed, {
    allowSuffixMatch: true,
  });

  return {
    entries: reconciled,
    metadata,
    surveyParsed,
    surveyMarkdown: markdown,
  };
}
