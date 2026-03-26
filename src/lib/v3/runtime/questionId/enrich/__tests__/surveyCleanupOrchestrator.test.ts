import fs from 'fs/promises';
import os from 'os';
import path from 'path';

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { runWithPipelineContext } from '@/lib/pipeline/PipelineContext';
import type { ParsedSurveyQuestion } from '@/lib/v3/runtime/questionId/types';
import type { SurveyCleanupOutput } from '@/schemas/surveyCleanupSchema';
import { runSurveyCleanup } from '../surveyCleanupOrchestrator';
import { runSurveyCleanupCall } from '@/agents/SurveyCleanupAgent';

vi.mock('@/agents/SurveyCleanupAgent', () => ({
  runSurveyCleanupCall: vi.fn(),
}));

const mockedRunSurveyCleanupCall = vi.mocked(runSurveyCleanupCall);

const TEST_SURVEY_MARKDOWN = '# Test Survey\n\nQ1. Test question?\n1. Yes\n2. No';

function makeQuestion(index: number): ParsedSurveyQuestion {
  const id = `Q${index + 1}`;
  return {
    questionId: id,
    rawText: `Raw ${id}`,
    questionText: `Question ${id}`,
    instructionText: null,
    answerOptions: [
      { code: 1, text: 'Yes', isOther: false, anchor: false, routing: null, progNote: null },
      { code: 2, text: 'No', isOther: false, anchor: false, routing: null, progNote: null },
    ],
    scaleLabels: null,
    questionType: 'single_select',
    format: 'numbered_list',
    progNotes: [],
    strikethroughSegments: [],
    sectionHeader: null,
  };
}

function toCleanupOutput(
  questions: ParsedSurveyQuestion[],
  opts?: { questionSuffix?: string },
): SurveyCleanupOutput {
  const suffix = opts?.questionSuffix ?? '';
  return {
    questions: questions.map((q) => ({
      questionId: q.questionId,
      questionText: `${q.questionText}${suffix}`,
      instructionText: q.instructionText ?? '',
      answerOptions: q.answerOptions.map((o) => ({ code: o.code, text: o.text })),
      scaleLabels: (q.scaleLabels ?? []).map((s) => ({ value: s.value, label: s.label })),
      questionType: q.questionType,
      sectionHeader: q.sectionHeader ?? '',
    })),
  };
}

