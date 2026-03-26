/**
 * Survey Cleanup Orchestrator (Step 08b)
 *
 * Primary strategy:
 * - Split parsed survey questions into smaller chunks
 * - Run one AI cleanup call per chunk (in parallel)
 * - Stitch chunks back together in original order
 * - If a chunk fails after retry, keep that chunk's original parsed questions
 *
 * This keeps AI as the cleanup authority while reducing one-shot fragility.
 */

import fs from 'fs/promises';
import path from 'path';
import pLimit from 'p-limit';
import {
  clearContextScratchpadsForAgent,
  getAllContextScratchpadEntries,
  formatScratchpadAsMarkdown,
} from '@/agents/tools/scratchpad';
import { runSurveyCleanupCall } from '@/agents/SurveyCleanupAgent';
import type { SurveyCleanupOutput } from '@/schemas/surveyCleanupSchema';
import { getSurveyCleanupChunkingConfig, type SurveyCleanupChunkingConfig } from '@/lib/env';
import { persistStageAgentTrace } from '../../agentTraces';
import { mergeCleanupOutputs, type CleanupMergeStats } from './surveyCleanupMerge';
import type { ParsedSurveyQuestion } from '../types';

// =============================================================================
// Types
// =============================================================================

export interface SurveyCleanupInput {
  surveyParsed: ParsedSurveyQuestion[];
  /** Full survey markdown for source context (null if no survey doc) */
  surveyMarkdown: string | null;
  outputDir: string;
  abortSignal?: AbortSignal;
}

export interface SurveyCleanupResult {
  surveyParsed: ParsedSurveyQuestion[];
  stats: CleanupMergeStats;
  scratchpadMarkdown: string;
}

interface ChunkPlan {
  chunkSize: number;
  chunkCount: number;
  parallelism: number;
}

interface ChunkResult {
  merged: ParsedSurveyQuestion[];
  stats: CleanupMergeStats;
  debug: ChunkDebugInfo;
}

interface ChunkDebugInfo {
  chunkLabel: string;
  questionIds: string[];
  attempts: number;
  callIndices: number[];
  fallbackUsed: boolean;
  outputFilename: string | null;
  output: SurveyCleanupOutput | null;
}

function emptyStats(totalQuestions: number, fallbackUsed: boolean, validOutputs = 0): CleanupMergeStats {
  return {
    totalQuestions,
    questionsModified: 0,
    fieldChanges: {
      questionText: 0,
      instructionText: 0,
      answerOptions: 0,
      scaleLabels: 0,
      questionType: 0,
      sectionHeader: 0,
    },
    validOutputs,
    fallbackUsed,
  };
}

function buildChunkPlan(totalQuestions: number, cfg: SurveyCleanupChunkingConfig): ChunkPlan {
  const minCalls = totalQuestions >= cfg.largeSurveyThreshold ? cfg.minCallsLarge : cfg.minCallsSmall;
  const targetCalls = Math.ceil(totalQuestions / cfg.targetQuestionsPerCall);
  const chunkCount = Math.max(1, Math.min(cfg.maxCalls, Math.max(minCalls, targetCalls), totalQuestions));
  const chunkSize = Math.ceil(totalQuestions / chunkCount);
  const parallelism = Math.min(cfg.maxParallelChunkCalls, chunkCount);
  return { chunkSize, chunkCount, parallelism };
}

function splitIntoChunksByCount<T>(items: T[], chunkCount: number): T[][] {
  const chunks: T[][] = [];
  const total = items.length;
  for (let i = 0; i < chunkCount; i++) {
    const start = Math.floor((i * total) / chunkCount);
    const end = Math.floor(((i + 1) * total) / chunkCount);
    if (end > start) {
      chunks.push(items.slice(start, end));
    }
  }
  return chunks;
}

