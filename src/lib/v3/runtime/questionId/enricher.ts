/**
 * V3 Runtime — Step 00: Question ID Enricher
 *
 * Transforms a .sav file into an enriched `QuestionIdEntry[]`. This is the
 * seed stage for the entire question-id chain. It combines:
 *   - .sav extraction (RDataReader + DataMapProcessor)
 *   - Question grouping (via groupingAdapter)
 *   - Exclusion rules + hidden variable linking (7-strategy progressive match)
 *   - Sum constraint detection (R-based)
 *   - Pipe column detection (R-based)
 *   - Analytical subtype classification (layered detection)
 *   - Survey matching
 *   - Loop detection
 *   - Biaxial regroup pass
 *   - Binary family collapse pass (coded open-end grouping)
 *   - Admin rescue pass
 *
 * Ported from: scripts/v3-enrichment/00-question-id-enricher.ts
 *
 * No file I/O — the orchestrator handles artifact persistence.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

import { getDataFileStats, convertToRawVariables } from '@/lib/validation/RDataReader';
import { DataMapProcessor, inferParentFromSubVariable } from '@/lib/processors/DataMapProcessor';
import { extractSurveyQuestionIds, matchesQuestionId } from '@/lib/survey/surveyQuestionFilter';
import { segmentSurvey } from '@/lib/survey/surveyChunker';
import { processSurvey } from '@/lib/processors/SurveyProcessor';
import { findDatasetFiles } from '@/lib/pipeline/FileDiscovery';
import type { VerboseDataMapType } from '@/schemas/processingSchemas';
import type { DataFileStats } from '@/lib/validation/types';

import { groupDataMapForQuestionId, type QuestionGroup } from './groupingAdapter';
import type {
  QuestionIdEntry,
  SurveyMetadata,
  DatasetIntakeConfig,
  RankingDetail,
  HiddenLinkInfo,
  SumConstraintInfo,
} from './types';
import { makeEmptyBaseContract } from '../baseContract';
import { isNonSubstantiveTail } from '../canonical/nonSubstantive';

const execFileAsync = promisify(execFile);

// =============================================================================
// R Path Discovery (cached singleton)
// =============================================================================

let cachedRPath: string | null = null;

async function findRPath(): Promise<string> {
  if (cachedRPath) return cachedRPath;
  const rPaths = ['/opt/homebrew/bin/Rscript', '/usr/local/bin/Rscript', '/usr/bin/Rscript', 'Rscript'];
  for (const p of rPaths) {
    try {
      await fs.access(p);
      cachedRPath = p;
      return p;
    } catch { /* continue */ }
  }
  cachedRPath = 'Rscript';
  return 'Rscript';
}

// =============================================================================
// Exclusion Rules
// =============================================================================

export type ExclusionReason =
  | 'flag_variable'
  | 'system_metadata'
  | 'vendor_computed'
  | 'piping_artifact'
  | 'dummy_variable'
  | 'order_variable'
  | 'version_variable'
  | 'sample_id'
  | 'pagetime'
  | 'survey_qc'
  | 'maxdiff_output'
  | 'system_variable'
  | 'single_var_list_derived'
  | 'duplicated_id_junk'
  | 'zero_respondents'
  | 'constant_column'
  | null;

interface GroupLike {
  questionId: string;
  questionText: string;
  variableCount: number;
  variables: string[];
}

const FLAG_SUFFIX_PATTERN = /^.+_flag$/i;
const FLAG_PREFIX_PATTERN = /^flag_/i;
const SYSTEM_METADATA_PATTERNS = [
  /^resp(?:ondent)?_?id$/i,
  /^record$/i,
  /^weight$/i,
  /^caseid$/i,
  /^date$/i,
  /^duration$/i,
  /^status$/i,
];
const SURVEY_QC_PATTERN = /(?:speeder|laggard|changelog|speedtest|qualitycheck|straightliner|straightlinercheck)/i;
const DATA_QUALITY_SETTINGS_PATTERN = /^DQSETTINGS/i;
const SAMPLE_SYSTEM_PATTERN = /^(?:SAMPLETYPE|SIMULATED_DATA|STOCKING_FLAG)/i;
const DEVICE_METADATA_PATTERN = /^h?device(?:type)?$/i;
const COMPUTED_VAR_PATTERN = /^Var_/i;
const VENDOR_NDP_PATTERN = /^ndp_/i;
const GEO_CHECK_PATTERN = /GeoCheck/i;
const API_STATUS_TEXT_PATTERN = /\bAPI\s*Status\b/i;

export function detectExclusion(group: GroupLike): ExclusionReason {
  if (FLAG_SUFFIX_PATTERN.test(group.questionId)) return 'flag_variable';
  if (FLAG_PREFIX_PATTERN.test(group.questionId)) return 'flag_variable';
  if (/^h?FLAG/i.test(group.questionId)) return 'flag_variable';

  if (group.variables.length === 1) {
    const v = group.variables[0];
    if (FLAG_SUFFIX_PATTERN.test(v) || FLAG_PREFIX_PATTERN.test(v)) return 'flag_variable';
  }

  for (const pattern of SYSTEM_METADATA_PATTERNS) {
    if (pattern.test(group.questionId)) return 'system_metadata';
  }

  if (/^h?resp(?:ondent)?info/i.test(group.questionId)) return 'system_metadata';
  if (/samp(?:le)?$/i.test(group.questionId)) return 'system_metadata';
  if (/_time(?:_spent)?$/i.test(group.questionId) && /\b(?:hidden|conjoint|exercise)\b/i.test(group.questionText)) return 'pagetime';
  if (/time_spent$/i.test(group.questionId)) return 'pagetime';

  if (/^v[A-Z]/.test(group.questionId)) return 'vendor_computed';
  if (/^pipe_/i.test(group.questionId)) return 'piping_artifact';
  if (/dum/i.test(group.questionId)) return 'dummy_variable';
  if (group.variables.some(v => /dum/i.test(v))) return 'dummy_variable';
  if (/order|flip|track/i.test(group.questionId)) return 'order_variable';
  if (/version/i.test(group.questionId)) return 'version_variable';
  if (/^pagetime/i.test(group.questionId)) return 'pagetime';
  if (/_ID$|_NUM$/i.test(group.questionId)) return 'sample_id';
  if (/^Matching_Unique/i.test(group.questionId)) return 'sample_id';
  if (/^RD_/i.test(group.questionId)) return 'survey_qc';
  if (/dup(?:e|licate)?/i.test(group.questionId)) return 'survey_qc';
  if (SURVEY_QC_PATTERN.test(group.questionId)) return 'survey_qc';
  if (SURVEY_QC_PATTERN.test(group.questionText)) return 'survey_qc';
  if (DATA_QUALITY_SETTINGS_PATTERN.test(group.questionId)) return 'survey_qc';
  if (SAMPLE_SYSTEM_PATTERN.test(group.questionId)) return 'system_metadata';
  if (DEVICE_METADATA_PATTERN.test(group.questionId)) return 'system_metadata';
  if (COMPUTED_VAR_PATTERN.test(group.questionId)) return 'vendor_computed';
  if (VENDOR_NDP_PATTERN.test(group.questionId)) return 'vendor_computed';
  if (GEO_CHECK_PATTERN.test(group.questionId)) return 'survey_qc';
  if (API_STATUS_TEXT_PATTERN.test(group.questionText)) return 'system_metadata';

  return null;
}

export function isHiddenVariable(qid: string, questionText: string): boolean {
  if (/^h[A-Za-z_]/.test(qid) && !/^h\d/i.test(qid)) return true;
  if (/^HV_/i.test(qid)) return true;
  if (/^Hid/i.test(qid)) return true;
  if (/^h\d+[A-Za-z]{2,}/i.test(qid)) return true;
  if (/\bhidden\b/i.test(questionText)) return true;
  if (/^noanswer/i.test(qid)) return true;
  return false;
}

function isMaxDiffOutput(qid: string): boolean {
  return /^(?:RawUt|RawExp|SharPref|AnchProb|AnchProbInd)(?:_|Sum$)/i.test(qid);
}

function isSystemVariable(qid: string): boolean {
  if (/^v[a-z]/i.test(qid) && !qid.includes('_') && /^v(?:vendorid|list|term|dropout|status|date|duration)/i.test(qid)) return true;
  if (qid.toLowerCase() === 'fit' || qid.toLowerCase() === 'weight' || /^gc\d*$/i.test(qid)) return true;
  return false;
}

function isListDerived(qid: string): boolean {
  if (/Calc$/i.test(qid) || /_Recode$/i.test(qid)) return true;
  if (/^Intro_/i.test(qid)) return true;
  if (/^seg_/i.test(qid)) return true;
  if (/^[a-z][a-z_]+$/.test(qid) && qid.includes('_') && !qid.match(/^[A-Za-z]\d/)) return true;
  if (/^[a-z]{3,}$/.test(qid) && !qid.match(/^[a-z]\d/i)) return true;
  return false;
}

function isDuplicatedIdJunk(questionId: string): boolean {
  const underscoreIdx = questionId.indexOf('_');
  if (underscoreIdx < 1) return false;
  const prefix = questionId.slice(0, underscoreIdx);
  const suffix = questionId.slice(underscoreIdx + 1);
  if (suffix === prefix) return true;
  if (suffix.length === prefix.length + 1 && suffix.startsWith(prefix)) return true;
  return false;
}

export function classifyDisposition(
  group: GroupLike,
  isTextOpen: boolean,
): { disposition: 'reportable' | 'excluded' | 'text_open_end'; exclusionReason: ExclusionReason } {
  const hardExclusion = detectExclusion(group);
  if (hardExclusion) return { disposition: 'excluded', exclusionReason: hardExclusion };

  if (isMaxDiffOutput(group.questionId)) return { disposition: 'excluded', exclusionReason: 'maxdiff_output' };
  if (isSystemVariable(group.questionId)) return { disposition: 'excluded', exclusionReason: 'system_variable' };
  if (isListDerived(group.questionId) && group.variableCount <= 1) return { disposition: 'excluded', exclusionReason: 'single_var_list_derived' };
  if (isDuplicatedIdJunk(group.questionId)) return { disposition: 'excluded', exclusionReason: 'duplicated_id_junk' };

  if (isTextOpen) return { disposition: 'text_open_end', exclusionReason: null };

  return { disposition: 'reportable', exclusionReason: null };
}

