import { describe, it, expect } from 'vitest';
import { segmentSurvey, buildSurveyOutline } from '../surveyChunker';

describe('segmentSurvey', () => {
  it('extracts question IDs from standard formatting', () => {
    const markdown = [
      'Welcome to the survey.',
      'S1. What is your name?',
      'S2. How old are you?',
    ].join('\n');

    const segments = segmentSurvey(markdown);
    const ids = segments.map(s => s.questionId);
    expect(ids).toEqual(['', 'S1', 'S2']);
  });

  it('extracts question IDs when periods are wrapped in bold markdown', () => {
    // LibreOffice → Turndown sometimes produces S4**.** instead of S4.
    const markdown = [
      'Preamble text.',
      'S3. What is your role?',
      'S4**.** What is your primary specialty/role?',
      'S5. What is your medical specialty?',
    ].join('\n');

    const segments = segmentSurvey(markdown);
    const ids = segments.map(s => s.questionId);
    expect(ids).toEqual(['', 'S3', 'S4', 'S5']);
  });

  it('handles bold around full question ID + period', () => {
    const markdown = [
      '**S1.** Welcome question',
      '**S2.** Second question',
    ].join('\n');

    const segments = segmentSurvey(markdown);
    const ids = segments.map(s => s.questionId);
    expect(ids).toEqual(['S1', 'S2']);
  });
});

describe('buildSurveyOutline', () => {
  it('extracts question IDs through bold markdown formatting', () => {
    const markdown = [
      'S3. What is your role?',
      'S4**.** What is your primary specialty?',
      'S5. What is your medical specialty?',
    ].join('\n');

    const outline = buildSurveyOutline(markdown);
    expect(outline).toContain('S3:');
    expect(outline).toContain('S4:');
    expect(outline).toContain('S5:');
  });
});