function aggregateChunkStats(stats: CleanupMergeStats[]): CleanupMergeStats {
  return {
    totalQuestions: stats.reduce((sum, s) => sum + s.totalQuestions, 0),
    questionsModified: stats.reduce((sum, s) => sum + s.questionsModified, 0),
    fieldChanges: {
      questionText: stats.reduce((sum, s) => sum + s.fieldChanges.questionText, 0),
      instructionText: stats.reduce((sum, s) => sum + s.fieldChanges.instructionText, 0),
      answerOptions: stats.reduce((sum, s) => sum + s.fieldChanges.answerOptions, 0),
      scaleLabels: stats.reduce((sum, s) => sum + s.fieldChanges.scaleLabels, 0),
      questionType: stats.reduce((sum, s) => sum + s.fieldChanges.questionType, 0),
      sectionHeader: stats.reduce((sum, s) => sum + s.fieldChanges.sectionHeader, 0),
    },
    validOutputs: stats.reduce((sum, s) => sum + s.validOutputs, 0),
    fallbackUsed: stats.some(s => s.fallbackUsed),
  };
}

function sanitizeChunkLabel(chunkLabel: string): string {
  return chunkLabel.replace('/', '-of-');
}

async function persistChunkOutputs(
  outputDir: string,
  chunkDebug: ChunkDebugInfo[],
): Promise<Array<Omit<ChunkDebugInfo, 'output'> & { sectionHeaderCount: number }>> {
  const tracesDir = path.join(outputDir, 'agents', 'survey-cleanup', 'chunks');
  await fs.mkdir(tracesDir, { recursive: true });

  const persisted: Array<Omit<ChunkDebugInfo, 'output'> & { sectionHeaderCount: number }> = [];

  for (const chunk of chunkDebug) {
    let outputFilename = chunk.outputFilename;
    let sectionHeaderCount = 0;

    if (chunk.output) {
      const safeLabel = sanitizeChunkLabel(chunk.chunkLabel);
      const fileName = `08b-survey-cleanup-${safeLabel}.json`;
      await fs.writeFile(
        path.join(tracesDir, fileName),
        JSON.stringify({
          chunkLabel: chunk.chunkLabel,
          questionIds: chunk.questionIds,
          attempts: chunk.attempts,
          callIndices: chunk.callIndices,
          output: chunk.output,
        }, null, 2),
        'utf-8',
      );
      outputFilename = path.posix.join('agents', 'survey-cleanup', 'chunks', fileName);
      sectionHeaderCount = chunk.output.questions.filter(q => q.sectionHeader.trim() !== '').length;
    }

    persisted.push({
      chunkLabel: chunk.chunkLabel,
      questionIds: chunk.questionIds,
      attempts: chunk.attempts,
      callIndices: chunk.callIndices,
      fallbackUsed: chunk.fallbackUsed,
      outputFilename,
      sectionHeaderCount,
    });
  }

  return persisted;
}

// =============================================================================
// Orchestrator
// =============================================================================