// =============================================================================
// Hidden Variable Linking (7-strategy progressive matching)
// =============================================================================

type LinkMethod = 'noanswer_prefix_strip' | 'h_prefix_strip' | 'hv_prefix_strip' | 'hid_prefix_strip' | 'suffix_strip' | 'underscore_strip' | 'prefix_match' | 'embedded_qid' | null;

function findQidCaseInsensitive(candidate: string, nonHiddenQids: Set<string>): string | null {
  if (nonHiddenQids.has(candidate)) return candidate;
  const lower = candidate.toLowerCase();
  for (const qid of nonHiddenQids) {
    if (qid.toLowerCase() === lower) return qid;
  }
  return null;
}

function tryUnderscoreStrip(candidate: string, nonHiddenQids: Set<string>): string | null {
  let current = candidate;
  while (current.includes('_')) {
    current = current.replace(/_[^_]*$/, '');
    if (current.length < 2) break;
    const cleaned = current.replace(/_$/, '');
    if (cleaned.length >= 2) {
      const match = findQidCaseInsensitive(cleaned, nonHiddenQids);
      if (match) return match;
    }
  }
  return null;
}

function tryPrefixMatch(candidate: string, nonHiddenQids: Set<string>): string | null {
  let bestMatch: string | null = null;
  let bestLen = 0;
  for (const qid of nonHiddenQids) {
    if (qid.length < 2 || qid.length >= candidate.length) continue;
    if (candidate.substring(0, qid.length).toLowerCase() === qid.toLowerCase()) {
      const remainder = candidate.substring(qid.length);
      if (/^[a-zA-Z_]/.test(remainder) && qid.length > bestLen) {
        bestMatch = qid;
        bestLen = qid.length;
      }
    }
  }
  return bestMatch;
}

function tryEmbeddedQid(candidate: string, nonHiddenQids: Set<string>): string | null {
  const segments = candidate.split('_');
  let bestMatch: string | null = null;
  let bestLen = 0;

  for (let i = 0; i < segments.length; i++) {
    let combined = '';
    for (let j = i; j < segments.length; j++) {
      combined = combined ? combined + '_' + segments[j] : segments[j];
      if (combined.length < 2) continue;
      const match = findQidCaseInsensitive(combined, nonHiddenQids);
      if (match && match.length > bestLen) {
        bestMatch = match;
        bestLen = match.length;
      }
    }
  }
  return bestMatch;
}

export function linkHiddenVariable(
  hiddenQid: string,
  nonHiddenQids: Set<string>,
): HiddenLinkInfo {
  // Strategy 0: noanswer prefix strip
  if (/^noanswer/i.test(hiddenQid)) {
    const noanswerStripped = hiddenQid
      .replace(/^noanswer/i, '')
      .replace(/[_](?:n\d+)?$/, '');
    if (noanswerStripped) {
      const match = findQidCaseInsensitive(noanswerStripped, nonHiddenQids);
      if (match) return { linkedTo: match, linkMethod: 'noanswer_prefix_strip' };
    }
  }

  // Strategy 1: Strip h/HV_/Hid_ prefix
  let stripped: string | null = null;
  let method: LinkMethod = null;

  if (/^HV_/i.test(hiddenQid)) {
    stripped = hiddenQid.replace(/^HV_/i, '');
    method = 'hv_prefix_strip';
  } else if (/^Hid_?/i.test(hiddenQid)) {
    stripped = hiddenQid.replace(/^Hid_?/i, '');
    method = 'hid_prefix_strip';
  } else if (/^h/i.test(hiddenQid)) {
    stripped = hiddenQid.slice(1);
    method = 'h_prefix_strip';
  }

  if (stripped) {
    const exactMatch = findQidCaseInsensitive(stripped, nonHiddenQids);
    if (exactMatch) return { linkedTo: exactMatch, linkMethod: method };
  }

  // Strategy 2: Structural suffix stripping
  if (stripped) {
    const parent = inferParentFromSubVariable(stripped);
    if (parent !== 'NA') {
      const cleaned = parent.replace(/_$/, '');
      const match = findQidCaseInsensitive(cleaned, nonHiddenQids);
      if (match) return { linkedTo: match, linkMethod: 'suffix_strip' };
    }
  }

  // Strategy 3: Progressive underscore stripping
  if (stripped) {
    const underscoreMatch = tryUnderscoreStrip(stripped, nonHiddenQids);
    if (underscoreMatch) return { linkedTo: underscoreMatch, linkMethod: 'underscore_strip' };
  }

  // Strategy 4: Prefix match
  if (stripped) {
    const prefixMatch = tryPrefixMatch(stripped, nonHiddenQids);
    if (prefixMatch) return { linkedTo: prefixMatch, linkMethod: 'prefix_match' };
  }

  // Strategy 5: Structural suffix strip on full hidden QID
  const parentFromFull = inferParentFromSubVariable(hiddenQid);
  if (parentFromFull !== 'NA') {
    let parentStripped: string | null = null;
    if (/^h/i.test(parentFromFull)) {
      parentStripped = parentFromFull.slice(1).replace(/_$/, '');
    }
    if (parentStripped) {
      const match = findQidCaseInsensitive(parentStripped, nonHiddenQids);
      if (match) return { linkedTo: match, linkMethod: 'suffix_strip' };
    }
  }

  // Strategy 6: Embedded QID search
  const embeddedCandidates = [stripped, hiddenQid].filter(Boolean) as string[];
  for (const candidate of embeddedCandidates) {
    const embeddedMatch = tryEmbeddedQid(candidate, nonHiddenQids);
    if (embeddedMatch) return { linkedTo: embeddedMatch, linkMethod: 'embedded_qid' };
  }

  // Strategy 7: Prefix match on full hidden QID
  {
    const prefixMatch = tryPrefixMatch(hiddenQid, nonHiddenQids);
    if (prefixMatch) return { linkedTo: prefixMatch, linkMethod: 'prefix_match' };
  }

  return { linkedTo: null, linkMethod: null };
}

// =============================================================================
// Sum Constraint Detection (R-based)
// =============================================================================

interface GroupSumResult {
  label: string;
  variables: string[];
  respondentsWithData: number;
  respondentsAllNA: number;
  convergenceValue: number | null;
  convergenceRate: number;
  convergenceRateExcludingZeros: number;
}

interface AxisResult {
  groups: GroupSumResult[];
  detected: boolean;
  constraintValue: number | null;
  confidence: number;
  pipeColumns: string[];
}

interface RankingSignal {
  isTriangularNumber: boolean;
  K: number;
  isLikelyRanking: boolean;
  perfectRankRate: number;
}

interface SumConstraintEnrichment {
  detected: boolean;
  constraintValue: number | null;
  constraintAxis: 'down-rows' | 'across-cols' | null;
  confidence: number;
  analyticalSubtype: 'allocation' | 'ranking' | null;
  rankingSignal: RankingSignal | null;
  pipeColumns: string[];
}

async function extractColumns(spssPath: string, variables: string[]): Promise<{ data: (number | null)[][]; existingVars: string[] }> {
  const rPath = await findRPath();
  const varList = variables.map(v => `"${v}"`).join(', ');
  const rScript = `
library(haven)
library(jsonlite)
data <- read_sav("${spssPath.replace(/\\/g, '/')}")
cols <- c(${varList})
existing <- cols[cols %in% names(data)]
missing <- cols[!cols %in% names(data)]
if (length(missing) > 0) {
  cat("MISSING:", paste(missing, collapse=", "), "\\n", file=stderr())
}
if (length(existing) == 0) {
  cat("[]")
} else {
  subset <- data[, existing, drop=FALSE]
  mat <- as.data.frame(lapply(subset, as.numeric))
  cat(toJSON(mat, na="null"))
}
cat("\\n---EXISTING---\\n")
cat(toJSON(existing))
`;

  const { stdout } = await execFileAsync(rPath, ['--vanilla', '-e', rScript], {
    maxBuffer: 50 * 1024 * 1024,
  });

  const parts = stdout.split('---EXISTING---');
  const dataJson = parts[0].trim();
  const existingJson = parts[1]?.trim() || '[]';
  const existingVars: string[] = JSON.parse(existingJson);

  if (dataJson === '[]') return { data: [], existingVars };

  const parsed = JSON.parse(dataJson);

  if (Array.isArray(parsed)) {
    const rows = parsed.map((row: Record<string, number | null>) => existingVars.map(col => row[col] ?? null));
    return { data: rows, existingVars };
  }

  // Column-major fallback
  const colNames = Object.keys(parsed);
  const nRows = (parsed[colNames[0]] as (number | null)[]).length;
  const rows: (number | null)[][] = [];
  for (let i = 0; i < nRows; i++) {
    const row: (number | null)[] = [];
    for (const col of colNames) {
      row.push(parsed[col][i]);
    }
    rows.push(row);
  }
  return { data: rows, existingVars };
}

