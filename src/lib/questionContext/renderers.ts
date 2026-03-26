/**
 * Prompt renderers for question-centric data structures.
 *
 * - renderQuestionContextForCrosstab: XML format for CrosstabAgent system prompt
 * - renderBannerContext: pipe-delimited text for BannerGenerateAgent user prompt
 *
 * Promoted from scripts/v3-enrichment/lib/question-context-renderer.ts.
 */

import { sanitizeForAzureContentFilter } from '../promptSanitization';
import type { QuestionContext, BannerQuestionSummary } from '@/schemas/questionContextSchema';

// ---------------------------------------------------------------------------
// CrosstabAgent — question-grouped XML
// ---------------------------------------------------------------------------

/**
 * Render QuestionContext[] as XML for the CrosstabAgent system prompt.
 */
export function renderQuestionContextForCrosstab(questions: QuestionContext[]): string {
  const totalVars = questions.reduce((sum, q) => sum + q.items.length, 0);
  const lines: string[] = [];

  lines.push(`<questions count="${questions.length}" variables="${totalVars}">`);

  for (const q of questions) {
    lines.push(renderQuestion(q));
  }

  lines.push('</questions>');
  return lines.join('\n');
}

function renderQuestion(q: QuestionContext): string {
  const attrs: string[] = [];
  attrs.push(`id="${escapeAttr(q.questionId)}"`);
  attrs.push(`type="${escapeAttr(q.normalizedType)}"`);

  if (q.analyticalSubtype) {
    attrs.push(`subtype="${escapeAttr(q.analyticalSubtype)}"`);
  }

  attrs.push(`items="${q.items.length}"`);

  if (q.isHidden) {
    attrs.push('hidden="true"');
    if (q.hiddenLink) {
      attrs.push(`linkedTo="${escapeAttr(q.hiddenLink.linkedTo)}"`);
    }
  }

  if (q.loop) {
    attrs.push(`loop-family="${escapeAttr(q.loop.familyBase)}"`);
    attrs.push(`loop-iter="${q.loop.iterationIndex}"`);
    attrs.push(`loop-count="${q.loop.iterationCount}"`);
  }

  if (q.baseSummary) {
    if (q.baseSummary.situation) {
      attrs.push(`base-situation="${escapeAttr(q.baseSummary.situation)}"`);
    }
    if (q.baseSummary.questionBase !== null && q.baseSummary.questionBase !== undefined) {
      attrs.push(`base-n="${q.baseSummary.questionBase}"`);
    }
    if (q.baseSummary.totalN !== null && q.baseSummary.totalN !== undefined) {
      attrs.push(`total-n="${q.baseSummary.totalN}"`);
    }
    if (q.baseSummary.signals.length > 0) {
      attrs.push(`base-signals="${escapeAttr(q.baseSummary.signals.join(','))}"`);
    }
  }

  const parts: string[] = [];
  parts.push(`  <question ${attrs.join(' ')}>`);

  const text = sanitizeForAzureContentFilter(q.questionText);
  parts.push(`    ${text}`);

  const allValueLabels = collectValueLabels(q);

  if (q.items.length === 1 && allValueLabels.length > 0) {
    parts.push(`    <values>${packValues(allValueLabels)}</values>`);
  } else if (q.items.length > 1) {
    parts.push('    <items>');
    for (const item of q.items) {
      const label = sanitizeForAzureContentFilter(item.label);
      parts.push(`      <item col="${escapeAttr(item.column)}">${label}</item>`);
    }
    parts.push('    </items>');

    if (allValueLabels.length > 0) {
      parts.push(`    <values>${packValues(allValueLabels)}</values>`);
    }
  } else if (allValueLabels.length > 0) {
    parts.push(`    <values>${packValues(allValueLabels)}</values>`);
  }

  parts.push('  </question>');
  return parts.join('\n');
}

function collectValueLabels(
  q: QuestionContext,
): Array<{ value: string | number; label: string }> {
  for (const item of q.items) {
    if (item.valueLabels.length > 0) {
      return item.valueLabels;
    }
  }

  if (q.normalizedType === 'binary_flag') {
    return [
      { value: 0, label: 'Unchecked' },
      { value: 1, label: 'Checked' },
    ];
  }

  return [];
}

function packValues(valueLabels: Array<{ value: string | number; label: string }>): string {
  return valueLabels
    .slice(0, 80)
    .map((vl) => `${vl.value}=${vl.label}`)
    .join(',');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// BannerGenerateAgent — pipe-delimited text
// ---------------------------------------------------------------------------

/**
 * Render BannerQuestionSummary[] as pipe-delimited lines for the
 * BannerGenerateAgent user prompt.
 */
export function renderBannerContext(summaries: BannerQuestionSummary[]): string {
  const lines: string[] = [];

  for (const s of summaries) {
    lines.push(renderBannerLine(s));
  }

  return lines.join('\n');
}

function renderBannerLine(s: BannerQuestionSummary): string {
  const text = truncate(s.questionText, 80);

  const typeParts: string[] = [s.normalizedType];
  if (s.analyticalSubtype) typeParts.push(s.analyticalSubtype);
  if (s.isHidden && s.hiddenLinkedTo) typeParts.push(`hidden\u2192${s.hiddenLinkedTo}`);
  else if (s.isHidden) typeParts.push('hidden');
  if (s.loopIterationCount !== null && s.loopIterationCount > 0) {
    typeParts.push(`loop:${s.loopIterationCount}`);
  }
  const typeStr = `[${typeParts.join(', ')}]`;

  let detail: string;
  if (s.valueLabels.length > 0 && s.itemCount <= 1) {
    const options = s.valueLabels
      .slice(0, 15)
      .map((vl) => `${vl.value}=${vl.label}`)
      .join(', ');
    const suffix = s.valueLabels.length > 15 ? ` (+${s.valueLabels.length - 15} more)` : '';
    detail = `Options: ${options}${suffix}`;
  } else if (s.itemCount > 1) {
    const labels = s.itemLabels.slice(0, 10).map((il) => il.label);
    const suffix = s.itemCount > 10 ? ` (+${s.itemCount - 10} more)` : '';
    detail = `${s.itemCount} items: ${labels.join(', ')}${suffix}`;
    if (s.valueLabels.length > 0) {
      const options = s.valueLabels
        .slice(0, 10)
        .map((vl) => `${vl.value}=${vl.label}`)
        .join(', ');
      const optSuffix = s.valueLabels.length > 10 ? ` (+${s.valueLabels.length - 10} more)` : '';
      detail += ` | Options: ${options}${optSuffix}`;
    }
  } else {
    detail = `1 item: ${s.itemLabels[0]?.label ?? s.questionId}`;
  }

  return `${s.questionId} | ${text} ${typeStr} | ${detail}`;
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}