export async function runSurveyCleanup(
  input: SurveyCleanupInput,
): Promise<SurveyCleanupResult> {
  const { surveyParsed, surveyMarkdown, outputDir, abortSignal } = input;

  if (surveyParsed.length === 0) {
    return {
      surveyParsed,
      stats: emptyStats(0, false, 0),
      scratchpadMarkdown: '',
    };
  }

  const startTime = Date.now();
  const chunkCfg = getSurveyCleanupChunkingConfig();
  const plan = buildChunkPlan(surveyParsed.length, chunkCfg);
  const chunks = splitIntoChunksByCount(surveyParsed, plan.chunkCount);
  let nextCallIndex = 0;
  const allocateCallIndex = (): number => {
    const idx = nextCallIndex;
    nextCallIndex += 1;
    return idx;
  };

  console.log(
    `[SurveyCleanup] Starting chunked cleanup for ${surveyParsed.length} questions ` +
      `(${chunks.length} calls, ~${plan.chunkSize} questions/chunk, parallelism=${plan.parallelism})`,
  );

  clearContextScratchpadsForAgent('SurveyCleanupAgent');
  const limit = pLimit(plan.parallelism);

  const chunkResults = await Promise.all(
    chunks.map((chunk, chunkIdx) =>
      limit(async (): Promise<ChunkResult> => {
        const chunkLabel = `chunk-${chunkIdx + 1}/${chunks.length}`;

        let output = null;
        let attempts = 0;
        const callIndices: number[] = [];
        while (attempts <= chunkCfg.maxChunkRetryCalls && output === null) {
          attempts += 1;
          const callIndex = allocateCallIndex();
          callIndices.push(callIndex);
          output = await runSurveyCleanupCall({
            parsedQuestions: chunk,
            surveyMarkdown,
            callIndex,
            outputDir,
            abortSignal,
          });

          if (output === null && attempts <= chunkCfg.maxChunkRetryCalls) {
            console.warn(
              `[SurveyCleanup:${chunkLabel}] Attempt ${attempts} failed. Retrying...`,
            );
          }
        }

        if (output === null) {
          console.warn(
            `[SurveyCleanup:${chunkLabel}] Failed after ${attempts} attempt(s). Using original parsed chunk.`,
          );
          return {
            merged: chunk,
            stats: emptyStats(chunk.length, true, 0),
            debug: {
              chunkLabel,
              questionIds: chunk.map(q => q.questionId),
              attempts,
              callIndices,
              fallbackUsed: true,
              outputFilename: null,
              output: null,
            },
          };
        }

        // Reuse deterministic field application/preservation logic from merge:
        // duplicate the same output to satisfy its 2+ voting requirement.
        const mergedResult = mergeCleanupOutputs(chunk, [output, output]);
        const stats: CleanupMergeStats = {
          ...mergedResult.stats,
          validOutputs: 1,
          fallbackUsed: false,
        };

        console.log(
          `[SurveyCleanup:${chunkLabel}] OK (${attempts} attempt${attempts === 1 ? '' : 's'}) ` +
            `${stats.questionsModified}/${stats.totalQuestions} modified`,
        );

        return {
          merged: mergedResult.merged,
          stats,
          debug: {
            chunkLabel,
            questionIds: chunk.map(q => q.questionId),
            attempts,
            callIndices,
            fallbackUsed: false,
            outputFilename: null,
            output,
          },
        };
      }),
    ),
  );

  const finalSurveyParsed = chunkResults.flatMap((r) => r.merged);
  const finalStats = aggregateChunkStats(chunkResults.map((r) => r.stats));

  const contextEntries = getAllContextScratchpadEntries('SurveyCleanupAgent');
  const allScratchpadEntries = contextEntries.flatMap((ctx) =>
    ctx.entries.map((e) => ({ ...e, contextId: ctx.contextId })),
  );
  const scratchpadMarkdown = formatScratchpadAsMarkdown(
    'SurveyCleanupAgent',
    allScratchpadEntries,
  );
  clearContextScratchpadsForAgent('SurveyCleanupAgent');

  const persistedChunkDebug = await persistChunkOutputs(
    outputDir,
    chunkResults.map((r) => r.debug),
  );

  await persistStageAgentTrace({
    outputDir,
    stageId: '08b',
    agentName: 'SurveyCleanupAgent',
    status: 'written',
    reportFilename: '08b-survey-cleanup-report.json',
    summary: {
      totalQuestions: finalStats.totalQuestions,
      questionsModified: finalStats.questionsModified,
      fieldChanges: finalStats.fieldChanges,
      validOutputs: finalStats.validOutputs,
      fallbackUsed: finalStats.fallbackUsed,
      chunkCount: persistedChunkDebug.length,
      chunks: persistedChunkDebug,
    } as unknown as Record<string, unknown>,
    scratchpadMarkdown,
    scratchpadFilename: '08b-survey-cleanup-scratchpad.md',
  });

  const durationMs = Date.now() - startTime;
  const succeededChunks = chunkResults.filter((r) => !r.stats.fallbackUsed).length;

  console.log(
    `[SurveyCleanup] Done (chunked): ${finalStats.questionsModified}/${finalStats.totalQuestions} questions modified ` +
      `(${durationMs}ms, chunks=${succeededChunks}/${chunks.length}, calls=${nextCallIndex})` +
      `${finalStats.fallbackUsed ? ' [PARTIAL FALLBACK]' : ''}`,
  );

  if (finalStats.questionsModified > 0) {
    const fc = finalStats.fieldChanges;
    console.log(
      `[SurveyCleanup] Field changes: questionText=${fc.questionText}, ` +
        `instructionText=${fc.instructionText}, answerOptions=${fc.answerOptions}, ` +
        `scaleLabels=${fc.scaleLabels}, questionType=${fc.questionType}, ` +
        `sectionHeader=${fc.sectionHeader}`,
    );
  }

  return {
    surveyParsed: finalSurveyParsed,
    stats: finalStats,
    scratchpadMarkdown,
  };
}