function analyzeGroupSum(
  data: (number | null)[][],
  colIndices: number[],
  label: string,
  varNames: string[],
): GroupSumResult {
  const sums: number[] = [];
  let allNACount = 0;

  for (const respondent of data) {
    const values = colIndices.map(i => respondent[i]);
    const nonNullValues = values.filter((v): v is number => v !== null && v !== undefined);
    if (nonNullValues.length === 0) { allNACount++; continue; }
    sums.push(nonNullValues.reduce((a, b) => a + b, 0));
  }

  if (sums.length === 0) {
    return { label, variables: varNames, respondentsWithData: 0, respondentsAllNA: allNACount, convergenceValue: null, convergenceRate: 0, convergenceRateExcludingZeros: 0 };
  }

  const sumCounts: Record<number, number> = {};
  for (const s of sums) {
    const rounded = Math.round(s);
    sumCounts[rounded] = (sumCounts[rounded] || 0) + 1;
  }

  const sortedEntries = Object.entries(sumCounts).sort((a, b) => b[1] - a[1]);
  const topValue = parseInt(sortedEntries[0][0]);
  const topCount = sortedEntries[0][1];
  const convergenceRate = topCount / sums.length;

  const nonZeroSums = sums.filter(s => Math.round(s) !== 0);
  let convergenceRateExcludingZeros = convergenceRate;
  if (nonZeroSums.length > 0 && nonZeroSums.length < sums.length) {
    const nonZeroCounts: Record<number, number> = {};
    for (const s of nonZeroSums) {
      const rounded = Math.round(s);
      nonZeroCounts[rounded] = (nonZeroCounts[rounded] || 0) + 1;
    }
    const topNonZero = Object.entries(nonZeroCounts).sort((a, b) => b[1] - a[1])[0];
    convergenceRateExcludingZeros = topNonZero[1] / nonZeroSums.length;
  }

  return { label, variables: varNames, respondentsWithData: sums.length, respondentsAllNA: allNACount, convergenceValue: topValue, convergenceRate, convergenceRateExcludingZeros };
}

function inferGridDimensions(variables: string[]): { rows: number; cols: number } | null {
  const rcPattern = /[rR](\d+)[cC](\d+)/;
  const matches = variables.map(v => v.match(rcPattern)).filter(Boolean);
  if (matches.length < 2) return null;
  const rowNums = new Set(matches.map(m => parseInt(m![1])));
  const colNums = new Set(matches.map(m => parseInt(m![2])));
  if (colNums.size <= 1) return null;
  return { rows: rowNums.size, cols: colNums.size };
}

function orderVariablesRowMajor(variables: string[], _dims: { rows: number; cols: number }): string[] {
  const rcPattern = /[rR](\d+)[cC](\d+)/;
  const parsed = variables.map(v => {
    const m = v.match(rcPattern);
    return m ? { var: v, row: parseInt(m[1]), col: parseInt(m[2]) } : null;
  }).filter(Boolean) as { var: string; row: number; col: number }[];
  parsed.sort((a, b) => a.row !== b.row ? a.row - b.row : a.col - b.col);
  return parsed.map(p => p.var);
}

function getTriangularK(value: number): number | null {
  const discriminant = 1 + 8 * value;
  const sqrtDisc = Math.sqrt(discriminant);
  const K = (-1 + sqrtDisc) / 2;
  if (K >= 2 && Number.isInteger(K)) return K;
  const roundedK = Math.round(K);
  if (roundedK >= 2 && Math.abs(roundedK * (roundedK + 1) / 2 - value) < 0.001) return roundedK;
  return null;
}

function checkRankingSignal(
  data: (number | null)[][],
  constraintValue: number,
  constraintAxis: 'down-rows' | 'across-cols',
  activeVars: string[],
  gridDims: { rows: number; cols: number } | null,
): RankingSignal {
  const K = getTriangularK(constraintValue);
  if (K === null) {
    return { isTriangularNumber: false, K: 0, isLikelyRanking: false, perfectRankRate: 0 };
  }

  const groups: number[][] = [];
  if (constraintAxis === 'down-rows') {
    if (gridDims && gridDims.cols > 1) {
      for (let col = 0; col < gridDims.cols; col++) {
        const indices: number[] = [];
        for (let row = 0; row < gridDims.rows; row++) {
          const idx = row * gridDims.cols + col;
          if (idx < activeVars.length) indices.push(idx);
        }
        groups.push(indices);
      }
    } else {
      groups.push(activeVars.map((_, i) => i));
    }
  } else {
    if (gridDims) {
      for (let row = 0; row < gridDims.rows; row++) {
        const indices: number[] = [];
        for (let col = 0; col < gridDims.cols; col++) {
          const idx = row * gridDims.cols + col;
          if (idx < activeVars.length) indices.push(idx);
        }
        groups.push(indices);
      }
    }
  }

  if (groups.length === 0) {
    return { isTriangularNumber: true, K, isLikelyRanking: false, perfectRankRate: 0 };
  }

  let totalRespondents = 0;
  let perfectRankCount = 0;

  for (const respondent of data) {
    for (const group of groups) {
      const values = group.map(i => respondent[i]).filter((v): v is number => v !== null && v !== undefined);
      if (values.length === 0) continue;
      totalRespondents++;
      const nonZero = values.filter(v => v !== 0);
      if (nonZero.length === 0) continue;
      const unique = new Set(nonZero).size === nonZero.length;
      const sorted = [...nonZero].sort((a, b) => a - b);
      const isPerfect = unique && sorted[0] === 1 && sorted[sorted.length - 1] === sorted.length && sorted.every((v, i) => v === i + 1);
      if (isPerfect) perfectRankCount++;
    }
  }

  const perfectRankRate = totalRespondents > 0 ? perfectRankCount / totalRespondents : 0;
  return { isTriangularNumber: true, K, perfectRankRate, isLikelyRanking: perfectRankRate >= 0.90 };
}

function adjustConfidenceForRanking(rawConfidence: number, signal: RankingSignal): number {
  if (!signal.isLikelyRanking) return rawConfidence;
  const penalty = signal.perfectRankRate * 0.45;
  return Math.max(0.1, rawConfidence - penalty);
}

function analyzeDownRows(
  data: (number | null)[][],
  variables: string[],
  gridDims: { rows: number; cols: number } | null,
): AxisResult {
  const groups: GroupSumResult[] = [];
  const pipeColumns: string[] = [];

  if (gridDims && gridDims.cols > 1) {
    for (let col = 0; col < gridDims.cols; col++) {
      const indices: number[] = [];
      const varNames: string[] = [];
      for (let row = 0; row < gridDims.rows; row++) {
        const idx = row * gridDims.cols + col;
        if (idx < variables.length) { indices.push(idx); varNames.push(variables[idx]); }
      }
      const result = analyzeGroupSum(data, indices, `Column ${col + 1}`, varNames);
      groups.push(result);
      if (result.respondentsWithData === 0 && result.respondentsAllNA > 0) {
        pipeColumns.push(`c${col + 1}`);
      }
    }
  } else {
    const indices = variables.map((_, i) => i);
    groups.push(analyzeGroupSum(data, indices, 'All rows', variables));
  }

  const activeGroups = groups.filter(g => g.respondentsWithData > 0);
  const detected = activeGroups.length > 0 &&
    activeGroups.every(g => g.convergenceRateExcludingZeros >= 0.90) &&
    activeGroups.every(g => g.convergenceValue === activeGroups[0].convergenceValue);
  const constraintValue = detected ? activeGroups[0].convergenceValue : null;
  const confidence = detected
    ? activeGroups.reduce((sum, g) => sum + g.convergenceRateExcludingZeros, 0) / activeGroups.length
    : 0;

  return { groups, detected, constraintValue, confidence, pipeColumns };
}

function analyzeAcrossCols(
  data: (number | null)[][],
  variables: string[],
  gridDims: { rows: number; cols: number },
  pipeColumnIndices: Set<number>,
): AxisResult {
  const groups: GroupSumResult[] = [];
  for (let row = 0; row < gridDims.rows; row++) {
    const indices: number[] = [];
    const varNames: string[] = [];
    for (let col = 0; col < gridDims.cols; col++) {
      if (pipeColumnIndices.has(col)) continue;
      const idx = row * gridDims.cols + col;
      if (idx < variables.length) { indices.push(idx); varNames.push(variables[idx]); }
    }
    if (indices.length > 0) {
      groups.push(analyzeGroupSum(data, indices, `Row ${row + 1}`, varNames));
    }
  }

  const convergentGroups = groups.filter(g => g.convergenceRateExcludingZeros >= 0.90);
  const detected = convergentGroups.length === groups.length && groups.length > 0;

  let constraintValue: number | null = null;
  if (detected && convergentGroups.length > 0) {
    const valueCounts: Record<number, number> = {};
    for (const g of convergentGroups) {
      if (g.convergenceValue !== null) valueCounts[g.convergenceValue] = (valueCounts[g.convergenceValue] || 0) + 1;
    }
    const topEntry = Object.entries(valueCounts).sort((a, b) => b[1] - a[1])[0];
    if (topEntry) constraintValue = parseInt(topEntry[0]);
  }

  const confidence = detected && groups.length > 0
    ? convergentGroups.reduce((sum, g) => sum + g.convergenceRateExcludingZeros, 0) / groups.length
    : 0;

  return { groups, detected, constraintValue, confidence, pipeColumns: [] };
}

async function detectSumConstraint(spssPath: string, variables: string[]): Promise<SumConstraintEnrichment | null> {
  const gridDims = inferGridDimensions(variables);
  let orderedVars = variables;
  if (gridDims) orderedVars = orderVariablesRowMajor(variables, gridDims);

  const { data, existingVars } = await extractColumns(spssPath, orderedVars);
  if (data.length === 0) return null;

  const varIndexMap: Record<string, number> = {};
  existingVars.forEach((v, i) => varIndexMap[v] = i);
  const activeVars = orderedVars.filter(v => v in varIndexMap);
  const remappedData = data.map(row => activeVars.map(v => row[varIndexMap[v]]));

  const downRows = analyzeDownRows(remappedData, activeVars, gridDims);

  const pipeColumnIndices = new Set<number>();
  if (gridDims && downRows.pipeColumns.length > 0) {
    for (const pipeLabel of downRows.pipeColumns) {
      const colNum = parseInt(pipeLabel.replace('c', ''));
      if (!isNaN(colNum)) pipeColumnIndices.add(colNum - 1);
    }
  }

  let acrossCols: AxisResult | null = null;
  if (gridDims && gridDims.cols >= 2) {
    acrossCols = analyzeAcrossCols(remappedData, activeVars, gridDims, pipeColumnIndices);
  }

  let detected = false;
  let constraintValue: number | null = null;
  let constraintAxis: 'down-rows' | 'across-cols' | null = null;
  let confidence = 0;

  if (downRows.detected && acrossCols?.detected) {
    if (downRows.confidence >= acrossCols.confidence) {
      detected = true; constraintValue = downRows.constraintValue; constraintAxis = 'down-rows'; confidence = downRows.confidence;
    } else {
      detected = true; constraintValue = acrossCols.constraintValue; constraintAxis = 'across-cols'; confidence = acrossCols.confidence;
    }
  } else if (downRows.detected) {
    detected = true; constraintValue = downRows.constraintValue; constraintAxis = 'down-rows'; confidence = downRows.confidence;
  } else if (acrossCols?.detected) {
    detected = true; constraintValue = acrossCols.constraintValue; constraintAxis = 'across-cols'; confidence = acrossCols.confidence;
  }

  let rankingSignal: RankingSignal | null = null;
  let analyticalSubtype: 'allocation' | 'ranking' | null = detected ? 'allocation' : null;

  if (detected && constraintValue !== null && constraintAxis !== null) {
    rankingSignal = checkRankingSignal(remappedData, constraintValue, constraintAxis, activeVars, gridDims);
    if (rankingSignal.isLikelyRanking) {
      confidence = adjustConfidenceForRanking(confidence, rankingSignal);
      analyticalSubtype = 'ranking';
    }
  }

  return { detected, constraintValue, constraintAxis, confidence, analyticalSubtype, rankingSignal, pipeColumns: downRows.pipeColumns };
}

