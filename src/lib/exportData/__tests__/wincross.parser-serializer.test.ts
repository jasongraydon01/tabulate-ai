import { describe, expect, it } from 'vitest';
import {
  parseRawWinCrossJob,
  parseWinCrossPreferenceJob,
  buildDefaultWinCrossPreferenceProfile,
} from '@/lib/exportData/wincross/parser';
import { serializeWinCrossJob } from '@/lib/exportData/wincross/serializer';
import type { WinCrossResolvedArtifacts } from '@/lib/exportData/wincross/types';
import {
  buildRawWinCrossJobBuffer,
  buildReferenceWinCrossJobBuffer,
} from './wincross.fixtures';

describe('WinCross parser + serializer', () => {
  it('parses UTF-16 reference files and extracts section/pattern hints', async () => {
    const [hcpBuffer, rawBuffer] = await Promise.all([
      Promise.resolve(buildReferenceWinCrossJobBuffer()),
      Promise.resolve(buildRawWinCrossJobBuffer()),
    ]);

    const parsedHcp = parseWinCrossPreferenceJob(hcpBuffer);
    const parsedRaw = parseWinCrossPreferenceJob(rawBuffer);

    expect(parsedHcp.diagnostics.sectionNames).toEqual(expect.arrayContaining([
      'VERSION',
      'PREFERENCES',
      'SIGFOOTER',
      'TABLES',
      'BANNERS',
    ]));
    expect(parsedHcp.profile.tablePatternHints.tableCount).toBeGreaterThan(0);
    expect(parsedHcp.profile.tablePatternHints.useCount).toBeGreaterThan(0);
    expect(parsedHcp.profile.tablePatternHints.afCount).toBeGreaterThan(0);
    expect(parsedHcp.profile.numericPreferenceVector).toContain('Courier New');
    expect(parsedHcp.profile.statsDictionary.SM).toBe('Mean');
    expect(parsedHcp.profile.tableStyleHints.sourceTableCount).toBeGreaterThan(0);
    expect(parsedHcp.profile.tableStyleHints.valueReferenceColumn).not.toBeNull();
    expect(parsedHcp.profile.tableStyleHints.statLabelCaretColumn).not.toBeNull();
    expect(parsedHcp.profile.tableStyleHints.netRowSuffixToken).toBeNull();
    expect(parsedRaw.profile.tablePatternHints.tableCount).toBeGreaterThan(0);
    expect(parsedRaw.profile.tablePatternHints.useCount).toBe(0);
    expect(parsedRaw.profile.tablePatternHints.afCount).toBe(0);
  });

  it('preserves raw preference and banner structure for later normalization', async () => {
    const hcpBuffer = await Promise.resolve(buildReferenceWinCrossJobBuffer());

    const raw = parseRawWinCrossJob(hcpBuffer);

    expect(raw.preferenceSection.rawLines.length).toBeGreaterThan(0);
    expect(raw.preferenceSection.vectorLine).toContain('Courier New');
    expect(raw.preferenceSection.tokenAssignmentLines.length).toBeGreaterThan(0);
    expect(raw.preferenceSection.statLabelLines.length).toBeGreaterThan(0);
    expect(raw.bannerSection.rawLines.length).toBeGreaterThan(0);
    expect(raw.bannerSection.layoutDirectiveLines.length).toBeGreaterThan(0);
    expect(raw.bannerSection.memberLogicLines.length).toBeGreaterThan(0);
    expect(raw.bannerSection.displayRowLines.length).toBeGreaterThan(0);
    expect(raw.tableSection.styleHints.sourceTableCount).toBeGreaterThan(0);
  });

  it('stores portable preference and banner layout lines on the normalized profile', async () => {
    const hcpBuffer = await Promise.resolve(buildReferenceWinCrossJobBuffer());

    const parsed = parseWinCrossPreferenceJob(hcpBuffer);

    expect(parsed.profile.preferenceLines.length).toBeGreaterThan(0);
    expect(parsed.profile.preferenceLines[0]).toContain('Courier New');
    expect(parsed.profile.bannerLayoutLines.length).toBeGreaterThan(0);
    expect(parsed.profile.bannerMemberLines.length).toBeGreaterThan(0);
    expect(parsed.profile.bannerDisplayLines.length).toBeGreaterThan(0);
    expect(parsed.profile.bannerLayoutLines[0]).toContain('*Banner1');
    expect(parsed.profile.tableStyleHints.valueReferenceColumn).not.toBeNull();
  });

  it('classifies shallow source table header-row patterns without parsing source study logic', () => {
    const inlineJob = [
      '[VERSION]',
      '25.0',
      '',
      '[PREFERENCES]',
      '0,0,0,0,0',
      'OS,OR,OV,OI2,O%',
      'Total^TN^1',
      '',
      '[TABLES]',
      'T1^1',
      ' OS,OR,OV,OI2,O%',
      ' Demo table',
      'SBase: Total',
      'Section A^',
      ' Item 1^             Q1r1 (1)',
      'Section B^',
      ' Item 2^             Q1r2 (2)',
      '',
      '[BANNERS]',
      '*Banner1',
      'TN',
      '',
      '[TITLE]',
      'Demo',
    ].join('\r\n');

    const parsed = parseWinCrossPreferenceJob(inlineJob);

    expect(parsed.profile.tableStyleHints.headerRowPattern).toBe('sectioned_label_only');
    expect(parsed.profile.tableStyleHints.valueReferenceColumn).toBeGreaterThan(0);
    expect(parsed.profile.tableStyleHints.headerLeadingSpaces).toBe(0);
  });

  it('classifies shallow source net-row display hints conservatively', () => {
    const inlineJob = [
      '[VERSION]',
      '25.0',
      '',
      '[PREFERENCES]',
      '0,0,0,0,0',
      'OS,OR,OV,OI2,O%',
      'Total^TN^1',
      '',
      '[TABLES]',
      'T1^1',
      ' OS,OR,OV,OI2,O%',
      ' Demo table',
      'SBase: Total',
      ' Top 2 Box^NET(Q1r1,Q1r2)^SX',
      ' Item 1^             Q1r1 (1)',
      '',
      '[BANNERS]',
      '*Banner1',
      'TN',
      '',
      '[TITLE]',
      'Demo',
    ].join('\r\n');

    const parsed = parseWinCrossPreferenceJob(inlineJob);

    expect(parsed.profile.tableStyleHints.netRowSuffixToken).toBe('SX');
  });

  it('serializes deterministically for the same artifacts/profile', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();

    const first = serializeWinCrossJob(artifacts, profile);
    const second = serializeWinCrossJob(artifacts, profile);

    // Buffer comparison
    expect(first.content.equals(second.content)).toBe(true);
    expect(first.contentUtf8).toBe(second.contentUtf8);
    expect(first.tableCount).toBe(2);
    // t1 has AF, t2 doesn't — different fingerprints, so no USE= sharing
    expect(first.useCount).toBe(0);
    expect(first.afCount).toBe(1);

    // Verify BOM
    expect(first.content[0]).toBe(0xFF);
    expect(first.content[1]).toBe(0xFE);

    // Verify CRLF
    expect(first.contentUtf8).toContain('\r\n');
  });

  it('returns tableStatuses with correct structure', () => {
    const artifacts = createArtifacts();
    const profile = buildDefaultWinCrossPreferenceProfile();
    const result = serializeWinCrossJob(artifacts, profile);

    expect(result.tableStatuses).toHaveLength(2);
    for (const status of result.tableStatuses) {
      expect(status).toHaveProperty('tableId');
      expect(status).toHaveProperty('ordinal');
      expect(status).toHaveProperty('semanticExportStatus');
      expect(status).toHaveProperty('styleParityStatus');
      expect(status).toHaveProperty('usedUse');
      expect(status).toHaveProperty('usedAf');
      expect(status).toHaveProperty('dataFrameRef');
      expect(status).toHaveProperty('warnings');
    }
  });
});

