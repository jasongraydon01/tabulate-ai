import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  buildEnhancerShadowDiff,
  collectEnhancerRunDiagnostics,
  decideTableEnhancerRollout,
} from '../tableEnhancerControl';
import { makeRow, makeTable } from '../../__tests__/fixtures';

const ENV_KEYS = [
  'TABLE_ENHANCER_CANARY_DATASETS',
  'TABLE_ENHANCER_AUTO_ROLLBACK_ENABLED',
  'TABLE_ENHANCER_ROLLBACK_MAX_EXPANSION_RATIO',
  'VERIFICATION_MUTATION_MAX_STRUCTURAL_RATE',
  'VERIFICATION_MUTATION_MAX_LABEL_CHANGE_RATE',
] as const;

describe('tableEnhancerControl', () => {
  const previousEnv = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      previousEnv.set(key, process.env[key]);
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      const value = previousEnv.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    previousEnv.clear();
  });

  it('demotes active mode to shadow when dataset is outside canary cohort', () => {
    process.env.TABLE_ENHANCER_CANARY_DATASETS = 'pilot-alpha,pilot-beta';

    const decision = decideTableEnhancerRollout({
      datasetName: 'enterprise-client-01',
      baselineTableCount: 10,
      enhancedTableCount: 12,
      enhancerEnabled: true,
      enhancerShadowMode: false,
    });

    expect(decision.requestedMode).toBe('active');
    expect(decision.effectiveMode).toBe('shadow');
    expect(decision.applyEnhancedOutput).toBe(false);
    expect(decision.reasons).toContain('dataset_not_in_canary_cohort');
  });

  it('auto-rolls back to shadow when expansion ratio breaches threshold', () => {
    process.env.TABLE_ENHANCER_CANARY_DATASETS = 'pilot-alpha';
    process.env.TABLE_ENHANCER_AUTO_ROLLBACK_ENABLED = 'true';
    process.env.TABLE_ENHANCER_ROLLBACK_MAX_EXPANSION_RATIO = '1.2';

    const decision = decideTableEnhancerRollout({
      datasetName: 'pilot-alpha-dataset',
      baselineTableCount: 10,
      enhancedTableCount: 20,
      enhancerEnabled: true,
      enhancerShadowMode: false,
    });

    expect(decision.requestedMode).toBe('active');
    expect(decision.effectiveMode).toBe('shadow');
    expect(decision.rollbackTriggered).toBe(true);
    expect(decision.reasons.some((reason) => reason.includes('expansion_ratio_breach'))).toBe(true);
  });

  it('builds stable shadow diff with changed/add/remove table tracking', () => {
    const baseline = [
      makeTable({
        tableId: 'q1',
        rows: [makeRow({ variable: 'Q1', filterValue: '1', label: 'A' })],
      }),
      makeTable({ tableId: 'q2', rows: [makeRow({ variable: 'Q2', filterValue: '1', label: 'B' })] }),
    ];
    const enhanced = [
      makeTable({
        tableId: 'q1',
        rows: [makeRow({ variable: 'Q1', filterValue: '1', label: 'A updated' })],
      }),
      makeTable({ tableId: 'q3', rows: [makeRow({ variable: 'Q3', filterValue: '1', label: 'C' })] }),
    ];

    const diff = buildEnhancerShadowDiff(baseline, enhanced);

    expect(diff.addedTableIds).toEqual(['q3']);
    expect(diff.removedTableIds).toEqual(['q2']);
    expect(diff.changedTables).toHaveLength(1);
    expect(diff.changedTables[0].tableId).toBe('q1');
    expect(diff.changedTables[0].rowsChanged).toBe(true);
  });

  it('aggregates enhancement + verification diagnostics and emits breach artifact', async () => {
    process.env.TABLE_ENHANCER_AUTO_ROLLBACK_ENABLED = 'true';
    process.env.VERIFICATION_MUTATION_MAX_STRUCTURAL_RATE = '0.2';
    process.env.VERIFICATION_MUTATION_MAX_LABEL_CHANGE_RATE = '0.5';

    const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'enhancer-diag-'));
    const enhancerDir = path.join(outputDir, 'enhancer');
    const verificationDir = path.join(outputDir, 'verification');
    await fs.mkdir(enhancerDir, { recursive: true });
    await fs.mkdir(verificationDir, { recursive: true });

    await fs.writeFile(
      path.join(enhancerDir, 'enhancement-report.json'),
      JSON.stringify({ flaggedForAI: ['scaleDirectionNeedsReview'] }, null, 2),
      'utf-8',
    );
    await fs.writeFile(
      path.join(verificationDir, 'verification-edit-reports.json'),
      JSON.stringify(
        [
          {
            tableId: 'q1',
            familyId: 'q1',
            labelsChanged: 8,
            labelsTotal: 10,
            structuralMutations: ['row_count_changed'],
            netsAdded: 1,
            netsRemoved: 0,
            exclusionChanged: false,
            metadataChanges: ['baseText'],
            confidence: 0.8,
          },
        ],
        null,
        2,
      ),
      'utf-8',
    );

    const result = await collectEnhancerRunDiagnostics(outputDir);

    expect(result.aggregate).not.toBeNull();
    expect(result.warnings.some((warning) => warning.startsWith('enhancerFlaggedForAI>'))).toBe(true);
    expect(
      result.warnings.some((warning) => warning.startsWith('verificationStructuralMutations>')),
    ).toBe(true);
    expect(
      result.warnings.some((warning) => warning.startsWith('enhancerRollbackThresholdBreach>')),
    ).toBe(true);

    const aggregatePath = path.join(enhancerDir, 'enhancement-verification-aggregate.json');
    const rollbackPath = path.join(enhancerDir, 'rollback-threshold-breach.json');
    await expect(fs.access(aggregatePath)).resolves.toBeUndefined();
    await expect(fs.access(rollbackPath)).resolves.toBeUndefined();
  });
});