// =============================================================================
// Pipe Column Detection (R-based)
// =============================================================================

interface VariableStat {
  nUnique: number;
  nNA: number;
  nValid: number;
  signature: string;
  minValue: number | null;
  maxValue: number | null;
}

const MIN_ROWS_FOR_PIPE_DUPLICATE = 3;

async function extractVariableStats(
  spssPath: string,
  variables: string[],
): Promise<{ stats: Map<string, VariableStat>; totalRespondents: number }> {
  const rPath = await findRPath();
  if (variables.length === 0) return { stats: new Map(), totalRespondents: 0 };

  const argsFile = path.join('/tmp', `qid-enricher-vars-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  await fs.writeFile(argsFile, JSON.stringify(variables), 'utf-8');

  const rScript = `
library(haven)
library(jsonlite)
args <- commandArgs(trailingOnly = TRUE)
data_path <- args[1]
vars_path <- args[2]
cols <- fromJSON(vars_path)
data <- read_sav(data_path, col_select = tidyselect::any_of(cols))
existing <- names(data)
result <- list()
n_total <- nrow(data)
for (col_name in existing) {
  raw <- suppressWarnings(as.numeric(data[[col_name]]))
  non_na_indices <- which(!is.na(raw))
  valid_count <- length(non_na_indices)
  na_count <- n_total - valid_count
  if (valid_count == 0) {
    n_unique <- 0
    signature <- "ALL_NA"
    min_val <- NA_real_
    max_val <- NA_real_
  } else {
    vals <- raw[non_na_indices]
    n_unique <- length(unique(vals))
    min_val <- min(vals)
    max_val <- max(vals)
    sig1 <- sum(vals)
    sig2 <- sum(vals * vals)
    sig3 <- sum(non_na_indices)
    sig4 <- sum(non_na_indices * vals)
    sig5 <- sum((non_na_indices %% 1009) * vals)
    sig6 <- sum((non_na_indices %% 1013) * vals * vals)
    signature <- paste(valid_count, n_unique,
      format(min_val, digits = 17, trim = TRUE, scientific = FALSE),
      format(max_val, digits = 17, trim = TRUE, scientific = FALSE),
      format(sig1, digits = 17, trim = TRUE, scientific = FALSE),
      format(sig2, digits = 17, trim = TRUE, scientific = FALSE),
      format(sig3, digits = 17, trim = TRUE, scientific = FALSE),
      format(sig4, digits = 17, trim = TRUE, scientific = FALSE),
      format(sig5, digits = 17, trim = TRUE, scientific = FALSE),
      format(sig6, digits = 17, trim = TRUE, scientific = FALSE), sep = "|")
  }
  result[[col_name]] <- list(nUnique = n_unique, nNA = na_count, nValid = valid_count, signature = signature, minValue = min_val, maxValue = max_val)
}
cat(toJSON(list(stats = result, totalRespondents = n_total), auto_unbox = TRUE, na = "null"))
`;

  const { stdout } = await execFileAsync(
    rPath,
    ['--vanilla', '-e', rScript, spssPath, argsFile],
    { maxBuffer: 64 * 1024 * 1024 },
  ).finally(async () => {
    await fs.unlink(argsFile).catch(() => {});
  });

  const parsed = JSON.parse(stdout.trim());
  const statsMap = new Map<string, VariableStat>();

  for (const [varName, s] of Object.entries(parsed.stats)) {
    const stat = s as VariableStat;
    statsMap.set(varName, {
      nUnique: stat.nUnique,
      nNA: stat.nNA,
      nValid: stat.nValid,
      signature: stat.signature,
      minValue: stat.minValue ?? null,
      maxValue: stat.maxValue ?? null,
    });
  }

  return { stats: statsMap, totalRespondents: parsed.totalRespondents };
}

interface GridCell { row: number; col: number; variable: string }

function parseGridCell(variable: string): GridCell | null {
  const match = variable.match(/[rR](\d+)[cC](\d+)$/);
  if (!match) return null;
  return { row: Number.parseInt(match[1], 10), col: Number.parseInt(match[2], 10), variable };
}

function detectPipeColumns(variables: string[], stats: Map<string, VariableStat>): string[] {
  const parsedCells = variables.map(parseGridCell).filter((cell): cell is GridCell => cell !== null);
  const distinctCols = [...new Set(parsedCells.map(cell => cell.col))].sort((a, b) => a - b);
  if (distinctCols.length < 2) return [];

  const rowsByCol = new Map<number, Map<number, string>>();
  for (const cell of parsedCells) {
    if (!rowsByCol.has(cell.col)) rowsByCol.set(cell.col, new Map<number, string>());
    const rowMap = rowsByCol.get(cell.col)!;
    if (!rowMap.has(cell.row)) rowMap.set(cell.row, cell.variable);
  }

  const pipeColumnIds: string[] = [];
  const signatureToFirst = new Map<string, string>();

  for (const col of distinctCols) {
    const rowMap = rowsByCol.get(col) ?? new Map<number, string>();
    const rowEntries = [...rowMap.entries()].sort((a, b) => a[0] - b[0]).map(([row, variable]) => ({ row, variable }));

    let missingVariables = 0;
    let allNaVariables = 0;
    let validVariables = 0;
    let isLikelyLowInfoBinary = rowEntries.length > 0;
    const signatureParts: string[] = [];

    for (const entry of rowEntries) {
      const stat = stats.get(entry.variable);
      if (!stat) { missingVariables++; isLikelyLowInfoBinary = false; continue; }
      signatureParts.push(`${entry.row}:${stat.signature}`);
      if (stat.nValid === 0) { allNaVariables++; isLikelyLowInfoBinary = false; continue; }
      validVariables++;
      const isBinaryLike = stat.nUnique <= 1 && stat.minValue !== null && stat.maxValue !== null && stat.minValue >= 0 && stat.maxValue <= 1;
      if (!isBinaryLike) isLikelyLowInfoBinary = false;
    }

    const variableCount = rowEntries.length;
    const columnId = `c${col}`;

    if (variableCount > 0 && missingVariables === 0 && allNaVariables === variableCount) {
      pipeColumnIds.push(columnId);
      continue;
    }

    if (missingVariables === 0 && signatureParts.length > 0) {
      const signatureKey = signatureParts.join('|');
      const firstSeen = signatureToFirst.get(signatureKey);
      if (firstSeen) {
        if (variableCount >= MIN_ROWS_FOR_PIPE_DUPLICATE && !(isLikelyLowInfoBinary && validVariables > 0)) {
          pipeColumnIds.push(columnId);
        }
      } else {
        signatureToFirst.set(signatureKey, columnId);
      }
    }
  }

  return pipeColumnIds;
}

// =============================================================================
// Analytical Subtype Classification
// =============================================================================

interface VariableMeta {
  column: string;
  description: string;
  normalizedType: string | null;
  allowedValues: Array<number | string>;
  rangeMin: number | null;
  rangeMax: number | null;
  rangeStep: number | null;
  scaleLabels: Array<{ value: number | string; label: string }>;
}

interface SubtypeEnrichment {
  subtype: 'allocation' | 'ranking' | 'scale' | 'standard';
  source: string;
  confidence: number;
  scaleSignal: {
    detected: boolean;
    confidence: number;
    valueSet: number[] | null;
    pointCount: number | null;
    responseCoverage: number | null;
    responseCoverageNote: string | null;
  } | null;
  rankingDetail: RankingDetail | null;
}

interface TableGroupForSubtype {
  questionId: string;
  questionText: string;
  tableId: string;
  tableType: string;
  variables: string[];
}

const SCALE_COMPATIBLE_TYPES = new Set(['categorical_select', 'ordinal_scale']);
const SCALE_QUESTION_CUE = /\b(scale|rating|rate|agree|agreement|important|importance|likely|likelihood|satisfied|satisfaction|confident|confidence|familiar|familiarity|concern|impact|appeal|effective|influence|extent|severity|priority|willing|recommend)\b/i;
const LOW_ANCHOR_CUE = /\b(not at all|strongly disagree|very unlikely|unlikely|unimportant|not important|never|none|low|poor|least|minimal|worst|negative)\b/i;
const HIGH_ANCHOR_CUE = /\b(strongly agree|very likely|likely|very important|important|always|high|excellent|most|maximal|best|positive|extremely)\b/i;
const RANKING_LABEL_CUE = /\b(rank|1st|2nd|3rd|4th|5th|first|second|third|fourth|fifth|most preferred|least preferred|top choice|bottom choice)\b/i;
const RANKING_TEXT_CUE = /\b(rank|ranking|top \d|where 1 is|where one is|most preferred|least preferred|order of preference|in order|prioritize)\b/i;

export function normalizeNumericArray(
  values: Array<number | string>,
  labelByValue?: Map<number, string>,
): number[] | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const nums = values.map(v => Number(v)).filter(v => Number.isFinite(v));
  if (nums.length !== values.length) return null;
  const unique = [...new Set(nums)].sort((a, b) => a - b);
  if (unique.some(v => !Number.isInteger(v))) return null;
  if (!(unique[0] === 0 || unique[0] === 1)) return null;

  let substantiveEnd = unique.length;
  for (let i = 1; i < unique.length; i++) {
    if (unique[i] - unique[i - 1] === 1) continue;
    substantiveEnd = i;
    break;
  }

  if (substantiveEnd < unique.length) {
    if (!labelByValue) return null;
    for (let i = substantiveEnd; i < unique.length; i++) {
      const label = labelByValue.get(unique[i]);
      if (!label || !isNonSubstantiveTail(label)) return null;
    }
  }

  const substantive = unique.slice(0, substantiveEnd);
  if (substantive.length < 5 || substantive.length > 11) return null;
  return substantive;
}

function extractScaleValueSet(meta: VariableMeta): number[] | null {
  const labelByValue = new Map<number, string>();
  for (const scaleLabel of meta.scaleLabels) {
    const numericValue = Number(scaleLabel.value);
    if (!Number.isFinite(numericValue)) continue;
    labelByValue.set(numericValue, scaleLabel.label || '');
  }

  const fromAllowed = normalizeNumericArray(
    meta.allowedValues,
    labelByValue.size > 0 ? labelByValue : undefined,
  );
  if (fromAllowed) return fromAllowed;
  if (meta.normalizedType === 'numeric_range' && Number.isFinite(meta.rangeMin) && Number.isFinite(meta.rangeMax) && Number.isFinite(meta.rangeStep) && meta.rangeStep === 1) {
    const min = meta.rangeMin as number;
    const max = meta.rangeMax as number;
    if (Number.isInteger(min) && Number.isInteger(max) && (min === 0 || min === 1)) {
      const pointCount = max - min + 1;
      if (pointCount >= 5 && pointCount <= 11) {
        const values: number[] = [];
        for (let v = min; v <= max; v++) values.push(v);
        return values;
      }
    }
  }
  return null;
}

function classifyAnchorPolarity(label: string): 'low' | 'high' | null {
  const text = label.toLowerCase();
  const low = LOW_ANCHOR_CUE.test(text);
  const high = HIGH_ANCHOR_CUE.test(text);
  if (low && !high) return 'low';
  if (high && !low) return 'high';
  return null;
}

function hasNumericOnlyLabels(metas: VariableMeta[], valueSet: number[]): { allNumeric: boolean; checkedCount: number } {
  let checkedCount = 0;
  let allNumeric = true;

  for (const meta of metas) {
    if (!Array.isArray(meta.scaleLabels) || meta.scaleLabels.length === 0) continue;
    checkedCount++;
    for (const entry of meta.scaleLabels) {
      const val = Number(entry.value);
      if (!Number.isFinite(val)) continue;
      if (!valueSet.includes(val)) continue;
      const label = (entry.label || '').trim();
      if (label !== '' && label !== String(val)) { allNumeric = false; break; }
    }
    if (!allNumeric) break;
  }

  return { allNumeric, checkedCount };
}

function computeResponseCoverage(
  group: TableGroupForSubtype,
  topValues: number[],
  dataFileStats: DataFileStats | null,
): { coverage: number | null; note: string | null } {
  if (!dataFileStats) return { coverage: null, note: 'No .sav stats available' };
  const pointCount = topValues.length;
  if (pointCount === 0) return { coverage: null, note: null };

  let groupMin = Infinity;
  let groupMax = -Infinity;
  let maxNUnique = 0;
  let varsWithStats = 0;

  for (const variable of group.variables) {
    const savMeta = dataFileStats.variableMetadata[variable];
    if (!savMeta) continue;
    if (savMeta.observedMin !== null && savMeta.observedMax !== null) {
      groupMin = Math.min(groupMin, savMeta.observedMin);
      groupMax = Math.max(groupMax, savMeta.observedMax);
      varsWithStats++;
    }
    maxNUnique = Math.max(maxNUnique, savMeta.nUnique);
  }

  if (varsWithStats === 0 && maxNUnique === 0) return { coverage: null, note: 'No observed value stats for group variables' };

  let coverage: number;
  let note: string;
  if (varsWithStats > 0 && groupMin <= groupMax) {
    const observedRange = groupMax - groupMin + 1;
    coverage = Math.min(1, observedRange / pointCount);
    note = `range-based: observed ${groupMin}-${groupMax} (${observedRange} values) vs ${pointCount}-pt defined set`;
  } else {
    coverage = Math.min(1, maxNUnique / pointCount);
    note = `nUnique-based: max ${maxNUnique} distinct vs ${pointCount}-pt defined set`;
  }

  return { coverage, note };
}

function detectScaleSignalForSubtype(
  group: TableGroupForSubtype,
  variableMetas: VariableMeta[],
  dataFileStats: DataFileStats | null,
): {
  candidate: boolean;
  detected: boolean;
  confidence: number;
  valueSet: number[] | null;
  pointCount: number | null;
  numericOnlyLabels: boolean;
  rankingLabelCue: boolean;
  rankingTextCue: boolean;
  responseCoverage: number | null;
  responseCoverageNote: string | null;
} {
  const variableCount = group.variables.length;
  if (variableCount === 0 || variableMetas.length === 0) {
    return { candidate: false, detected: false, confidence: 0, valueSet: null, pointCount: null, numericOnlyLabels: false, rankingLabelCue: false, rankingTextCue: false, responseCoverage: null, responseCoverageNote: null };
  }

  const compatibleTypeCount = variableMetas.filter(meta => meta.normalizedType && SCALE_COMPATIBLE_TYPES.has(meta.normalizedType)).length;
  const compatibleTypeCoverage = compatibleTypeCount / variableCount;

  const signatureCounts = new Map<string, { values: number[]; metas: VariableMeta[] }>();
  for (const meta of variableMetas) {
    const valueSet = extractScaleValueSet(meta);
    if (!valueSet) continue;
    const signature = valueSet.join(',');
    if (!signatureCounts.has(signature)) signatureCounts.set(signature, { values: valueSet, metas: [] });
    signatureCounts.get(signature)!.metas.push(meta);
  }

  if (signatureCounts.size === 0) {
    return { candidate: false, detected: false, confidence: 0, valueSet: null, pointCount: null, numericOnlyLabels: false, rankingLabelCue: false, rankingTextCue: false, responseCoverage: null, responseCoverageNote: null };
  }

  const [, topData] = [...signatureCounts.entries()].sort((a, b) => b[1].metas.length - a[1].metas.length)[0];
  const valueCoverage = topData.metas.length / variableCount;
  const pointCount = topData.values.length;

  const questionText = `${group.questionText} ${topData.metas.map(meta => meta.description).slice(0, 5).join(' ')}`.trim();
  const questionCue = SCALE_QUESTION_CUE.test(questionText);

  let directionalEvidence = 0;
  for (const meta of topData.metas) {
    if (!Array.isArray(meta.scaleLabels) || meta.scaleLabels.length === 0) continue;
    const labelByValue = new Map<number, string>();
    for (const labelEntry of meta.scaleLabels) {
      const value = Number(labelEntry.value);
      if (!Number.isFinite(value)) continue;
      labelByValue.set(value, labelEntry.label || '');
    }
    const firstLabel = labelByValue.get(topData.values[0]);
    const lastLabel = labelByValue.get(topData.values[topData.values.length - 1]);
    if (!firstLabel || !lastLabel) continue;
    const firstPolarity = classifyAnchorPolarity(firstLabel);
    const lastPolarity = classifyAnchorPolarity(lastLabel);
    if (!firstPolarity || !lastPolarity || firstPolarity === lastPolarity) continue;
    directionalEvidence++;
  }

  const anchorEvidenceRate = topData.metas.length > 0 ? directionalEvidence / topData.metas.length : 0;
  const numericLabelCheck = hasNumericOnlyLabels(topData.metas, topData.values);
  const numericOnlyLabels = numericLabelCheck.checkedCount > 0 && numericLabelCheck.allNumeric;
  const rankingLabelCue = topData.metas.some(meta => {
    if (!Array.isArray(meta.scaleLabels) || meta.scaleLabels.length === 0) return false;
    return meta.scaleLabels.some(entry => RANKING_LABEL_CUE.test(entry.label || ''));
  });
  const rankingTextCue = RANKING_TEXT_CUE.test(questionText);
  const hasRankingSignal = numericOnlyLabels || rankingLabelCue || rankingTextCue;

  const candidate = valueCoverage >= 0.8 && pointCount >= 5 && pointCount <= 11 && compatibleTypeCoverage >= 0.8;
  const detected = candidate && !hasRankingSignal;

  const { coverage: responseCoverage, note: responseCoverageNote } = computeResponseCoverage(group, topData.values, dataFileStats);

  let confidence = 0;
  if (detected) {
    confidence = 0.7;
    if (valueCoverage === 1) confidence += 0.05;
    if (anchorEvidenceRate >= 0.5) confidence += 0.1;
    if (questionCue) confidence += 0.1;
    if (responseCoverage !== null) {
      if (responseCoverage < 0.5) confidence -= 0.30;
      else if (responseCoverage < 0.8) { const penalty = 0.05 + (0.80 - responseCoverage) * 0.25; confidence -= penalty; }
    }
    confidence = Math.max(0, Math.min(0.95, confidence));
  } else {
    confidence = 0.2;
  }

  return { candidate, detected, confidence, valueSet: topData.values, pointCount, numericOnlyLabels, rankingLabelCue, rankingTextCue, responseCoverage, responseCoverageNote };
}

function detectStandaloneRanking(
  group: TableGroupForSubtype,
  metas: VariableMeta[],
  dataFileStats: DataFileStats | null,
): { confidence: number; signals: string[]; K: number } | null {
  if (!dataFileStats || group.variables.length === 0) return null;

  let groupMin = Infinity;
  let groupMax = -Infinity;
  let maxNUnique = 0;
  let varsChecked = 0;
  let varsWithNoLabels = 0;
  let varsWithNumericOnlyLabels = 0;

  for (const variable of group.variables) {
    const savMeta = dataFileStats.variableMetadata[variable];
    if (!savMeta) continue;
    varsChecked++;
    if (savMeta.observedMin !== null && savMeta.observedMax !== null) {
      groupMin = Math.min(groupMin, savMeta.observedMin);
      groupMax = Math.max(groupMax, savMeta.observedMax);
    }
    maxNUnique = Math.max(maxNUnique, savMeta.nUnique);
    if (!savMeta.valueLabels || savMeta.valueLabels.length === 0) {
      varsWithNoLabels++;
    } else {
      const allNumeric = savMeta.valueLabels.every(vl => {
        const val = Number(vl.value);
        return Number.isFinite(val) && vl.label.trim() === String(val);
      });
      if (allNumeric) varsWithNumericOnlyLabels++;
    }
  }

  if (varsChecked === 0 || groupMin > groupMax) return null;
  if (groupMin !== 1) return null;
  const K = groupMax;
  if (K < 3 || K > 10) return null;
  if (maxNUnique > K) return null;

  const signals: string[] = [];
  let confidence = 0.45;

  const noLabelRate = varsChecked > 0 ? varsWithNoLabels / varsChecked : 0;
  const numericLabelRate = varsChecked > 0 ? varsWithNumericOnlyLabels / varsChecked : 0;
  if (noLabelRate >= 0.8) { signals.push(`no value labels (${(noLabelRate * 100).toFixed(0)}% of vars)`); confidence += 0.1; }
  else if (numericLabelRate >= 0.8) { signals.push(`numeric-only labels (${(numericLabelRate * 100).toFixed(0)}% of vars)`); confidence += 0.1; }

  const questionText = `${group.questionText} ${metas.map(m => m.description).slice(0, 5).join(' ')}`.trim();
  if (RANKING_TEXT_CUE.test(questionText)) { signals.push('ranking text cue in question'); confidence += 0.1; }

  if (group.variables.length > K) { signals.push(`top-${K} of ${group.variables.length} pattern`); confidence += 0.05; }

  if (signals.length === 0) return null;
  confidence = Math.min(0.65, confidence);
  signals.unshift(`1-${K} integer range`);

  return { confidence, signals, K };
}

function buildVariableMetaMap(verbose: VerboseDataMapType[]): Map<string, VariableMeta> {
  const map = new Map<string, VariableMeta>();
  for (const row of verbose) {
    if (!row.column) continue;
    map.set(String(row.column).toLowerCase(), {
      column: row.column,
      description: row.description || '',
      normalizedType: row.normalizedType ?? null,
      allowedValues: Array.isArray(row.allowedValues) ? row.allowedValues : [],
      rangeMin: typeof row.rangeMin === 'number' ? row.rangeMin : null,
      rangeMax: typeof row.rangeMax === 'number' ? row.rangeMax : null,
      rangeStep: typeof row.rangeStep === 'number' ? row.rangeStep : null,
      scaleLabels: Array.isArray(row.scaleLabels) ? row.scaleLabels : [],
    });
  }
  return map;
}

function classifySubtype(
  group: TableGroupForSubtype,
  variableMetaMap: Map<string, VariableMeta>,
  sumConstraint: SumConstraintEnrichment | null,
  dataFileStats: DataFileStats | null,
): SubtypeEnrichment {
  const metas: VariableMeta[] = [];
  for (const variable of group.variables) {
    const meta = variableMetaMap.get(variable.toLowerCase());
    if (meta) metas.push(meta);
  }

  const scaleSignal = detectScaleSignalForSubtype(group, metas, dataFileStats);
  const N = group.variables.length;

  function makeRankingDetail(K: number, detailSource: RankingDetail['source']): RankingDetail {
    const pattern = K < N ? `top-${K}-of-${N}` : `rank-all-${N}`;
    return { K, N, pattern, source: detailSource };
  }

  // Layer 1: Sum constraint
  if (sumConstraint?.detected && (sumConstraint.analyticalSubtype === 'allocation' || sumConstraint.analyticalSubtype === 'ranking')) {
    let rankingDetail: RankingDetail | null = null;
    if (sumConstraint.analyticalSubtype === 'ranking' && sumConstraint.rankingSignal?.K) {
      rankingDetail = makeRankingDetail(sumConstraint.rankingSignal.K, 'sum-constraint');
    }
    return {
      subtype: sumConstraint.analyticalSubtype,
      source: 'sum-constraint',
      confidence: Math.max(0.6, Math.min(0.99, sumConstraint.confidence)),
      scaleSignal: scaleSignal.detected ? { detected: true, confidence: scaleSignal.confidence, valueSet: scaleSignal.valueSet, pointCount: scaleSignal.pointCount, responseCoverage: scaleSignal.responseCoverage, responseCoverageNote: scaleSignal.responseCoverageNote } : null,
      rankingDetail,
    };
  }

  // Layer 2: Scale detection
  if (scaleSignal.detected) {
    if (scaleSignal.confidence < 0.5) {
      return { subtype: 'standard', source: 'fallback-standard', confidence: 0.85, scaleSignal: null, rankingDetail: null };
    }
    return {
      subtype: 'scale',
      source: 'deterministic-scale',
      confidence: scaleSignal.confidence,
      scaleSignal: { detected: true, confidence: scaleSignal.confidence, valueSet: scaleSignal.valueSet, pointCount: scaleSignal.pointCount, responseCoverage: scaleSignal.responseCoverage, responseCoverageNote: scaleSignal.responseCoverageNote },
      rankingDetail: null,
    };
  }

  // Layer 2.5: Scale candidate with ranking signals
  if (scaleSignal.candidate && (scaleSignal.numericOnlyLabels || scaleSignal.rankingLabelCue || scaleSignal.rankingTextCue)) {
    const K = scaleSignal.pointCount;
    const rankingDetail = K ? makeRankingDetail(K, 'scale-labels') : null;
    return { subtype: 'ranking', source: 'deterministic-ranking', confidence: 0.7, scaleSignal: null, rankingDetail };
  }

  // Layer 3: Standalone ranking
  const standaloneRanking = detectStandaloneRanking(group, metas, dataFileStats);
  if (standaloneRanking) {
    const rankingDetail = makeRankingDetail(standaloneRanking.K, 'observed-range');
    return { subtype: 'ranking', source: 'deterministic-ranking', confidence: standaloneRanking.confidence, scaleSignal: null, rankingDetail };
  }

  // Fallback: standard
  return { subtype: 'standard', source: 'fallback-standard', confidence: 0.85, scaleSignal: null, rankingDetail: null };
}

// =============================================================================
// Survey Matching
// =============================================================================

interface SurveyData {
  questionIds: string[];
  segments: Array<{ questionId: string; text: string }>;
}

async function loadSurveyData(datasetPath: string): Promise<SurveyData | null> {
  try {
    const dsFiles = await findDatasetFiles(datasetPath);
    if (!dsFiles.survey) return null;

    const tmpDir = `/tmp/qid-enricher-survey/${path.basename(datasetPath)}`;
    await fs.mkdir(tmpDir, { recursive: true });

    const result = await processSurvey(dsFiles.survey, tmpDir);
    if (!result.markdown || result.markdown.length === 0) {
      if (result.warnings.length > 0) {
        console.warn(
          `[QuestionIdEnricher] SurveyProcessor returned empty markdown for ${path.basename(datasetPath)}: ${result.warnings.join(' | ')}`,
        );
      }
      return null;
    }

    const questionIds = extractSurveyQuestionIds(result.markdown);
    const segments = segmentSurvey(result.markdown)
      .filter(s => s.questionId.length > 0)
      .map(s => ({ questionId: s.questionId, text: s.text }));

    return { questionIds, segments };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[QuestionIdEnricher] Failed to load survey data for ${path.basename(datasetPath)}: ${message}`);
    return null;
  }
}

