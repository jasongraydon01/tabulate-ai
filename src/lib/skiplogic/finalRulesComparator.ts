import fs from 'fs/promises';

export type RuleType = 'table-level' | 'row-level' | 'column-level' | 'multi-level';

export interface FinalRule {
  questionId: string;
  chosenType: RuleType;
  chosenReason?: string;
  supportCount?: number;
  supportPct?: number;
  supportingRuns?: number[];
  rule?: {
    ruleId?: string;
    appliesTo?: string[];
    ruleType?: RuleType;
    plainTextRule?: string;
    conditionDescription?: string;
  } | null;
}

export interface FinalRulesPayload {
  config?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  rules: FinalRule[];
}

export interface RuleComparisonDetail {
  questionId: string;
  status: 'match' | 'missing-in-actual' | 'extra-in-actual' | 'type-mismatch' | 'condition-mismatch';
  expectedType?: RuleType;
  actualType?: RuleType;
  expectedCondition?: string;
  actualCondition?: string;
}

export interface FinalRulesComparisonReport {
  summary: {
    expectedQuestions: number;
    actualQuestions: number;
    intersectionQuestions: number;
    missingInActual: number;
    extraInActual: number;
    typeMatches: number;
    typeMismatches: number;
    conditionMatches: number;
    conditionMismatches: number;
    presencePrecision: number;
    presenceRecall: number;
    presenceF1: number;
    typeAccuracyOnIntersection: number;
    strictAccuracyOnIntersection: number;
  };
  details: RuleComparisonDetail[];
}

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function getCondition(rule: FinalRule | undefined): string {
  return rule?.rule?.conditionDescription?.trim() || '';
}

function conditionsMatch(expectedCondition: string, actualCondition: string): boolean {
  const e = normalizeText(expectedCondition);
  const a = normalizeText(actualCondition);

  if (!e || !a) return false;
  if (e === a) return true;

  // Relaxed containment fallback for minor wording differences.
  if (e.length >= 12 && a.includes(e)) return true;
  if (a.length >= 12 && e.includes(a)) return true;

  const eTokens = new Set(e.split(' ').filter((token) => token.length >= 3));
  const aTokens = new Set(a.split(' ').filter((token) => token.length >= 3));
  if (eTokens.size === 0 || aTokens.size === 0) return false;

  let intersection = 0;
  for (const token of eTokens) {
    if (aTokens.has(token)) intersection++;
  }
  const union = new Set<string>([...eTokens, ...aTokens]).size;
  const jaccard = union === 0 ? 0 : intersection / union;

  // Relaxed semantic match threshold for manually-authored expected conditions.
  if (jaccard >= 0.35) return true;

  return false;
}

function percentage(numerator: number, denominator: number): number {
  if (denominator === 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(2));
}

export function compareFinalRuleSets(
  expected: FinalRulesPayload,
  actual: FinalRulesPayload
): FinalRulesComparisonReport {
  const expectedMap = new Map<string, FinalRule>();
  const actualMap = new Map<string, FinalRule>();

  for (const rule of expected.rules || []) {
    expectedMap.set(rule.questionId, rule);
  }
  for (const rule of actual.rules || []) {
    actualMap.set(rule.questionId, rule);
  }

  const expectedQuestions = [...expectedMap.keys()].sort();
  const actualQuestions = [...actualMap.keys()].sort();
  const intersection = expectedQuestions.filter((questionId) => actualMap.has(questionId));

  const missingInActual = expectedQuestions.filter((questionId) => !actualMap.has(questionId));
  const extraInActual = actualQuestions.filter((questionId) => !expectedMap.has(questionId));

  let typeMatches = 0;
  let typeMismatches = 0;
  let conditionMatches = 0;
  let conditionMismatches = 0;

  const details: RuleComparisonDetail[] = [];

  for (const questionId of intersection) {
    const expectedRule = expectedMap.get(questionId)!;
    const actualRule = actualMap.get(questionId)!;

    const expectedType = expectedRule.chosenType;
    const actualType = actualRule.chosenType;

    if (expectedType === actualType) {
      typeMatches++;
    } else {
      typeMismatches++;
      details.push({
        questionId,
        status: 'type-mismatch',
        expectedType,
        actualType,
        expectedCondition: getCondition(expectedRule),
        actualCondition: getCondition(actualRule),
      });
      continue;
    }

    const expectedCondition = getCondition(expectedRule);
    const actualCondition = getCondition(actualRule);

    // If expected has no condition text, treat type match as strict match.
    if (!expectedCondition) {
      conditionMatches++;
      details.push({
        questionId,
        status: 'match',
        expectedType,
        actualType,
      });
      continue;
    }

    if (conditionsMatch(expectedCondition, actualCondition)) {
      conditionMatches++;
      details.push({
        questionId,
        status: 'match',
        expectedType,
        actualType,
      });
    } else {
      conditionMismatches++;
      details.push({
        questionId,
        status: 'condition-mismatch',
        expectedType,
        actualType,
        expectedCondition,
        actualCondition,
      });
    }
  }

  for (const questionId of missingInActual) {
    const expectedRule = expectedMap.get(questionId);
    details.push({
      questionId,
      status: 'missing-in-actual',
      expectedType: expectedRule?.chosenType,
      expectedCondition: getCondition(expectedRule),
    });
  }

  for (const questionId of extraInActual) {
    const actualRule = actualMap.get(questionId);
    details.push({
      questionId,
      status: 'extra-in-actual',
      actualType: actualRule?.chosenType,
      actualCondition: getCondition(actualRule),
    });
  }

  details.sort((a, b) => a.questionId.localeCompare(b.questionId));

  const presencePrecision = percentage(intersection.length, actualQuestions.length);
  const presenceRecall = percentage(intersection.length, expectedQuestions.length);
  const presenceF1 = (presencePrecision + presenceRecall === 0)
    ? 0
    : Number(((2 * presencePrecision * presenceRecall) / (presencePrecision + presenceRecall)).toFixed(2));
  const typeAccuracyOnIntersection = percentage(typeMatches, intersection.length);
  const strictAccuracyOnIntersection = percentage(conditionMatches, intersection.length);

  return {
    summary: {
      expectedQuestions: expectedQuestions.length,
      actualQuestions: actualQuestions.length,
      intersectionQuestions: intersection.length,
      missingInActual: missingInActual.length,
      extraInActual: extraInActual.length,
      typeMatches,
      typeMismatches,
      conditionMatches,
      conditionMismatches,
      presencePrecision,
      presenceRecall,
      presenceF1,
      typeAccuracyOnIntersection,
      strictAccuracyOnIntersection,
    },
    details,
  };
}

export async function loadFinalRulesPayload(filePath: string): Promise<FinalRulesPayload> {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw) as FinalRulesPayload;
  if (!parsed || !Array.isArray(parsed.rules)) {
    throw new Error(`Invalid final-rules payload: ${filePath}`);
  }
  return parsed;
}
