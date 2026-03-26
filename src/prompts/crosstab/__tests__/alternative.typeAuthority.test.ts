import { describe, expect, it } from 'vitest';
import { CROSSTAB_VALIDATION_INSTRUCTIONS_ALTERNATIVE } from '../alternative';
import { CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION } from '../production';

describe('crosstab prompt type authority', () => {
  it('includes type authority guidance in production prompt', () => {
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('type attribute is AUTHORITATIVE');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('numeric_range');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('Only use statistical functions');
  });

  it('includes type authority guidance in alternative prompt', () => {
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_ALTERNATIVE).toContain('Type is AUTHORITATIVE');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_ALTERNATIVE).toContain('numeric_range');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_ALTERNATIVE).toContain('statistical functions');
  });

  it('production prompt has V3 structural patterns', () => {
    // New production prompt should have the V3 agent DNA sections
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('<mission>');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('<default_posture>');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('<evidence_hierarchy>');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('<hard_bounds>');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('PASS 1: ANALYZE');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('PASS 2: VALIDATE');
  });

  it('both prompts contain original-expression fallback guidance', () => {
    // Both prompts should guide the agent to include the original expression as an alternative
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_PRODUCTION).toContain('original expression references real variables');
    expect(CROSSTAB_VALIDATION_INSTRUCTIONS_ALTERNATIVE).toContain('original banner expression references real data-map variables');
  });
});