// =============================================================================
// Loop Detection
// =============================================================================

interface SiblingFamily {
  familyBase: string;
  iterationCount: number;
  siblingQuestionIds: string[];
  members: Array<{ questionId: string; siblingIndex: number }>;
}

function parseSiblingQuestionId(questionId: string): { base: string; index: number } | null {
  const match = questionId.match(/^(.+)_(\d+)$/);
  if (!match) return null;
  return { base: match[1], index: Number(match[2]) };
}

function findSiblingFamilies(reportableQids: string[]): SiblingFamily[] {
  const familyMap = new Map<string, Array<{ questionId: string; siblingIndex: number }>>();

  for (const qid of reportableQids) {
    const parsed = parseSiblingQuestionId(qid);
    if (!parsed) continue;
    if (!familyMap.has(parsed.base)) familyMap.set(parsed.base, []);
    familyMap.get(parsed.base)!.push({ questionId: qid, siblingIndex: parsed.index });
  }

  const families: SiblingFamily[] = [];
  for (const [base, members] of familyMap) {
    if (members.length < 2) continue;
    const sorted = [...members].sort((a, b) => a.siblingIndex - b.siblingIndex);
    families.push({
      familyBase: base,
      iterationCount: sorted.length,
      siblingQuestionIds: sorted.map(m => m.questionId),
      members: sorted,
    });
  }

  return families;
}

