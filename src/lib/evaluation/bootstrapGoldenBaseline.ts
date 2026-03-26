import { promises as fs } from "fs";
import * as path from "path";

export interface BootstrapGoldenBaselineParams {
  runOutputDir: string;
  datasetKey: string;
  createdBy: string;
  notes?: string;
  version?: number;
}

export interface BootstrapGoldenBaselineResult {
  datasetKey: string;
  version: number;
  baselineDir: string;
  sourceRunId: string;
  artifactKeys: {
    banner: string;
    crosstab: string;
    verification: string;
    data: string;
    manifest: string;
  };
}

function sanitizeDatasetKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toRelativePosix(absPath: string): string {
  return path.relative(process.cwd(), absPath).split(path.sep).join("/");
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function nextBaselineVersion(goldenRoot: string): Promise<number> {
  if (!(await fileExists(goldenRoot))) return 1;
  const entries = await fs.readdir(goldenRoot, { withFileTypes: true });
  const versions = entries
    .filter((entry) => entry.isDirectory() && /^v\d+$/i.test(entry.name))
    .map((entry) => Number(entry.name.slice(1)))
    .filter((value) => Number.isFinite(value));
  if (versions.length === 0) return 1;
  return Math.max(...versions) + 1;
}

export async function bootstrapGoldenBaseline(
  params: BootstrapGoldenBaselineParams
): Promise<BootstrapGoldenBaselineResult> {
  const datasetKey = sanitizeDatasetKey(params.datasetKey);
  const runOutputDir = path.resolve(params.runOutputDir);
  const sourceRunId = path.basename(runOutputDir);

  const requiredActualFiles = {
    banner: path.join(runOutputDir, "banner", "banner-output-raw.json"),
    crosstab: path.join(runOutputDir, "crosstab", "crosstab-output-raw.json"),
    verification: path.join(runOutputDir, "verification", "verification-output-raw.json"),
    data: path.join(runOutputDir, "results", "data-streamlined.json"),
  };

  const missing: string[] = [];
  for (const [label, filePath] of Object.entries(requiredActualFiles)) {
    if (!(await fileExists(filePath))) missing.push(`${label}: ${filePath}`);
  }
  if (missing.length > 0) {
    throw new Error(`Missing required run artifacts for baseline bootstrap:\n${missing.join("\n")}`);
  }

  const goldenRoot = path.join(process.cwd(), "data", datasetKey, "golden-datasets");
  const version = params.version ?? (await nextBaselineVersion(goldenRoot));
  const baselineDir = path.join(goldenRoot, `v${version}`);
  await fs.mkdir(baselineDir, { recursive: true });

  const expectedFiles = {
    banner: path.join(baselineDir, "banner-expected.json"),
    crosstab: path.join(baselineDir, "crosstab-expected.json"),
    verification: path.join(baselineDir, "verification-expected.json"),
    data: path.join(baselineDir, "data-expected.json"),
  };

  await Promise.all([
    fs.copyFile(requiredActualFiles.banner, expectedFiles.banner),
    fs.copyFile(requiredActualFiles.crosstab, expectedFiles.crosstab),
    fs.copyFile(requiredActualFiles.verification, expectedFiles.verification),
    fs.copyFile(requiredActualFiles.data, expectedFiles.data),
  ]);

  const manifestPath = path.join(baselineDir, "baseline-manifest.json");
  const manifest = {
    datasetKey,
    version,
    sourceRunId,
    sourceOutputDir: toRelativePosix(runOutputDir),
    createdBy: params.createdBy,
    createdAt: new Date().toISOString(),
    notes: params.notes ?? "",
  };
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

  return {
    datasetKey,
    version,
    baselineDir,
    sourceRunId,
    artifactKeys: {
      banner: toRelativePosix(expectedFiles.banner),
      crosstab: toRelativePosix(expectedFiles.crosstab),
      verification: toRelativePosix(expectedFiles.verification),
      data: toRelativePosix(expectedFiles.data),
      manifest: toRelativePosix(manifestPath),
    },
  };
}
