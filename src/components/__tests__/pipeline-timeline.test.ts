import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  PipelineTimeline,
  getStepStatuses,
  getTimelineStepId,
} from '@/components/pipeline-timeline';

describe('pipeline timeline', () => {
  it('maps enrichment to the V3 question-enrichment step', () => {
    expect(getTimelineStepId('v3_enrichment', 'in_progress')).toBe('enrichment');

    const statuses = getStepStatuses('v3_enrichment', 'in_progress');

    expect(statuses.get('reading')).toBe('completed');
    expect(statuses.get('enrichment')).toBe('active');
    expect(statuses.get('planning')).toBe('pending');
    expect(statuses.get('output')).toBe('pending');
  });

  it('maps contract build to the output step', () => {
    expect(getTimelineStepId('contract_build', 'in_progress')).toBe('output');

    const statuses = getStepStatuses('contract_build', 'in_progress');

    expect(statuses.get('computing')).toBe('completed');
    expect(statuses.get('output')).toBe('active');
  });

  it('maps finalizing tables to the output step before contract build begins', () => {
    expect(getTimelineStepId('finalizing_tables', 'in_progress')).toBe('output');

    const statuses = getStepStatuses('finalizing_tables', 'in_progress');

    expect(statuses.get('computing')).toBe('completed');
    expect(statuses.get('output')).toBe('active');
  });

  it('shows review only when the run is in review flow', () => {
    const enrichmentMarkup = renderToStaticMarkup(
      React.createElement(PipelineTimeline, {
        stage: 'v3_enrichment',
        status: 'in_progress',
      }),
    );
    expect(enrichmentMarkup).toContain('Reading &amp; Validating Data');
    expect(enrichmentMarkup).toContain('Enriching Questions');
    expect(enrichmentMarkup).not.toContain('Review');

    const reviewMarkup = renderToStaticMarkup(
      React.createElement(PipelineTimeline, {
        stage: 'crosstab_review_required',
        status: 'pending_review',
      }),
    );
    expect(reviewMarkup).toContain('Review');
    expect(reviewMarkup).toContain('Applying reviewer decisions and loading the saved artifacts to continue.');
  });
});
