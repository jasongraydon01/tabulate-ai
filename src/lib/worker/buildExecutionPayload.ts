import path from 'path';

import { sanitizeDatasetName } from '@/lib/api/fileHandler';

import type { WorkerExecutionPayload, WorkerFileNames, WorkerInputRefs } from './types';
import type { WorkerPipelineContext } from './recovery';

export function buildWorkerPipelineContext(params: {
  dataFileName: string;
  pipelineId?: string;
}): WorkerPipelineContext {
  const datasetName = sanitizeDatasetName(params.dataFileName);
  const pipelineId = params.pipelineId
    ?? `pipeline-${new Date().toISOString().replace(/[:.]/g, '-')}`;

  return {
    pipelineId,
    datasetName,
    outputDir: path.join(process.cwd(), 'outputs', datasetName, pipelineId),
  };
}

export function normalizeWizardWorkerInputRefs(inputRefs: {
  dataMap: string | null;
  bannerPlan: string | null;
  spss: string;
  survey: string | null;
  messageList: string | null;
}): WorkerInputRefs {
  return {
    dataMap: inputRefs.dataMap,
    bannerPlan: inputRefs.bannerPlan,
    spss: inputRefs.spss,
    survey: inputRefs.survey,
    messageList: inputRefs.messageList,
  };
}

export function buildWorkerExecutionPayload(params: {
  sessionId: string;
  pipelineContext: WorkerPipelineContext;
  fileNames: WorkerFileNames;
  inputRefs: WorkerInputRefs;
  loopStatTestingMode?: 'suppress' | 'complement';
}): WorkerExecutionPayload {
  return {
    sessionId: params.sessionId,
    pipelineContext: params.pipelineContext,
    fileNames: params.fileNames,
    inputRefs: params.inputRefs,
    ...(params.loopStatTestingMode ? { loopStatTestingMode: params.loopStatTestingMode } : {}),
  };
}