function detectLoop(families: SiblingFamily[]): {
  loopDetected: boolean;
  loopIterationCount: number | null;
  loopFamilies: SiblingFamily[];
  nonLoopFamilies: Array<SiblingFamily & { reason: string }>;
} {
  if (families.length === 0) {
    return { loopDetected: false, loopIterationCount: null, loopFamilies: [], nonLoopFamilies: [] };
  }

  const byIterCount = new Map<number, SiblingFamily[]>();
  for (const family of families) {
    if (!byIterCount.has(family.iterationCount)) byIterCount.set(family.iterationCount, []);
    byIterCount.get(family.iterationCount)!.push(family);
  }

  let bestCount: number | null = null;
  let bestFamilyCount = 0;
  for (const [count, fams] of byIterCount) {
    if (fams.length >= 2 && fams.length > bestFamilyCount) {
      bestCount = count;
      bestFamilyCount = fams.length;
    }
  }

  if (bestCount === null) {
    const nonLoopFamilies = families.map(f => ({
      ...f,
      reason: families.length === 1
        ? 'only 1 iterated question in dataset — not a loop'
        : `no other family shares ${f.iterationCount} iterations`,
    }));
    return { loopDetected: false, loopIterationCount: null, loopFamilies: [], nonLoopFamilies };
  }

  const loopFamilies = byIterCount.get(bestCount)!;
  const loopFamilyBases = new Set(loopFamilies.map(f => f.familyBase));
  const nonLoopFamilies = families
    .filter(f => !loopFamilyBases.has(f.familyBase))
    .map(f => ({
      ...f,
      reason: `${f.iterationCount} iterations ≠ loop iteration count of ${bestCount}`,
    }));

  return { loopDetected: true, loopIterationCount: bestCount, loopFamilies, nonLoopFamilies };
}

