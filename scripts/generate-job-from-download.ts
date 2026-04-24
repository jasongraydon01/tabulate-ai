/**
 * Generate a WinCross .job file from a locally downloaded R2 run.
 *
 * Usage:
 *   npx tsx scripts/generate-job-from-download.ts <download-dir> [--bypass-base-validation]
 *
 * Example:
 *   npx tsx scripts/generate-job-from-download.ts outputs/_r2-downloads/jx799t3mt3xvtwtsnbvkdm8wjx8425ce --bypass-base-validation
 *
 * The --bypass-base-validation flag strips legacy base-disclosure phrases from
 * userNote fields so the serializer's base-contract check passes. This is a
 * debugging aid — it does NOT fix the upstream issue. The production codebase
 * is unchanged.
 */

import '../src/lib/loadEnv';

import { promises as fs } from 'fs';
import path from 'path';

import {
  ExportManifestMetadataSchema,
  ExportSupportReportSchema,
  JobRoutingManifestSchema,
  TableRoutingArtifactSchema,
} from '@/lib/exportData/types';
import {
  CrosstabRawArtifactSchema,
  LoopSummaryArtifactSchema,
  ResultsTablesFinalContractSchema,
  SortedFinalArtifactSchema,
} from '@/lib/exportData/inputArtifactSchemas';
import { LoopSemanticsPolicySchema } from '@/schemas/loopSemanticsPolicySchema';
import { serializeWinCrossJob } from '@/lib/exportData/wincross/serializer';
import { resolveWinCrossPreference } from '@/lib/exportData/wincross/preferenceResolver';
import type { WinCrossResolvedArtifacts } from '@/lib/exportData/wincross/types';

const LEGACY_DISCLOSURE_PATTERN = /(base varies|rebased|qualified respondents|substantive|\(n\s*varies\))/gi;

async function readJson(filePath: string): Promise<unknown> {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

function parseArgs(argv: string[]): { downloadDir: string; bypassBaseValidation: boolean } {
  let bypassBaseValidation = false;
  const positional: string[] = [];

  for (const arg of argv) {
    if (arg === '--bypass-base-validation') {
      bypassBaseValidation = true;
    } else {
      positional.push(arg);
    }
  }

  const downloadDir = positional[0];
  if (!downloadDir) {
    console.error(
      'Usage: npx tsx scripts/generate-job-from-download.ts <download-dir> [--bypass-base-validation]',
    );
    process.exit(1);
  }

  return { downloadDir: path.resolve(downloadDir), bypassBaseValidation };
}

function stripLegacyDisclosureFromUserNotes(sortedFinal: Record<string, unknown>): void {
  const tables = (sortedFinal as { tables: Array<Record<string, unknown>> }).tables;
  let stripped = 0;
  for (const table of tables) {
    if (typeof table.userNote === 'string' && LEGACY_DISCLOSURE_PATTERN.test(table.userNote)) {
      // Reset lastIndex since we use /g flag
      LEGACY_DISCLOSURE_PATTERN.lastIndex = 0;
      table.userNote = table.userNote.replace(LEGACY_DISCLOSURE_PATTERN, '[removed]').trim();
      stripped++;
    }
  }
  if (stripped > 0) {
    console.log(`[bypass] Stripped legacy disclosure text from ${stripped} table userNote(s)`);
  }
}

async function main(): Promise<void> {
  const { downloadDir, bypassBaseValidation } = parseArgs(process.argv.slice(2));

  console.log(`[job-gen] Loading artifacts from ${downloadDir}`);

  // Load export metadata to find artifact paths
  const metadata = ExportManifestMetadataSchema.parse(
    await readJson(path.join(downloadDir, 'export/export-metadata.json')),
  );

  const inputPaths = metadata.artifactPaths.inputs;
  const outputPaths = metadata.artifactPaths.outputs;

  // Load all artifacts from local disk
  const sortedFinalRaw = await readJson(path.join(downloadDir, inputPaths.sortedFinal));

  if (bypassBaseValidation) {
    stripLegacyDisclosureFromUserNotes(sortedFinalRaw as Record<string, unknown>);
  }

  const [
    sortedFinal,
    resultsTables,
    crosstabRaw,
    loopSummary,
    tableRouting,
    jobRoutingManifest,
    supportReport,
  ] = await Promise.all([
    Promise.resolve(SortedFinalArtifactSchema.parse(sortedFinalRaw)),
    readJson(path.join(downloadDir, inputPaths.resultsTables)).then(v => ResultsTablesFinalContractSchema.parse(v)),
    readJson(path.join(downloadDir, inputPaths.crosstabRaw)).then(v => CrosstabRawArtifactSchema.parse(v)),
    readJson(path.join(downloadDir, inputPaths.loopSummary)).then(v => LoopSummaryArtifactSchema.parse(v)),
    readJson(path.join(downloadDir, outputPaths.tableRouting)).then(v => TableRoutingArtifactSchema.parse(v)),
    readJson(path.join(downloadDir, outputPaths.jobRoutingManifest)).then(v => JobRoutingManifestSchema.parse(v)),
    readJson(path.join(downloadDir, outputPaths.supportReport ?? 'export/support-report.json')).then(v => ExportSupportReportSchema.parse(v)),
  ]);

  const loopPolicyRaw = await readJson(path.join(downloadDir, outputPaths.loopPolicy));
  const loopPolicyResult = LoopSemanticsPolicySchema.safeParse(loopPolicyRaw);

  const artifacts: WinCrossResolvedArtifacts = {
    metadata,
    tableRouting,
    jobRoutingManifest,
    loopPolicy: loopPolicyResult.success ? loopPolicyResult.data : null,
    supportReport,
    sortedFinal,
    resultsTables,
    crosstabRaw,
    loopSummary,
    r2Keys: {
      metadata: '',
      tableRouting: '',
      jobRoutingManifest: '',
      loopPolicy: '',
      supportReport: '',
      sortedFinal: '',
      resultsTables: '',
      crosstabRaw: '',
      loopSummary: '',
    },
  };

  // Use default profile for generation
  const resolvedPreference = resolveWinCrossPreference({ kind: 'default' });

  console.log(`[job-gen] Serializing .job (${sortedFinal.tables.length} tables)...`);

  const serialized = serializeWinCrossJob(artifacts, resolvedPreference.profile, {
    tableRouting,
    jobRouting: jobRoutingManifest,
  });

  const outputPath = path.join(downloadDir, 'export.job');
  await fs.writeFile(outputPath, serialized.content);

  console.log(`[job-gen] Done: ${outputPath}`);
  console.log(`  Tables: ${serialized.tableCount}, USE: ${serialized.useCount}, AF: ${serialized.afCount}, Blocked: ${serialized.blockedCount}`);
  if (serialized.warnings.length > 0) {
    console.log(`  Warnings (${serialized.warnings.length}):`);
    for (const w of serialized.warnings.slice(0, 10)) {
      console.log(`    - ${w}`);
    }
    if (serialized.warnings.length > 10) {
      console.log(`    ... and ${serialized.warnings.length - 10} more`);
    }
  }
}

main().catch((err) => {
  console.error('[job-gen] Fatal:', err);
  process.exit(1);
});
