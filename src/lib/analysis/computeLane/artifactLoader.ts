import { downloadFile } from '@/lib/r2/r2';
import {
  BannerPlanArtifactSchema,
  CrosstabRawArtifactSchema,
} from '@/lib/exportData/inputArtifactSchemas';
import { parseRunResult } from '@/schemas/runResultSchema';
import type { BannerPlanInputType } from '@/schemas/bannerPlanSchema';
import type { ValidationResultType } from '@/schemas/agentOutputSchema';

const BANNER_PLAN_PATH = 'planning/20-banner-plan.json';
const CROSSTAB_PLAN_PATH = 'planning/21-crosstab-plan.json';
const QUESTION_ID_FINAL_PATH = 'enrichment/12-questionid-final.json';
const TABLE_ENRICHED_PATH = 'tables/13e-table-enriched.json';
const TABLE_CANONICAL_PATH = 'tables/13d-table-canonical.json';
const DATA_FILE_PATH = 'dataFile.sav';

async function downloadJson<T>(key: string): Promise<T> {
  const buffer = await downloadFile(key);
  return JSON.parse(buffer.toString('utf-8')) as T;
}

function requireOutputKey(outputs: Record<string, string>, relativePath: string): string {
  const key = outputs[relativePath];
  if (!key) {
    throw new Error(`Parent run is missing required artifact: ${relativePath}`);
  }
  return key;
}

export interface AnalysisParentRunArtifacts {
  outputs: Record<string, string>;
  parentPipelineId: string;
  parentDatasetName: string;
  bannerPlan: BannerPlanInputType;
  crosstabPlan: ValidationResultType;
  artifactKeys: {
    bannerPlan: string;
    crosstabPlan: string;
    questionIdFinal?: string;
    tableEnriched?: string;
    tableCanonical?: string;
    dataFileSav?: string;
  };
}

export async function loadAnalysisParentRunArtifacts(
  runResultValue: unknown,
): Promise<AnalysisParentRunArtifacts> {
  const runResult = parseRunResult(runResultValue);
  const outputs = runResult?.r2Files?.outputs ?? {};
  const bannerPlanKey = requireOutputKey(outputs, BANNER_PLAN_PATH);
  const crosstabPlanKey = requireOutputKey(outputs, CROSSTAB_PLAN_PATH);

  const [bannerPlanRaw, crosstabPlanRaw] = await Promise.all([
    downloadJson<unknown>(bannerPlanKey),
    downloadJson<unknown>(crosstabPlanKey),
  ]);

  return {
    outputs,
    parentPipelineId: runResult?.pipelineId ?? 'unknown-parent-pipeline',
    parentDatasetName: runResult?.dataset ?? 'analysis-extension',
    bannerPlan: BannerPlanArtifactSchema.parse(bannerPlanRaw),
    crosstabPlan: CrosstabRawArtifactSchema.parse(crosstabPlanRaw) as ValidationResultType,
    artifactKeys: {
      bannerPlan: bannerPlanKey,
      crosstabPlan: crosstabPlanKey,
      questionIdFinal: outputs[QUESTION_ID_FINAL_PATH],
      tableEnriched: outputs[TABLE_ENRICHED_PATH],
      tableCanonical: outputs[TABLE_CANONICAL_PATH],
      dataFileSav: outputs[DATA_FILE_PATH],
    },
  };
}

