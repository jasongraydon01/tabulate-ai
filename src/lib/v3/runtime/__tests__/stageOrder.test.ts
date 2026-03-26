import { describe, it, expect } from 'vitest';
import {
  V3_STAGE_ORDER,
  V3_STAGE_COUNT,
  V3_STAGE_NAMES,
  V3_STAGE_PHASES,
  type V3StageId,
  getStageIndex,
  getNextStage,
  isBefore,
  getStageRange,
  isV3StageId,
} from '../stageOrder';

describe('V3 Stage Order', () => {
  // =========================================================================
  // Stage registry integrity
  // =========================================================================

  it('contains exactly the 18 active V3 stages', () => {
    expect(V3_STAGE_ORDER).toHaveLength(18);
    expect(V3_STAGE_COUNT).toBe(18);
  });

  it('includes all required stages from the V3 script chain', () => {
    const required: V3StageId[] = [
      '00', '03', '08a', '08b', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e',
      '20', '21', '22', '14',
    ];
    for (const stage of required) {
      expect(V3_STAGE_ORDER).toContain(stage);
    }
  });

  it('matches the canonical stage order exactly', () => {
    expect(V3_STAGE_ORDER).toEqual([
      '00', '03', '08a', '08b', '09d', '10a', '10', '11', '12',
      '13b', '13c1', '13c2', '13d', '13e',
      '20', '21', '22', '14',
    ]);
  });

  it('has no duplicate stage IDs', () => {
    const unique = new Set(V3_STAGE_ORDER);
    expect(unique.size).toBe(V3_STAGE_ORDER.length);
  });

  it('starts with question-id chain (00) and ends with post-R QC (14)', () => {
    expect(V3_STAGE_ORDER[0]).toBe('00');
    expect(V3_STAGE_ORDER[V3_STAGE_ORDER.length - 1]).toBe('14');
  });

  it('places question-id chain (00–12) before table chain (13b–13d)', () => {
    expect(isBefore('12', '13b')).toBe(true);
  });

  it('places table chain before banner chain', () => {
    expect(isBefore('13d', '20')).toBe(true);
  });

  it('places banner chain before compute', () => {
    expect(isBefore('21', '22')).toBe(true);
  });

  // =========================================================================
  // Stage name and phase maps
  // =========================================================================

  it('has a human-readable name for every stage', () => {
    for (const stage of V3_STAGE_ORDER) {
      expect(V3_STAGE_NAMES[stage]).toBeDefined();
      expect(V3_STAGE_NAMES[stage].length).toBeGreaterThan(0);
    }
  });

  it('has a phase assignment for every stage', () => {
    for (const stage of V3_STAGE_ORDER) {
      expect(V3_STAGE_PHASES[stage]).toBeDefined();
    }
  });

  it('assigns question-id-chain phase to stages 00–12', () => {
    const qidStages: V3StageId[] = ['00', '03', '08a', '08b', '09d', '10a', '10', '11', '12'];
    for (const stage of qidStages) {
      expect(V3_STAGE_PHASES[stage]).toBe('question-id-chain');
    }
  });

  it('assigns table-chain phase to stages 13b–13d', () => {
    const tableStages: V3StageId[] = ['13b', '13c1', '13c2', '13d'];
    for (const stage of tableStages) {
      expect(V3_STAGE_PHASES[stage]).toBe('table-chain');
    }
  });

  // =========================================================================
  // Helper functions
  // =========================================================================

  it('getStageIndex returns correct indices', () => {
    expect(getStageIndex('00')).toBe(0);
    expect(getStageIndex('14')).toBe(V3_STAGE_ORDER.length - 1);
    expect(getStageIndex('12')).toBe(8);
  });

  it('getStageIndex throws for unknown stage', () => {
    // @ts-expect-error — testing invalid input
    expect(() => getStageIndex('99')).toThrow('Unknown V3 stage ID: 99');
  });

  it('getNextStage returns the following stage', () => {
    expect(getNextStage('00')).toBe('03');
    expect(getNextStage('08a')).toBe('08b');
    expect(getNextStage('12')).toBe('13b');
    expect(getNextStage('21')).toBe('22');
  });

  it('getNextStage returns null for the last stage', () => {
    expect(getNextStage('14')).toBeNull();
  });

  it('isBefore correctly orders stages', () => {
    expect(isBefore('00', '14')).toBe(true);
    expect(isBefore('14', '00')).toBe(false);
    expect(isBefore('10', '10')).toBe(false);
  });

  it('getStageRange returns inclusive slice', () => {
    const range = getStageRange('10a', '12');
    expect(range).toEqual(['10a', '10', '11', '12']);
  });

  it('getStageRange throws for inverted range', () => {
    expect(() => getStageRange('12', '00')).toThrow('invalid range');
  });

  it('isV3StageId validates stage IDs', () => {
    expect(isV3StageId('00')).toBe(true);
    expect(isV3StageId('08b')).toBe(true);
    expect(isV3StageId('13c1')).toBe(true);
    expect(isV3StageId('99')).toBe(false);
    expect(isV3StageId('')).toBe(false);
    expect(isV3StageId('13a')).toBe(false); // 13a is diagnostic, not active
  });
});
