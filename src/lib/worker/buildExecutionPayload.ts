import type { WorkerExecutionPayload, WorkerFileNames, WorkerInputRefs } from './types';

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
