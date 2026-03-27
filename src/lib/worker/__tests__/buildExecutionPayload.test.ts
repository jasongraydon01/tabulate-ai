import { describe, expect, it } from 'vitest';

import { buildWorkerExecutionPayload, normalizeWizardWorkerInputRefs } from '@/lib/worker/buildExecutionPayload';

describe('buildWorkerExecutionPayload', () => {
  it('keeps dataMap null for wizard runs that only have a .sav input', () => {
    expect(normalizeWizardWorkerInputRefs({
      dataMap: null,
      bannerPlan: null,
      spss: 'org/project/runs/run-1/inputs/study.sav',
      survey: 'org/project/runs/run-1/inputs/survey.pdf',
      messageList: null,
    })).toEqual({
      dataMap: null,
      bannerPlan: null,
      spss: 'org/project/runs/run-1/inputs/study.sav',
      survey: 'org/project/runs/run-1/inputs/survey.pdf',
      messageList: null,
    });
  });

  it('preserves durable input refs and optional loop settings', () => {
    const payload = buildWorkerExecutionPayload({
      sessionId: 'session-123',
      fileNames: {
        dataMap: 'study.sav',
        bannerPlan: 'banner.docx',
        dataFile: 'study.sav',
        survey: 'survey.pdf',
        messageList: 'messages.xlsx',
      },
      inputRefs: {
        dataMap: 'org/project/runs/run-1/inputs/study.sav',
        bannerPlan: 'org/project/runs/run-1/inputs/banner.docx',
        spss: 'org/project/runs/run-1/inputs/study.sav',
        survey: 'org/project/runs/run-1/inputs/survey.pdf',
        messageList: 'org/project/runs/run-1/inputs/messages.xlsx',
      },
      loopStatTestingMode: 'suppress',
    });

    expect(payload).toEqual({
      sessionId: 'session-123',
      fileNames: {
        dataMap: 'study.sav',
        bannerPlan: 'banner.docx',
        dataFile: 'study.sav',
        survey: 'survey.pdf',
        messageList: 'messages.xlsx',
      },
      inputRefs: {
        dataMap: 'org/project/runs/run-1/inputs/study.sav',
        bannerPlan: 'org/project/runs/run-1/inputs/banner.docx',
        spss: 'org/project/runs/run-1/inputs/study.sav',
        survey: 'org/project/runs/run-1/inputs/survey.pdf',
        messageList: 'org/project/runs/run-1/inputs/messages.xlsx',
      },
      loopStatTestingMode: 'suppress',
    });
  });
});
