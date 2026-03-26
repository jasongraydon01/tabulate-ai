import { describe, it, expect } from 'vitest';
import { getVerificationPrompt } from '../index';
import { VERIFICATION_AGENT_INSTRUCTIONS_PRODUCTION } from '../production';
import { VERIFICATION_AGENT_INSTRUCTIONS_ALTERNATIVE } from '../alternative';

describe('verification prompt selection', () => {
  it('keeps production prompt unchanged as default selection target', () => {
    expect(getVerificationPrompt('production')).toBe(VERIFICATION_AGENT_INSTRUCTIONS_PRODUCTION);
  });

  it('routes alternative prompt explicitly without mutating production prompt payload', () => {
    const production = getVerificationPrompt('production');
    const alternative = getVerificationPrompt('alternative');

    expect(alternative).toBe(VERIFICATION_AGENT_INSTRUCTIONS_ALTERNATIVE);
    expect(alternative).not.toBe(production);
    expect(production).not.toContain('YOU ARE IN MUTATION MODE');
    expect(alternative).toContain('YOU ARE IN MUTATION MODE');
  });
});
