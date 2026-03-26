/**
 * V3 Runtime — Step 03: Base Enricher
 *
 * Enriches QuestionIdEntry[] with base information by reading the .sav file.
 * For each reportable question ID, computes:
 *   - totalN: total sample size
 *   - questionBase: unique respondents who answered at least one variable
 *   - isFiltered: whether the base is lower than the total sample
 *   - gapFromTotal / gapPct: numeric and percentage gap from total
 *   - hasVariableItemBases: whether items have materially different bases
 *   - variableBaseReason: 'ranking-artifact' | 'genuine' | null
 *   - proposedBase / proposedBaseLabel: what the downstream system should use
 *   - itemBaseRange: [min, max] of per-item bases
 *
 * For each item within a question:
 *   - itemBase: non-NA count for that specific variable
 *
 * Zero-respondent exclusion: entries with questionBase === 0 are set to
 * disposition='excluded', exclusionReason='zero_respondents'.
 *
 * Ported from: scripts/v3-enrichment/03-base-enricher.ts
 *
 * No file I/O for output — the orchestrator handles artifact persistence.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

import type { QuestionIdEntry, SurveyMetadata } from '../types';
import { buildEntryBaseContract, makeEmptyBaseContract } from '../../baseContract';

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
// Types
// =============================================================================

/** R subprocess output shape */
interface RBaseResult {
  totalN: number;
  perQuestion: Array<{
    questionId: string;
    questionBase: number;
    perVariable: Record<string, number>;
  }>;
}

/** Internal base enrichment result for a single question */
interface BaseEnrichment {
  totalN: number;
  questionBase: number;
  isFiltered: boolean;
  gapFromTotal: number;
  gapPct: number;
  perVariable: Record<string, number>;
  hasVariableItemBases: boolean;
  variableBaseReason: 'ranking-artifact' | 'genuine' | null;
  itemBaseRange: [number, number] | null;
  proposedBase: number;
  proposedBaseLabel: string;
}

/** Input for runBaseEnricher */
export interface BaseEnricherInput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
  savPath: string;
}

/** Output from runBaseEnricher */
export interface BaseEnricherOutput {
  entries: QuestionIdEntry[];
  metadata: SurveyMetadata;
}

// =============================================================================
// R Execution: Compute bases for all question IDs in one call
// =============================================================================

/**
 * Runs a single R/haven call to compute totalN and per-question base counts.
 *
 * @param savPath - Absolute path to the .sav data file
 * @param specs - Array of { questionId, variables } to compute bases for
 * @param workDir - Directory for temporary R script and spec files
 * @returns Parsed R output with totalN and perQuestion results
 */
async function computeBases(
  savPath: string,
  specs: Array<{ questionId: string; variables: string[] }>,
  workDir: string,
): Promise<RBaseResult> {
  const rPath = await findRPath();

  // Write specs to a temp JSON file for R to read
  const specsPath = path.join(workDir, 'base-specs.json');
  await fs.writeFile(specsPath, JSON.stringify(specs), 'utf-8');

  const escapedSavPath = savPath.replace(/\\/g, '/');
  const escapedSpecsPath = specsPath.replace(/\\/g, '/');

  const rScript = `
suppressMessages(library(haven))
suppressMessages(library(jsonlite))

data <- tryCatch(
  read_sav("${escapedSavPath}"),
  error = function(e) {
    if (grepl("iconv|encoding|translat", e$message, ignore.case = TRUE)) {
      read_sav("${escapedSavPath}", encoding = "latin1")
    } else { stop(e) }
  }
)

spec <- fromJSON("${escapedSpecsPath}", simplifyVector = FALSE)

total_n <- as.integer(nrow(data))
results <- vector("list", length(spec))

for (i in seq_along(spec)) {
  item <- spec[[i]]
  qid <- item$questionId
  vars <- unlist(item$variables)
  vars <- vars[vars %in% colnames(data)]

  if (length(vars) == 0) {
    results[[i]] <- list(
      questionId = qid,
      questionBase = 0L,
      perVariable = setNames(list(), character(0))
    )
    next
  }

  sub <- data[, vars, drop = FALSE]

  # Question base: respondents answering at least one variable
  nm <- !is.na(sub)
  if (is.matrix(nm)) {
    q_base <- as.integer(sum(rowSums(nm) > 0))
  } else {
    # Single column — nm is a vector
    q_base <- as.integer(sum(nm))
  }

  # Per-variable non-NA counts
  per_var <- list()
  for (v in vars) {
    per_var[[v]] <- as.integer(sum(!is.na(data[[v]])))
  }

  results[[i]] <- list(
    questionId = qid,
    questionBase = q_base,
    perVariable = per_var
  )
}

out <- list(totalN = total_n, perQuestion = results)
cat(toJSON(out, auto_unbox = TRUE, null = "null"))
`;

  const scriptPath = path.join(workDir, '_base_enricher.R');
  await fs.writeFile(scriptPath, rScript, 'utf-8');

  const { stdout, stderr } = await execFileAsync(
    rPath,
    ['--vanilla', scriptPath],
    { maxBuffer: 100 * 1024 * 1024, timeout: 120_000 },
  );

  // Log R warnings for diagnostics (non-fatal)
  if (stderr) {
    const warnings = stderr.split('\n').filter(l => l.trim());
    if (warnings.length > 0) {
      console.log(`    R warnings: ${warnings.length}`);
    }
  }

  // Clean up temp files (best-effort, don't block on failure)
  fs.unlink(specsPath).catch(() => {});
  fs.unlink(scriptPath).catch(() => {});

  try {
    return JSON.parse(stdout) as RBaseResult;
  } catch {
    throw new Error(`Failed to parse R base enrichment output: ${stdout.substring(0, 500)}`);
  }
}