function createArtifacts(): WinCrossResolvedArtifacts {
  const metadata = {
    manifestVersion: 'phase1.v1',
    generatedAt: '2026-03-19T00:00:00.000Z',
    weighting: { weightVariable: null, mode: 'unweighted' as const },
    sourceSavNames: { uploaded: 'input.sav', runtime: 'dataFile.sav' },
    availableDataFiles: [{
      dataFrameRef: 'wide',
      fileName: 'wide.sav',
      relativePath: 'export/data/wide.sav',
      exists: true,
      r2Key: 'r2/wide',
    }],
    artifactPaths: {
      inputs: {
        sortedFinal: 'tables/13e-table-enriched.json',
        resultsTables: 'results/tables.json',
        crosstabRaw: 'planning/21-crosstab-plan.json',
        loopSummary: 'enrichment/loop-summary.json',
        loopPolicy: 'agents/loop-semantics/loop-semantics-policy.json',
      },
      outputs: {
        metadata: 'export/export-metadata.json',
        tableRouting: 'export/table-routing.json',
        jobRoutingManifest: 'export/job-routing-manifest.json',
        loopPolicy: 'export/loop-semantics-policy.json',
        supportReport: 'export/support-report.json',
      },
    },
    convexRefs: {},
    r2Refs: { finalized: false, artifacts: {}, dataFiles: {} },
    warnings: [],
    idempotency: { integrityDigest: 'digest-1', jobs: {} },
    support: { q: { supported: 1, warning: 0, blocked: 0 }, wincross: { supported: 1, warning: 0, blocked: 0 } },
    readiness: {
      evaluatedAt: '2026-03-19T00:00:00.000Z',
      local: { ready: true, reasonCodes: ['ready'], details: [] },
      reexport: { ready: true, reasonCodes: ['ready'], details: [] },
    },
    integrity: {
      algorithm: 'sha256' as const,
      metadataPayloadChecksum: 'x',
      artifactChecksums: {},
      dataFileChecksums: {},
      verifiedAt: '2026-03-19T00:00:00.000Z',
    },
  } as unknown as WinCrossResolvedArtifacts['metadata'];

  return {
    metadata,
    tableRouting: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      totalTables: 2,
      tableToDataFrameRef: { t1: 'wide', t2: 'wide' },
      countsByDataFrameRef: { wide: 2 },
    },
    jobRoutingManifest: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      totalJobs: 1,
      totalTables: 2,
      jobs: [{
        jobId: 'wide.job',
        dataFrameRef: 'wide',
        dataFileRelativePath: 'export/data/wide.sav',
        tableIds: ['t1', 't2'],
      }],
      tableToJobId: { t1: 'wide.job', t2: 'wide.job' },
    },
    loopPolicy: null,
    supportReport: {
      generatedAt: '2026-03-19T00:00:00.000Z',
      manifestVersion: 'phase1.v1',
      expressionSummary: { total: 0, parsed: 0, blocked: 0 },
      expressions: [],
      supportItems: [],
      summary: { q: { supported: 1, warning: 0, blocked: 0 }, wincross: { supported: 1, warning: 0, blocked: 0 } },
    },
    sortedFinal: {
      _metadata: {},
      tables: [
        {
          tableId: 't1',
          questionId: 'Q1',
          questionText: 'Question 1',
          tableType: 'frequency',
          additionalFilter: 'SEG == 1',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'B', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
        {
          tableId: 't2',
          questionId: 'Q2',
          questionText: 'Question 2',
          tableType: 'frequency',
          additionalFilter: '',
          rows: [
            { variable: 'Q1r1', label: 'A', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
            { variable: 'Q1r2', label: 'B', filterValue: '1', rowKind: 'value', isNet: false, netComponents: [] },
          ],
        },
      ],
    },
    resultsTables: {
      metadata: {},
      tables: {},
    },
    crosstabRaw: {
      bannerCuts: [{ groupName: 'Demo', columns: [{ name: 'Male', adjusted: 'SEX == 1' }] }],
    },
    loopSummary: {
      totalLoopGroups: 0,
      totalIterationVars: 0,
      totalBaseVars: 0,
      groups: [],
    },
    r2Keys: {
      metadata: 'r2/meta',
      tableRouting: 'r2/table-routing',
      jobRoutingManifest: 'r2/job-routing',
      loopPolicy: 'r2/loop-policy',
      supportReport: 'r2/support',
      sortedFinal: 'r2/sorted-final',
      resultsTables: 'r2/results',
      crosstabRaw: 'r2/crosstab',
      loopSummary: 'r2/loop-summary',
    },
  };
}