// =============================================================================
// Biaxial Regroup Pass
// =============================================================================

function longestCommonPrefix(strings: string[]): string {
  if (strings.length === 0) return '';
  let prefix = strings[0];
  for (let i = 1; i < strings.length; i++) {
    const s = strings[i];
    let j = 0;
    while (j < prefix.length && j < s.length && prefix[j] === s[j]) j++;
    prefix = prefix.slice(0, j);
    if (prefix.length === 0) break;
  }
  return prefix;
}

function parseBiaxialRemainder(remainder: string): { dim1: string; sep: string; dim2: string } | null {
  const match = remainder.match(/^(\d+)([a-zA-Z_]+)(\d+)$/);
  if (!match) return null;
  return { dim1: match[1], sep: match[2], dim2: match[3] };
}

function applyBiaxialRegroup(
  groups: QuestionGroup[],
): { groups: QuestionGroup[]; logs: Array<{ stem: string; originalCount: number; newCount: number }> } {
  const logs: Array<{ stem: string; originalCount: number; newCount: number }> = [];

  const orphanGroups = groups.filter(g =>
    g.items.length >= 2 &&
    g.items.some(item => !item.column.startsWith(g.questionId)),
  );

  if (orphanGroups.length < 2) return { groups, logs };

  const stemToFamily = new Map<string, QuestionGroup[]>();
  for (const g of orphanGroups) {
    const stem = longestCommonPrefix(g.items.map(i => i.column));
    if (stem.length < 2) continue;
    const fam = stemToFamily.get(stem) ?? [];
    fam.push(g);
    stemToFamily.set(stem, fam);
  }

  const regroupedIds = new Set<string>();
  const newGroups: QuestionGroup[] = [];

  for (const [stem, family] of stemToFamily) {
    if (family.length < 2) continue;

    const allParsed: Array<{ item: QuestionGroup['items'][number]; dim1: string; dim2: string }> = [];
    let valid = true;

    for (const g of family) {
      for (const item of g.items) {
        const remainder = item.column.slice(stem.length);
        const parsed = parseBiaxialRemainder(remainder);
        if (!parsed) { valid = false; break; }
        allParsed.push({ item, dim1: parsed.dim1, dim2: parsed.dim2 });
      }
      if (!valid) break;
    }

    if (!valid) continue;

    const dim1Values = [...new Set(allParsed.map(p => p.dim1))].sort((a, b) => Number(a) - Number(b));
    const dim2Values = [...new Set(allParsed.map(p => p.dim2))].sort((a, b) => Number(a) - Number(b));

    if (dim1Values.length >= dim2Values.length) continue;

    const questionText = family[0].questionText;
    const generated: QuestionGroup[] = [];

    for (const d1 of dim1Values) {
      const items = allParsed
        .filter(p => p.dim1 === d1)
        .sort((a, b) => Number(a.dim2) - Number(b.dim2))
        .map(p => p.item);
      generated.push({ questionId: `${stem}${d1}`, questionText, items });
    }

    for (const g of family) regroupedIds.add(g.questionId);
    newGroups.push(...generated);
    logs.push({ stem, originalCount: family.length, newCount: generated.length });
  }

  if (newGroups.length === 0) return { groups, logs };

  return {
    groups: [...groups.filter(g => !regroupedIds.has(g.questionId)), ...newGroups],
    logs,
  };
}

// =============================================================================
// Binary Family Collapse (coded open-end grouping)
// =============================================================================

export interface BinaryCollapseLog {
  familyBase: string;
  memberCount: number;
  memberQuestionIds: string[];
}

/**
 * Collapse binary_flag sibling families into single multi-response groups.
 *
 * Coded open-end questions produce many `BASE_N` variables (one per coded theme).
 * The grouper treats each as a separate single-variable group because `_N` isn't
 * a structural suffix. This pass merges qualifying families back into one group
 * per family.
 *
 * Qualifying criteria (all must hold):
 *   1. Family has 2+ members sharing a `BASE_N` pattern
 *   2. No group with questionId === BASE exists (no parent)
 *   3. Every member group has exactly 1 item (single-variable groups)
 *   4. Every member's item has normalizedType === 'binary_flag'
 */
export function applyBinaryFamilyCollapse(
  groups: QuestionGroup[],
): { groups: QuestionGroup[]; logs: BinaryCollapseLog[] } {
  const logs: BinaryCollapseLog[] = [];

  // Build lookup: questionId → group for parent-exists check
  const groupById = new Set(groups.map(g => g.questionId));

  // Parse sibling families from group questionIds
  const familyMap = new Map<string, Array<{ group: QuestionGroup; index: number }>>();
  for (const group of groups) {
    const parsed = parseSiblingQuestionId(group.questionId);
    if (!parsed) continue;
    if (!familyMap.has(parsed.base)) familyMap.set(parsed.base, []);
    familyMap.get(parsed.base)!.push({ group, index: parsed.index });
  }

  const collapsedIds = new Set<string>();
  const newGroups: QuestionGroup[] = [];

  for (const [base, members] of familyMap) {
    // Filter 1: 2+ members
    if (members.length < 2) continue;

    // Filter 2: No parent group exists
    if (groupById.has(base)) continue;

    // Filter 3: All single-item groups
    if (!members.every(m => m.group.items.length === 1)) continue;

    // Filter 4: All binary_flag
    if (!members.every(m => m.group.items[0].normalizedType === 'binary_flag')) continue;

    // Qualify — sort by suffix index and merge
    const sorted = [...members].sort((a, b) => a.index - b.index);
    const mergedItems = sorted.map(m => m.group.items[0]);

    newGroups.push({
      questionId: base,
      questionText: base, // theme labels are item labels, not question text
      items: mergedItems,
    });

    for (const m of members) collapsedIds.add(m.group.questionId);
    logs.push({
      familyBase: base,
      memberCount: members.length,
      memberQuestionIds: sorted.map(m => m.group.questionId),
    });
  }

  if (newGroups.length === 0) return { groups, logs };

  return {
    groups: [...groups.filter(g => !collapsedIds.has(g.questionId)), ...newGroups],
    logs,
  };
}

// =============================================================================
// Helper
// =============================================================================

function mostCommon(arr: string[]): string {
  const counts = new Map<string, number>();
  for (const item of arr) counts.set(item, (counts.get(item) || 0) + 1);
  let best = arr[0];
  let bestCount = 0;
  for (const [item, count] of counts) {
    if (count > bestCount) { best = item; bestCount = count; }
  }
  return best;
}

// =============================================================================
// Default Intake Config
// =============================================================================

const DEFAULT_INTAKE: DatasetIntakeConfig = {
  isMessageTesting: false,
  isConceptTesting: false,
  hasMaxDiff: null,
  hasAnchoredScores: null,
  messageTemplatePath: null,
  isDemandSurvey: false,
  hasChoiceModelExercise: null,
};

// =============================================================================
// Main Entry Point
// =============================================================================

export interface EnricherInput {
  /** Path to .sav file */
  savPath: string;
  /** Path to dataset directory */
  datasetPath: string;
  /** Dataset name */
  dataset: string;
  /** Intake configuration (defaults to non-message, non-demand) */
  intakeConfig?: DatasetIntakeConfig;
  /** Optional row cap for demo mode. */
  maxRespondents?: number;
}

export interface EnricherResult {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
}

/**
 * Run the full step-00 enrichment: .sav → QuestionIdEntry[].
 *
 * This is the pure transform function. No file I/O for output —
 * the orchestrator writes the artifact.
 */