describe('runSurveyCleanup', () => {
  beforeEach(() => {
    mockedRunSurveyCleanupCall.mockReset();
  });

  it('chunks large surveys into 10-20 AI calls and stitches results in order', async () => {
    const surveyParsed = Array.from({ length: 63 }, (_, i) => makeQuestion(i));

    mockedRunSurveyCleanupCall.mockImplementation(async ({ parsedQuestions }) =>
      toCleanupOutput(parsedQuestions, { questionSuffix: ' [clean]' }),
    );

    const result = await runWithPipelineContext(
      { pipelineId: 'pipeline-chunked', runId: 'run-chunked', source: 'pipelineRunner' },
      () =>
        runSurveyCleanup({
          surveyParsed,
          surveyMarkdown: TEST_SURVEY_MARKDOWN,
          outputDir: '/tmp',
        }),
    );

    expect(mockedRunSurveyCleanupCall.mock.calls.length).toBeGreaterThanOrEqual(10);
    expect(mockedRunSurveyCleanupCall.mock.calls.length).toBeLessThanOrEqual(20);
    expect(result.stats.fallbackUsed).toBe(false);
    expect(result.surveyParsed).toHaveLength(63);
    expect(result.surveyParsed.every((q) => q.questionText.endsWith(' [clean]'))).toBe(true);
  });

  it('falls back per-chunk to original questions when a chunk fails', async () => {
    const surveyParsed = Array.from({ length: 41 }, (_, i) => makeQuestion(i));

    mockedRunSurveyCleanupCall.mockImplementation(async ({ parsedQuestions }) => {
      const hasQ1 = parsedQuestions.some((q) => q.questionId === 'Q1');
      if (hasQ1) {
        // Fail this chunk even after retry.
        return null;
      }
      return toCleanupOutput(parsedQuestions, { questionSuffix: ' [clean]' });
    });

    const result = await runWithPipelineContext(
      { pipelineId: 'pipeline-partial-fallback', runId: 'run-partial-fallback', source: 'pipelineRunner' },
      () =>
        runSurveyCleanup({
          surveyParsed,
          surveyMarkdown: TEST_SURVEY_MARKDOWN,
          outputDir: '/tmp',
        }),
    );

    // 10 chunk calls for 41 questions (large-survey mode) + 1 retry for failed chunk.
    expect(mockedRunSurveyCleanupCall).toHaveBeenCalledTimes(11);
    expect(result.surveyParsed).toHaveLength(41);
    expect(result.stats.fallbackUsed).toBe(true);
    expect(result.surveyParsed[0].questionText).toBe('Question Q1');
    expect(result.surveyParsed[40].questionText).toBe('Question Q41 [clean]');
    expect(result.stats.totalQuestions).toBe(41);
  });

  it('persists survey-cleanup trace artifacts with per-chunk outputs', async () => {
    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'survey-cleanup-trace-'));
    const surveyParsed = Array.from({ length: 3 }, (_, i) => makeQuestion(i));

    mockedRunSurveyCleanupCall.mockImplementation(async ({ parsedQuestions }) => ({
      questions: parsedQuestions.map((q, idx) => ({
        questionId: q.questionId,
        questionText: `${q.questionText} [clean]`,
        instructionText: q.instructionText ?? '',
        answerOptions: q.answerOptions.map((o) => ({ code: o.code, text: o.text })),
        scaleLabels: (q.scaleLabels ?? []).map((s) => ({ value: s.value, label: s.label })),
        questionType: q.questionType,
        sectionHeader: idx === 0 ? 'DEMO' : '',
      })),
    }));

    try {
      await runWithPipelineContext(
        { pipelineId: 'pipeline-debug', runId: 'run-debug', source: 'pipelineRunner' },
        () =>
          runSurveyCleanup({
            surveyParsed,
            surveyMarkdown: TEST_SURVEY_MARKDOWN,
            outputDir,
          }),
      );

      const agentDir = path.join(outputDir, 'agents', 'survey-cleanup');
      const agentFiles = await fs.readdir(agentDir);

      expect(agentFiles).toContain('08b-survey-cleanup-report.json');

      const chunksDir = path.join(agentDir, 'chunks');
      const chunkFiles = await fs.readdir(chunksDir);
      expect(chunkFiles.some((name) => name.startsWith('08b-survey-cleanup-chunk-'))).toBe(true);

      const chunkFile = chunkFiles.find((name) => name.startsWith('08b-survey-cleanup-chunk-'));
      const chunkPayload = JSON.parse(
        await fs.readFile(path.join(chunksDir, chunkFile!), 'utf-8'),
      ) as {
        output: SurveyCleanupOutput;
      };

      expect(chunkPayload.output.questions[0]?.sectionHeader).toBe('DEMO');
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });

  it('passes surveyMarkdown through to each agent call', async () => {
    const surveyParsed = Array.from({ length: 3 }, (_, i) => makeQuestion(i));
    const markdown = '# My Survey\n\n## Demographics\n\nQ1. What is your age?';

    mockedRunSurveyCleanupCall.mockImplementation(async ({ parsedQuestions, surveyMarkdown }) => {
      expect(surveyMarkdown).toBe(markdown);
      return toCleanupOutput(parsedQuestions);
    });

    await runWithPipelineContext(
      { pipelineId: 'p-md-passthrough', runId: 'r-md-passthrough', source: 'pipelineRunner' },
      () =>
        runSurveyCleanup({
          surveyParsed,
          surveyMarkdown: markdown,
          outputDir: '/tmp',
        }),
    );

    expect(mockedRunSurveyCleanupCall).toHaveBeenCalled();
  });

  it('handles null surveyMarkdown without errors', async () => {
    const surveyParsed = Array.from({ length: 3 }, (_, i) => makeQuestion(i));

    mockedRunSurveyCleanupCall.mockImplementation(async ({ parsedQuestions, surveyMarkdown }) => {
      expect(surveyMarkdown).toBeNull();
      return toCleanupOutput(parsedQuestions);
    });

    const result = await runWithPipelineContext(
      { pipelineId: 'p-null-md', runId: 'r-null-md', source: 'pipelineRunner' },
      () =>
        runSurveyCleanup({
          surveyParsed,
          surveyMarkdown: null,
          outputDir: '/tmp',
        }),
    );

    expect(mockedRunSurveyCleanupCall).toHaveBeenCalled();
    expect(result.surveyParsed).toHaveLength(3);
  });
});
