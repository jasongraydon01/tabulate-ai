import type { ExtendedTableDefinition } from '@/schemas/verificationAgentSchema';

function deriveQuestionIdFromTableId(tableId: string): string {
  const base = tableId.split('_')[0] || tableId;
  return base.toUpperCase();
}

export function prefillMetadata(table: ExtendedTableDefinition): {
  table: ExtendedTableDefinition;
  flaggedForAI: string[];
} {
  const flaggedForAI: string[] = [];
  const questionId = table.questionId || deriveQuestionIdFromTableId(table.tableId);

  let surveySection = table.surveySection;
  if (!surveySection) {
    surveySection = /^S\d+/i.test(questionId) ? 'SCREENER' : 'MAIN';
  }

  if (!table.baseText) {
    flaggedForAI.push('missing_base_text');
  }

  if (!table.tableSubtitle && table.isDerived) {
    if (/_t2b$/i.test(table.tableId)) surveySection = surveySection || 'MAIN';
  }

  return {
    table: {
      ...table,
      questionId,
      surveySection,
      lastModifiedBy: 'TableEnhancer',
    },
    flaggedForAI,
  };
}
