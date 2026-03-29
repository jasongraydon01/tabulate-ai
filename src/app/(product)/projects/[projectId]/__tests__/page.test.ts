import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react');
  return {
    ...actual,
    default: actual,
    use: <T,>(value: T) => value,
  };
});

const mocks = vi.hoisted(() => ({
  useQuery: vi.fn(),
  push: vi.fn(),
}));

vi.mock('convex/react', () => ({
  useQuery: mocks.useQuery,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('posthog-js', () => ({
  default: { capture: vi.fn() },
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/providers/auth-provider', () => ({
  useAuthContext: () => ({ role: 'admin', convexOrgId: 'org-1' }),
}));

vi.mock('@/components/app-breadcrumbs', () => ({
  AppBreadcrumbs: ({ segments }: { segments: Array<{ label: string }> }) => (
    React.createElement('nav', null, segments.map((segment) => segment.label).join(' / '))
  ),
}));

vi.mock('@/components/pipeline-timeline', () => ({
  PipelineTimeline: () => React.createElement('div', null, 'pipeline timeline'),
}));

vi.mock('@/components/ReviewVerification', () => ({
  ReviewVerification: () => React.createElement('div', null, 'review verification'),
}));

vi.mock('@/components/confirm-destructive-dialog', () => ({
  ConfirmDestructiveDialog: () => null,
}));

describe('project detail page', () => {
  let Page: typeof import('@/app/(product)/projects/[projectId]/page').default;

  beforeEach(async () => {
    if (!Page) {
      ({ default: Page } = await import('@/app/(product)/projects/[projectId]/page'));
    }
    vi.clearAllMocks();

    const project = {
      _id: 'project-1',
      _creationTime: Date.UTC(2026, 2, 20),
      name: 'Test Project',
      intake: {
        dataFile: 'test-data.sav',
        survey: 'test-survey.docx',
        bannerPlan: null,
        messageList: 'messages.xlsx',
      },
      config: {
        studyMethodology: 'message_testing',
        analysisMethod: 'standard_crosstab',
        isWaveStudy: true,
        bannerMode: 'auto_generate',
        displayMode: 'frequency',
        theme: 'classic',
        statTesting: { thresholds: [90], minBase: 30 },
        exportFormats: ['excel', 'q', 'wincross'],
        weightVariable: 'weight_hcp',
        loopStatTestingMode: 'complement',
        wincrossProfileId: 'profile-01',
      },
    };
    const runs = [
      {
        _id: 'run-1',
        _creationTime: Date.UTC(2026, 2, 20),
        status: 'success',
        result: {
          summary: {
            tables: 12,
            cuts: 6,
            bannerGroups: 2,
            durationMs: 120000,
          },
          pipelineDecisions: {
            enrichment: {
              totalQuestions: 52,
              loopsDetected: 2,
              aiTriageRequired: 5,
              aiValidationPassed: 4,
              messageCodesMatched: 8,
            },
            tables: {
              canonicalTablesPlanned: 18,
              finalTableCount: 12,
              netsAdded: 3,
              tablesExcluded: 1,
            },
            banners: {
              source: 'auto_generated',
              bannerGroupCount: 2,
              totalCuts: 6,
              flaggedForReview: 0,
            },
            weights: {
              detected: true,
              variableUsed: 'weight_hcp',
              candidateCount: 2,
            },
            errors: {
              total: 0,
              recovered: 0,
              warnings: 0,
            },
            timing: {
              enrichmentMs: 12000,
              tableGenerationMs: 15000,
              computeMs: 9000,
              excelMs: 4000,
              totalMs: 120000,
            },
            studyFlags: {
              isDemandSurvey: false,
              hasChoiceModelExercise: null,
              hasMaxDiff: false,
            },
          },
          decisionsSummary: 'Processed 52 questions and generated 12 final tables.',
          r2Files: {
            outputs: {
              'results/crosstabs.xlsx': 'org/project/run/results/crosstabs.xlsx',
            },
          },
          exportReadiness: {
            reexport: {
              ready: true,
              reasonCodes: ['ready'],
            },
          },
          exportPackages: {
            q: {
              packageId: 'q-pkg-1',
              generatedAt: '2026-03-20T12:00:00.000Z',
              primaryDownloadPath: 'q/setup-project.QScript',
              blockedCount: 0,
              warningCount: 1,
              supportSummary: { supported: 12, warning: 1, blocked: 0 },
              files: {
                'q/setup-project.QScript': 'org/project/run/exports/q/setup-project.QScript',
                'q/q-export-manifest.json': 'org/project/run/exports/q/q-export-manifest.json',
              },
            },
            wincross: {
              packageId: 'wc-pkg-1',
              generatedAt: '2026-03-20T12:00:00.000Z',
              archivePath: 'wincross/export.zip',
              entrypointPath: 'wincross/export.job',
              blockedCount: 2,
              warningCount: 1,
              supportSummary: { supported: 10, warning: 1, blocked: 2 },
              parseDiagnostics: {
                warnings: ['Normalized one title row'],
                errors: [],
                encoding: 'utf16le',
                sectionNames: ['JOB', 'BANNER'],
              },
              files: {
                'wincross/export.zip': 'org/project/run/exports/wincross/export.zip',
                'wincross/export.job': 'org/project/run/exports/wincross/export.job',
              },
            },
          },
        },
      },
    ];

    let queryCall = 0;
    mocks.useQuery.mockImplementation(() => {
      queryCall += 1;
      if (queryCall === 1) return project;
      if (queryCall === 2) return runs;
      return [];
    });
  });

  it('does not render the legacy Review Tables card for completed runs', () => {
    const markup = renderToStaticMarkup(
      React.createElement(Page, {
        params: { projectId: 'project-1' } as never,
      }),
    );

    // Core page sections
    expect(markup).toContain('Downloads');
    // Pipeline Decisions and Table Labels are hidden pending UX redesign
    expect(markup).not.toContain('Pipeline Decisions');
    expect(markup).not.toContain('Table Labels');
    // Export format cards
    expect(markup).toContain('Q Export');
    expect(markup).toContain('WinCross Export');
    expect(markup).toContain('Download QScript');
    expect(markup).toContain('Download ZIP');
    // Configuration section
    expect(markup).toContain('Configuration');
    expect(markup).toContain('Project');
    expect(markup).toContain('Files');
    expect(markup).toContain('Analysis');
    expect(markup).toContain('Export');
    expect(markup).toContain('Wave Study');
    expect(markup).toContain('Auto-generated');
    expect(markup).toContain('test-data.sav');
    expect(markup).toContain('test-survey.docx');
    expect(markup).toContain('messages.xlsx');
    expect(markup).toContain('Complement');
    expect(markup).toContain('profile-01');
    // Legacy card must not be present
    expect(markup).not.toContain('Review Tables');
  });

  it('renders the expired-artifacts state when the latest run is expired', () => {
    const project = {
      _id: 'project-1',
      _creationTime: Date.UTC(2026, 2, 20),
      name: 'Test Project',
      intake: {
        dataFile: 'test-data.sav',
        survey: 'test-survey.docx',
        bannerPlan: null,
        messageList: null,
      },
      config: {
        exportFormats: ['excel'],
      },
    };
    const runs = [
      {
        _id: 'run-1',
        _creationTime: Date.UTC(2026, 2, 20),
        status: 'success',
        expiredAt: Date.UTC(2026, 3, 20),
        result: {
          r2Files: {
            outputs: {
              'results/crosstabs.xlsx': 'org/project/run/results/crosstabs.xlsx',
            },
          },
        },
      },
    ];

    let queryCall = 0;
    mocks.useQuery.mockReset();
    mocks.useQuery.mockImplementation(() => {
      queryCall += 1;
      if (queryCall === 1) return project;
      if (queryCall === 2) return runs;
      return [];
    });

    const markup = renderToStaticMarkup(
      React.createElement(Page, {
        params: { projectId: 'project-1' } as never,
      }),
    );

    expect(markup).toContain('Artifacts expired');
    expect(markup).toContain('30-day retention period');
  });
});