// =============================================================================
// Base Enrichment Logic (pure computation)
// =============================================================================

/**
 * Computes base enrichment fields for a single question.
 *
 * @param totalN - Total sample size
 * @param rResult - R output for this question (questionBase + perVariable)
 * @param questionId - The question identifier (used in label text)
 * @param rankingDetail - Ranking metadata from step 00 (null if not a ranking)
 * @returns Full base enrichment fields
 */
function computeBaseEnrichment(
  totalN: number,
  rResult: { questionBase: number; perVariable: Record<string, number> },
  questionId: string,
  rankingDetail: QuestionIdEntry['rankingDetail'],
): BaseEnrichment {
  const { questionBase, perVariable } = rResult;
  const isFiltered = questionBase < totalN;
  const gapFromTotal = totalN - questionBase;
  const gapPct = totalN > 0 ? Number(((gapFromTotal / totalN) * 100).toFixed(2)) : 0;

  const itemBases = Object.values(perVariable);
  const minBase = itemBases.length > 0 ? Math.min(...itemBases) : 0;
  const maxBase = itemBases.length > 0 ? Math.max(...itemBases) : 0;

  // Any non-zero spread = different bases. The data is the truth — if one item has
  // fewer respondents than another, that's a real signal. Downstream systems decide
  // whether the difference is material enough to act on.
  const hasVariableItemBases = itemBases.length > 1 && minBase !== maxBase;

  // Ranking artifact detection: if the question is already classified as a
  // ranking subtype (via subtype detection: scale labels, text cues, sum
  // constraints, observed value ranges), per-variable base variation is
  // inherent to the ranking pattern — respondents select/rank a subset of
  // items. The variation is from selection behavior, not show logic.
  let variableBaseReason: BaseEnrichment['variableBaseReason'] = null;
  if (hasVariableItemBases && rankingDetail?.K) {
    variableBaseReason = 'ranking-artifact';
  } else if (hasVariableItemBases) {
    variableBaseReason = 'genuine';
  }

  let proposedBase: number;
  let proposedBaseLabel: string;

  if (hasVariableItemBases && variableBaseReason === 'ranking-artifact') {
    // Ranking artifact: all items were shown to all respondents.
    // Use the question-level base as the uniform shown base.
    proposedBase = questionBase;
    proposedBaseLabel = isFiltered ? `Those answering ${questionId}` : 'Total';
  } else if (hasVariableItemBases) {
    proposedBase = questionBase;
    proposedBaseLabel = 'Varies by item';
  } else if (isFiltered) {
    proposedBase = questionBase;
    proposedBaseLabel = `Those answering ${questionId}`;
  } else {
    proposedBase = totalN;
    proposedBaseLabel = 'Total';
  }

  return {
    totalN,
    questionBase,
    isFiltered,
    gapFromTotal,
    gapPct,
    perVariable,
    hasVariableItemBases,
    variableBaseReason,
    itemBaseRange: itemBases.length > 0 ? [minBase, maxBase] : null,
    proposedBase,
    proposedBaseLabel,
  };
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Runs step 03 base enrichment on a set of QuestionIdEntry[].
 *
 * Reads the .sav file once via R/haven to compute base counts for all
 * reportable entries, then flattens base fields onto each entry and adds
 * itemBase to each item. Entries with questionBase === 0 are excluded.
 *
 * @param input - { entries, metadata, savPath }
 * @returns Enriched entries with base fields + updated metadata
 */
export async function runBaseEnricher(input: BaseEnricherInput): Promise<BaseEnricherOutput> {
  const { entries, metadata, savPath } = input;

  if (entries.length === 0) {
    return { entries, metadata };
  }

  // Build specs for reportable entries only
  const reportable = entries.filter(e => e.disposition === 'reportable');
  if (reportable.length === 0) {
    // No reportable entries — still add totalN=null placeholders
    const passthrough = entries.map(entry => ({
      ...entry,
      totalN: null,
      questionBase: null,
      isFiltered: null,
      gapFromTotal: null,
      gapPct: null,
      hasVariableItemBases: null,
      variableBaseReason: null as 'ranking-artifact' | 'genuine' | null,
      itemBaseRange: null as [number, number] | null,
      baseContract: makeEmptyBaseContract(),
      proposedBase: null,
      proposedBaseLabel: null,
    }));
    return { entries: passthrough, metadata };
  }

  const specs = reportable.map(e => ({
    questionId: e.questionId,
    variables: e.variables,
  }));

  // Use a temp directory alongside the .sav file for R script/specs
  const workDir = path.dirname(savPath);

  // Run R — one call for the entire dataset
  const rResult = await computeBases(savPath, specs, workDir);

  // Build lookup from R results
  const rByQid = new Map<string, RBaseResult['perQuestion'][number]>();
  for (const r of rResult.perQuestion) {
    rByQid.set(r.questionId, r);
  }

  // Enrich each entry — flatten base fields to question level, add itemBase per item
  const enriched: QuestionIdEntry[] = entries.map(entry => {
    if (entry.disposition !== 'reportable') {
      return {
        ...entry,
        totalN: rResult.totalN,
        questionBase: null,
        isFiltered: null,
        gapFromTotal: null,
        gapPct: null,
        hasVariableItemBases: null,
        variableBaseReason: null as 'ranking-artifact' | 'genuine' | null,
        itemBaseRange: null as [number, number] | null,
        baseContract: makeEmptyBaseContract(),
        proposedBase: null,
        proposedBaseLabel: null,
      };
    }

    const rData = rByQid.get(entry.questionId);
    if (!rData) {
      return {
        ...entry,
        totalN: rResult.totalN,
        questionBase: null,
        isFiltered: null,
        gapFromTotal: null,
        gapPct: null,
        hasVariableItemBases: null,
        variableBaseReason: null as 'ranking-artifact' | 'genuine' | null,
        itemBaseRange: null as [number, number] | null,
        baseContract: makeEmptyBaseContract(),
        proposedBase: null,
        proposedBaseLabel: null,
      };
    }

    const base = computeBaseEnrichment(rResult.totalN, rData, entry.questionId, entry.rankingDetail);

    // Add itemBase to each item in the items array
    const enrichedItems = entry.items?.map(item => ({
      ...item,
      itemBase: base.perVariable[item.column] ?? null,
    })) ?? [];

    // Flatten base fields to question level (no nested `base` object)
    return {
      ...entry,
      totalN: base.totalN,
      questionBase: base.questionBase,
      isFiltered: base.isFiltered,
      gapFromTotal: base.gapFromTotal,
      gapPct: base.gapPct,
      hasVariableItemBases: base.hasVariableItemBases,
      variableBaseReason: base.variableBaseReason,
      itemBaseRange: base.itemBaseRange,
      baseContract: buildEntryBaseContract({
        totalN: base.totalN,
        questionBase: base.questionBase,
        itemBase: null,
        itemBaseRange: base.itemBaseRange,
        hasVariableItemBases: base.hasVariableItemBases,
        variableBaseReason: base.variableBaseReason,
        rankingDetail: entry.rankingDetail,
        exclusionReason: entry.exclusionReason,
      }),
      proposedBase: base.proposedBase,
      proposedBaseLabel: base.proposedBaseLabel,
      items: enrichedItems,
    };
  });

  // ---------------------------------------------------------------------------
  // Zero-respondent exclusion pass
  //
  // If a reportable entry has questionBase === 0 after base computation,
  // no respondents answered this question. This happens when:
  //   - Survey versioning: question was removed but variables remain in .sav
  //   - Routing: question was programmed but never activated for this sample
  //   - Wave tracking: question existed in a prior wave but not this one
  //
  // These entries produce empty tables and can cause wrong survey matches
  // (e.g., a removed C2 matching to a new C2 with different semantics).
  // Excluding them here prevents them from flowing into triage/AI gate.
  // ---------------------------------------------------------------------------
  let zeroRespondentCount = 0;
  for (const entry of enriched) {
    if (entry.disposition === 'reportable' && entry.questionBase === 0) {
      (entry as Record<string, unknown>).disposition = 'excluded';
      (entry as Record<string, unknown>).exclusionReason = 'zero_respondents';
      zeroRespondentCount++;
    }
  }
  if (zeroRespondentCount > 0) {
    console.log(`    Zero-respondent exclusion: excluded ${zeroRespondentCount} question(s) with questionBase=0`);
  }

  for (const entry of enriched) {
    entry.baseContract = buildEntryBaseContract({
      totalN: entry.totalN,
      questionBase: entry.questionBase,
      itemBase: null,
      itemBaseRange: entry.itemBaseRange,
      hasVariableItemBases: entry.hasVariableItemBases,
      variableBaseReason: entry.variableBaseReason,
      rankingDetail: entry.rankingDetail,
      exclusionReason: entry.exclusionReason,
    });
  }

  return { entries: enriched, metadata };
}
