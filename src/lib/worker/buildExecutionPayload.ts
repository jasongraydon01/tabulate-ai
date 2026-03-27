import type { WorkerExecutionPayload, WorkerFileNames, WorkerInputRefs } from './types';

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
  fileNames: WorkerFileNames;
  inputRefs: WorkerInputRefs;
  loopStatTestingMode?: 'suppress' | 'complement';
}): WorkerExecutionPayload {
  return {
    sessionId: params.sessionId,
    fileNames: params.fileNames,
    inputRefs: params.inputRefs,
    ...(params.loopStatTestingMode ? { loopStatTestingMode: params.loopStatTestingMode } : {}),
  };
}
