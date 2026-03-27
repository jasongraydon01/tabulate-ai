import { promises as fs } from 'fs';
import path from 'path';

import { createSessionDir } from '@/lib/storage';
import type { SavedFilePaths } from '@/lib/api/types';
import { downloadFile } from '@/lib/r2/r2';

import type { WorkerExecutionPayload } from './types';

function buildSessionFilePath(sessionDir: string, baseName: string, sourceName: string | null): string | null {
  if (!sourceName) return null;
  const ext = path.extname(sourceName);
  return path.join(sessionDir, `${baseName}${ext}`);
}

export function buildHydratedSavedPaths(params: {
  sessionDir: string;
  payload: WorkerExecutionPayload;
}): SavedFilePaths {
  const { sessionDir, payload } = params;

  const spssPath = buildSessionFilePath(sessionDir, 'dataFile', payload.fileNames.dataFile);
  if (!spssPath) {
    throw new Error('Worker execution payload is missing the SPSS file name.');
  }

  const bannerPlanPath = buildSessionFilePath(sessionDir, 'bannerPlan', payload.fileNames.bannerPlan);
  const surveyPath = buildSessionFilePath(sessionDir, 'survey', payload.fileNames.survey);
  const messageListPath = buildSessionFilePath(sessionDir, 'messageList', payload.fileNames.messageList);
  const explicitDataMapPath = buildSessionFilePath(sessionDir, 'dataMap', payload.fileNames.dataMap);

  const dataMapPath = payload.inputRefs.dataMap ? (explicitDataMapPath ?? spssPath) : spssPath;

  return {
    dataMapPath,
    bannerPlanPath: bannerPlanPath ?? '',
    spssPath,
    surveyPath,
    messageListPath,
    r2Keys: {
      dataMap: payload.inputRefs.dataMap ?? payload.inputRefs.spss,
      bannerPlan: payload.inputRefs.bannerPlan ?? '',
      spss: payload.inputRefs.spss,
      survey: payload.inputRefs.survey,
    },
  };
}

export async function hydrateRunInputsToSession(
  payload: WorkerExecutionPayload,
): Promise<{ sessionDir: string; savedPaths: SavedFilePaths }> {
  const sessionDirResult = await createSessionDir(payload.sessionId);
  if (!sessionDirResult.success || !sessionDirResult.filePath) {
    throw new Error(sessionDirResult.error ?? 'Failed to create worker session directory.');
  }

  const sessionDir = sessionDirResult.filePath;
  const savedPaths = buildHydratedSavedPaths({ sessionDir, payload });

  const downloads: Array<Promise<void>> = [
    downloadFile(payload.inputRefs.spss).then((buffer) => fs.writeFile(savedPaths.spssPath, buffer)),
  ];

  if (payload.inputRefs.dataMap && payload.inputRefs.dataMap !== payload.inputRefs.spss) {
    downloads.push(
      downloadFile(payload.inputRefs.dataMap).then((buffer) => fs.writeFile(savedPaths.dataMapPath, buffer)),
    );
  }

  if (payload.inputRefs.bannerPlan && savedPaths.bannerPlanPath) {
    downloads.push(
      downloadFile(payload.inputRefs.bannerPlan).then((buffer) => fs.writeFile(savedPaths.bannerPlanPath, buffer)),
    );
  }

  if (payload.inputRefs.survey && savedPaths.surveyPath) {
    downloads.push(
      downloadFile(payload.inputRefs.survey).then((buffer) => fs.writeFile(savedPaths.surveyPath!, buffer)),
    );
  }

  if (payload.inputRefs.messageList && savedPaths.messageListPath) {
    downloads.push(
      downloadFile(payload.inputRefs.messageList).then((buffer) => fs.writeFile(savedPaths.messageListPath!, buffer)),
    );
  }

  await Promise.all(downloads);
  return { sessionDir, savedPaths };
}