export async function runEnricher(input: EnricherInput): Promise<EnricherResult> {
  const { savPath, datasetPath, dataset, intakeConfig = DEFAULT_INTAKE, maxRespondents } = input;

  // Step 1: Load DataFileStats + enriched verbose datamap
  const tmpDir = `/tmp/qid-enricher/${dataset}`;
  await fs.mkdir(tmpDir, { recursive: true });

  const dataFileStats = await getDataFileStats(savPath, tmpDir, {
    maxRows: maxRespondents,
  });
  const rawVariables = convertToRawVariables(dataFileStats);
  const processor = new DataMapProcessor();
  const enriched = processor.enrichVariables(rawVariables);
  const verbose = enriched.verbose as VerboseDataMapType[];

  // Step 2: Group into question IDs
  const grouped = groupDataMapForQuestionId(verbose, {
    includeAdmin: true,
    includeOpenEnds: true,
  });

  // Step 2b: Biaxial regroup pass
  const { groups: biaxialGroups } = applyBiaxialRegroup(grouped.groups);

  // Step 2c: Binary family collapse (coded open-end grouping)
  const { groups: regroupedGroups, logs: binaryCollapseLogs } = applyBinaryFamilyCollapse(biaxialGroups);
  if (binaryCollapseLogs.length > 0) {
    console.log(
      `[QuestionIdEnricher] Binary family collapse: ${binaryCollapseLogs.length} families ` +
      `(${binaryCollapseLogs.reduce((sum, l) => sum + l.memberCount, 0)} vars → ${binaryCollapseLogs.length} groups)`,
    );
  }

  // Step 3: Classify disposition + detect hidden
  interface PendingEntry {
    group: QuestionGroup;
    variables: string[];
    normalizedType: string;
    disposition: 'reportable' | 'excluded' | 'text_open_end';
    exclusionReason: ExclusionReason;
    isHidden: boolean;
  }

  const pendingEntries: PendingEntry[] = [];

  for (const group of regroupedGroups) {
    const variables = group.items.map(item => item.column);
    const normalizedTypes = group.items.map(item => item.normalizedType).filter(Boolean);
    const primaryType = normalizedTypes.length > 0 ? mostCommon(normalizedTypes) : 'unknown';

    const isTextOpen = group.items.every(item => item.normalizedType === 'text_open');
    const hidden = isHiddenVariable(group.questionId, group.questionText);

    const groupLike: GroupLike = {
      questionId: group.questionId,
      questionText: group.questionText,
      variableCount: variables.length,
      variables,
    };

    const { disposition, exclusionReason } = classifyDisposition(groupLike, isTextOpen);

    pendingEntries.push({
      group,
      variables,
      normalizedType: primaryType,
      disposition,
      exclusionReason,
      isHidden: hidden,
    });
  }

  // Admin rescue pass
  if (dataFileStats) {
    for (const entry of pendingEntries) {
      if (entry.normalizedType !== 'admin' || entry.disposition !== 'reportable') continue;
      const hasRealData = entry.variables.some(col => {
        const meta = dataFileStats.variableMetadata[col];
        return meta && meta.nUnique > 0;
      });
      if (!hasRealData) continue;
      const firstMeta = entry.variables.map(col => dataFileStats.variableMetadata[col]).find(m => m && m.nUnique > 0);
      if (!firstMeta) continue;
      if (firstMeta.rClass === 'character') continue;

      entry.normalizedType = 'numeric_range';
      for (const item of entry.group.items) {
        if (item.normalizedType === 'admin') item.normalizedType = 'numeric_range';
      }
      for (const col of entry.variables) {
        const verboseEntry = verbose.find(v => v.column === col);
        if (verboseEntry && verboseEntry.normalizedType === 'admin') verboseEntry.normalizedType = 'numeric_range';
      }
    }
  }

  // Build non-hidden QID set for hidden variable linking
  const nonHiddenQids = new Set(
    pendingEntries.filter(e => !e.isHidden).map(e => e.group.questionId),
  );

  const reportableGroups = pendingEntries.filter(e => e.disposition === 'reportable');

  // Step 5: Sum constraint detection
  const sumConstraintByQid = new Map<string, SumConstraintEnrichment>();
  for (const entry of reportableGroups) {
    if (entry.variables.length < 2) continue;
    if (entry.normalizedType !== 'numeric_range') continue;
    try {
      const result = await detectSumConstraint(savPath, entry.variables);
      if (result) sumConstraintByQid.set(entry.group.questionId, result);
    } catch { /* non-fatal */ }
  }

  // Step 6: Pipe column detection
  const pipeColumnsByQid = new Map<string, string[]>();
  const allReportableVars = new Set<string>();
  for (const entry of reportableGroups) {
    for (const v of entry.variables) allReportableVars.add(v);
  }

  if (allReportableVars.size > 0) {
    try {
      const { stats } = await extractVariableStats(savPath, [...allReportableVars]);
      for (const entry of reportableGroups) {
        const pipes = detectPipeColumns(entry.variables, stats);
        if (pipes.length > 0) pipeColumnsByQid.set(entry.group.questionId, pipes);
      }
    } catch { /* non-fatal */ }
  }

  // Step 7: Analytical subtype classification
  const variableMetaMap = buildVariableMetaMap(verbose);
  const subtypeByQid = new Map<string, SubtypeEnrichment>();

  for (const entry of reportableGroups) {
    const tableGroup: TableGroupForSubtype = {
      questionId: entry.group.questionId,
      questionText: entry.group.questionText,
      tableId: entry.group.questionId,
      tableType: 'unknown',
      variables: entry.variables,
    };
    const sumConstraint = sumConstraintByQid.get(entry.group.questionId) || null;
    const subtype = classifySubtype(tableGroup, variableMetaMap, sumConstraint, dataFileStats);
    subtypeByQid.set(entry.group.questionId, subtype);
  }

  // Step 8: Survey matching
  const surveyData = await loadSurveyData(datasetPath);
  const surveyMatchByQid = new Map<string, { matchType: 'exact' | 'suffix'; surveyText: string | null }>();

  if (surveyData && surveyData.questionIds.length > 0) {
    for (const entry of pendingEntries) {
      const match = matchesQuestionId(entry.group.questionId, surveyData.questionIds, surveyData.segments);
      if (match) {
        const matchType = match === entry.group.questionId ? 'exact' as const : 'suffix' as const;
        const segment = surveyData.segments.find(s => s.questionId === match);
        const surveyText = segment ? segment.text.trim() : null;
        surveyMatchByQid.set(entry.group.questionId, { matchType, surveyText });
      }
    }
  }

  // Step 9: Loop detection
  const reportableQids = pendingEntries
    .filter(e => e.disposition === 'reportable')
    .map(e => e.group.questionId);

  const siblingFamilies = findSiblingFamilies(reportableQids);
  const loopResult = detectLoop(siblingFamilies);

  const loopByQid = new Map<string, {
    detected: boolean;
    familyBase: string;
    iterationIndex: number;
    iterationCount: number;
    siblingFamilyBases: string[];
  }>();

  if (loopResult.loopDetected) {
    const allLoopBases = loopResult.loopFamilies.map(f => f.familyBase);
    for (const family of loopResult.loopFamilies) {
      for (const member of family.members) {
        loopByQid.set(member.questionId, {
          detected: true,
          familyBase: family.familyBase,
          iterationIndex: member.siblingIndex,
          iterationCount: family.iterationCount,
          siblingFamilyBases: allLoopBases,
        });
      }
    }
  }

  for (const family of loopResult.nonLoopFamilies) {
    for (const member of family.members) {
      loopByQid.set(member.questionId, {
        detected: false,
        familyBase: family.familyBase,
        iterationIndex: member.siblingIndex,
        iterationCount: family.iterationCount,
        siblingFamilyBases: [],
      });
    }
  }

  // Step 10: Assemble enriched entries
  const questionIds: QuestionIdEntry[] = pendingEntries.map(entry => {
    const qid = entry.group.questionId;
    const linkedHidden = entry.isHidden && entry.disposition !== 'excluded'
      ? linkHiddenVariable(qid, nonHiddenQids)
      : null;
    const hiddenLink = linkedHidden?.linkedTo ? linkedHidden : null;

    const sumConstraint = sumConstraintByQid.get(qid) || null;
    const subtype = subtypeByQid.get(qid) || null;
    const surveyMatch = surveyMatchByQid.get(qid) || null;
    const pipeColumns = pipeColumnsByQid.get(qid) || [];

    if (sumConstraint?.pipeColumns && sumConstraint.pipeColumns.length > 0) {
      for (const p of sumConstraint.pipeColumns) {
        if (!pipeColumns.includes(p)) pipeColumns.push(p);
      }
    }

    const sumConstraintInfo: SumConstraintInfo | null = sumConstraint ? {
      detected: sumConstraint.detected,
      constraintValue: sumConstraint.constraintValue,
      constraintAxis: sumConstraint.constraintAxis,
      confidence: sumConstraint.confidence,
    } : null;

    return {
      questionId: qid,
      questionText: entry.group.questionText,
      variables: entry.variables,
      variableCount: entry.variables.length,

      disposition: entry.disposition,
      exclusionReason: entry.exclusionReason,
      isHidden: entry.isHidden,
      hiddenLink,

      analyticalSubtype: subtype?.subtype || null,
      subtypeSource: subtype?.source || null,
      subtypeConfidence: subtype?.confidence || null,
      rankingDetail: subtype?.rankingDetail || null,

      sumConstraint: sumConstraintInfo,
      pipeColumns,

      surveyMatch: surveyMatch?.matchType ?? (surveyData ? 'none' : null),
      surveyText: surveyMatch?.surveyText ?? null,

      priority: (entry.isHidden && !(surveyMatch?.matchType === 'exact' || surveyMatch?.matchType === 'suffix'))
        ? 'secondary' : 'primary',

      loop: entry.disposition === 'reportable' ? (loopByQid.get(qid) ?? null) : null,
      loopQuestionId: loopByQid.get(qid)?.detected ? loopByQid.get(qid)!.familyBase : null,

      normalizedType: entry.normalizedType,
      items: entry.group.items.map(item => {
        const savMeta = dataFileStats?.variableMetadata[item.column] ?? null;
        return {
          column: item.column,
          label: item.label,
          normalizedType: item.normalizedType,
          itemBase: null,
          messageCode: null,
          messageText: null,
          altCode: null,
          altText: null,
          matchMethod: null,
          matchConfidence: 0,
          nUnique: savMeta?.nUnique ?? null,
          observedMin: savMeta?.observedMin ?? null,
          observedMax: savMeta?.observedMax ?? null,
          observedValues: savMeta?.observedValues ?? null,
          ...(item.scaleLabels && item.scaleLabels.length > 0 ? { scaleLabels: item.scaleLabels } : {}),
        };
      }),
      totalN: null,
      questionBase: null,
      isFiltered: null,
      gapFromTotal: null,
      gapPct: null,
      hasVariableItemBases: null,
      variableBaseReason: null,
      itemBaseRange: null,
      baseContract: makeEmptyBaseContract(),
      proposedBase: null,
      proposedBaseLabel: null,
      hasMessageMatches: false,
      stimuliSets: null,
      displayQuestionId: null,
      displayQuestionText: null,
      sectionHeader: null,
      itemActivity: null,
      _aiGateReview: null,
      _reconciliation: null,
    };
  });

  // Build metadata
  const metadata: SurveyMetadata = {
    dataset,
    generatedAt: new Date().toISOString(),
    scriptVersion: 'v3-runtime-00',
    isMessageTestingSurvey: intakeConfig.isMessageTesting,
    isConceptTestingSurvey: intakeConfig.isConceptTesting,
    hasMaxDiff: intakeConfig.hasMaxDiff,
    hasAnchoredScores: intakeConfig.hasAnchoredScores,
    messageTemplatePath: intakeConfig.messageTemplatePath,
    isDemandSurvey: intakeConfig.isDemandSurvey,
    hasChoiceModelExercise: intakeConfig.hasChoiceModelExercise,
  };

  return { entries: questionIds, metadata };
}
