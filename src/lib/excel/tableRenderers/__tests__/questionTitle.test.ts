import { describe, expect, it } from 'vitest';
import { formatQuestionTitle } from '../questionTitle';

describe('formatQuestionTitle', () => {
  it('prepends questionId when text has no leading ID', () => {
    expect(formatQuestionTitle('S1', 'You are about to enter a survey.')).toBe(
      'S1. You are about to enter a survey.',
    );
  });

  it('removes repeated leading ID prefixes from question text', () => {
    expect(formatQuestionTitle('S1', 'S1: You are about to enter a survey.')).toBe(
      'S1. You are about to enter a survey.',
    );
    expect(formatQuestionTitle('S1', 'S1. S1: You are about to enter a survey.')).toBe(
      'S1. You are about to enter a survey.',
    );
  });

  it('does not strip mismatched IDs', () => {
    expect(formatQuestionTitle('S1', 'S10: Different question')).toBe(
      'S1. S10: Different question',
    );
  });

  it('formats display override values without duplicating ID', () => {
    expect(formatQuestionTitle('B500', 'Rank the most motivating messages')).toBe(
      'B500. Rank the most motivating messages',
    );
    expect(formatQuestionTitle('B500', 'B500. Rank the most motivating messages')).toBe(
      'B500. Rank the most motivating messages',
    );
  });
});
