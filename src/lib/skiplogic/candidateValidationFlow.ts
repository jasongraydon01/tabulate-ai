import { generateText, Output, stepCountIs } from 'ai';
import { z } from 'zod';
import {
  getGenerationSamplingParams,
  getSkipLogicModel,
  getSkipLogicModelName,
  getSkipLogicModelTokenLimit,
  getSkipLogicReasoningEffort,
} from '../env';
import { RESEARCH_DATA_PREAMBLE, sanitizeForAzureContentFilter } from '../promptSanitization';
import { retryWithPolicyHandling } from '../retryWithPolicyHandling';
import { recordAgentMetrics } from '../observability';
import {
  getSkipLogicCandidateValidatorPrompt,
  getSkipLogicMissingSweepPrompt,
} from '../../prompts/skiplogic/candidateValidator';
import type { CandidateDimension, SkipLogicCandidate } from './CandidateExtractor';

export type RuleType = 'table-level' | 'row-level' | 'column-level' | 'multi-level';

export interface CanonicalCandidateRule {
  ruleId: string;
  appliesTo: string[];
  ruleType: RuleType;
  plainTextRule: string;
  conditionDescription: string;
  translationContext: string;
}

export interface ValidatedCandidateDecision {
  candidateId: string;
  questionId: string;
  decision: 'pass' | 'reject' | 'update';
  reason: string;
  confidence: number;
  inferredDimension: CandidateDimension;
  canonicalRule: CanonicalCandidateRule;
}

export interface MissingSweepProposal {
  questionId: string;
  inferredDimension: CandidateDimension;
  rationale: string;
  evidenceSnippet: string;
}

const RuleTypeSchema = z.enum(['table-level', 'row-level', 'column-level', 'multi-level']);

const CandidateValidationOutputSchema = z.object({
  decision: z.enum(['pass', 'reject', 'update']),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  canonicalRule: z.object({
    questionId: z.string(),
    ruleType: RuleTypeSchema,
    plainTextRule: z.string(),
    conditionDescription: z.string(),
    translationContext: z.string(),
  }),
});

const MissingSweepOutputSchema = z.object({
  proposals: z.array(
    z.object({
      questionId: z.string(),
      inferredDimension: z.enum(['table', 'row', 'column', 'unknown']),
      rationale: z.string(),
      evidenceSnippet: z.string(),
    })
  ),
});

function mapDimensionToRuleType(dimension: CandidateDimension): RuleType {
  switch (dimension) {
    case 'row':
      return 'row-level';
    case 'column':
      return 'column-level';
    case 'table':
    case 'unknown':
    default:
      return 'table-level';
  }
}

function normalizeQuestionId(value: string, fallback: string): string {
  const normalized = value.replace(/[^A-Za-z0-9]/g, '').trim();
  return normalized || fallback;
}

function buildFallbackRule(candidate: SkipLogicCandidate): CanonicalCandidateRule {
  const snippet = candidate.evidence[0]?.snippet || `Candidate for ${candidate.questionId}`;
  const fallbackType = mapDimensionToRuleType(candidate.inferredDimension);

  return {
    ruleId: `candidate_${candidate.questionId.toLowerCase()}`,
    appliesTo: [candidate.questionId],
    ruleType: fallbackType,
    plainTextRule: `Apply gating for ${candidate.questionId} based on extracted survey instruction.`,
    conditionDescription: snippet,
    translationContext: '',
  };
}

function normalizeCanonicalRule(
  rule: z.infer<typeof CandidateValidationOutputSchema>['canonicalRule'],
  candidate: SkipLogicCandidate,
  runLabel: string
): CanonicalCandidateRule {
  const questionId = normalizeQuestionId(rule.questionId, candidate.questionId);

  return {
    ruleId: `candidate_${questionId.toLowerCase()}_${runLabel.toLowerCase().replace(/[^a-z0-9]/g, '-')}`,
    appliesTo: [questionId],
    ruleType: rule.ruleType,
    plainTextRule: rule.plainTextRule.trim() || `Apply gating for ${questionId}.`,
    conditionDescription: rule.conditionDescription.trim() || (candidate.evidence[0]?.snippet || ''),
    translationContext: rule.translationContext.trim(),
  };
}

export async function validateSkipLogicCandidate(args: {
  candidate: SkipLogicCandidate;
  promptVersion?: string;
  runLabel: string;
  abortSignal?: AbortSignal;
}): Promise<ValidatedCandidateDecision> {
  const { candidate, promptVersion, runLabel, abortSignal } = args;
  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${getSkipLogicCandidateValidatorPrompt(promptVersion)}`;

  const candidatePayload = {
    candidateId: candidate.candidateId,
    questionId: candidate.questionId,
    inferredDimension: candidate.inferredDimension,
    sourceTags: candidate.sourceTags,
    evidence: candidate.evidence.map((ev) => ({
      lineNumber: ev.lineNumber,
      snippet: ev.snippet,
    })),
  };

  const userPrompt = `
Validate this skip-logic candidate.

<candidate>
${sanitizeForAzureContentFilter(JSON.stringify(candidatePayload, null, 2))}
</candidate>

<local-context>
${sanitizeForAzureContentFilter(candidate.contextBlock)}
</local-context>

Return pass/reject/update and canonicalRule for this question only.
`;

  const retryResult = await retryWithPolicyHandling(
    async () => {
      const modelCallStart = Date.now();
      const { output, usage } = await generateText({
        model: getSkipLogicModel(),
        system: systemPrompt,
        maxRetries: 0,
        prompt: userPrompt,
        stopWhen: stepCountIs(8),
        maxOutputTokens: Math.min(getSkipLogicModelTokenLimit(), 8000),
        ...getGenerationSamplingParams(getSkipLogicModelName()),
        providerOptions: {
          openai: {
            reasoningEffort: getSkipLogicReasoningEffort(),
          },
        },
        output: Output.object({ schema: CandidateValidationOutputSchema }),
        abortSignal,
      });

      const durationMs = Date.now() - modelCallStart;
      recordAgentMetrics(
        'SkipLogicCandidateValidatorAgent',
        getSkipLogicModelName(),
        { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
        durationMs
      );

      return output;
    },
    {
      abortSignal,
      maxAttempts: 6,
      onRetry: (attempt, err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        console.warn(
          `[SkipLogicCandidateValidator:${runLabel}] Retry ${attempt}/6: ${err.message.substring(0, 140)}`
        );
      },
    }
  );

  if (!retryResult.success || !retryResult.result) {
    throw new Error(`Candidate validation failed for ${candidate.questionId}: ${retryResult.error || 'Unknown error'}`);
  }

  const modelOutput = retryResult.result;
  const canonicalRule = normalizeCanonicalRule(modelOutput.canonicalRule, candidate, runLabel);

  return {
    candidateId: candidate.candidateId,
    questionId: candidate.questionId,
    decision: modelOutput.decision,
    reason: modelOutput.reason,
    confidence: modelOutput.confidence,
    inferredDimension: candidate.inferredDimension,
    canonicalRule: modelOutput.decision === 'reject' ? buildFallbackRule(candidate) : canonicalRule,
  };
}

export async function runMissingRuleSweep(args: {
  surveyOutline: string;
  validatedRules: CanonicalCandidateRule[];
  existingQuestionIds: string[];
  surveyQuestionIds: string[];
  promptVersion?: string;
  runLabel: string;
  abortSignal?: AbortSignal;
}): Promise<MissingSweepProposal[]> {
  const systemPrompt = `${RESEARCH_DATA_PREAMBLE}${getSkipLogicMissingSweepPrompt(args.promptVersion)}`;

  const userPrompt = `
Find missing skip-logic candidates.

<survey-outline>
${sanitizeForAzureContentFilter(args.surveyOutline)}
</survey-outline>

<already-covered-question-ids>
${sanitizeForAzureContentFilter(JSON.stringify(args.existingQuestionIds.sort(), null, 2))}
</already-covered-question-ids>

<validated-rules>
${sanitizeForAzureContentFilter(
  JSON.stringify(
    args.validatedRules.map((rule) => ({
      questionId: rule.appliesTo[0] || '',
      ruleType: rule.ruleType,
      conditionDescription: rule.conditionDescription,
    })),
    null,
    2
  )
)}
</validated-rules>

Return only genuinely missing question IDs.
`;

  const retryResult = await retryWithPolicyHandling(
    async () => {
      const modelCallStart = Date.now();
      const { output, usage } = await generateText({
        model: getSkipLogicModel(),
        system: systemPrompt,
        maxRetries: 0,
        prompt: userPrompt,
        stopWhen: stepCountIs(10),
        maxOutputTokens: Math.min(getSkipLogicModelTokenLimit(), 12000),
        ...getGenerationSamplingParams(getSkipLogicModelName()),
        providerOptions: {
          openai: {
            reasoningEffort: getSkipLogicReasoningEffort(),
          },
        },
        output: Output.object({ schema: MissingSweepOutputSchema }),
        abortSignal: args.abortSignal,
      });

      const durationMs = Date.now() - modelCallStart;
      recordAgentMetrics(
        'SkipLogicMissingSweepAgent',
        getSkipLogicModelName(),
        { input: usage?.inputTokens || 0, output: usage?.outputTokens || 0 },
        durationMs
      );

      return output;
    },
    {
      abortSignal: args.abortSignal,
      maxAttempts: 5,
      onRetry: (attempt, err) => {
        if (err instanceof DOMException && err.name === 'AbortError') {
          throw err;
        }
        console.warn(
          `[SkipLogicMissingSweep:${args.runLabel}] Retry ${attempt}/5: ${err.message.substring(0, 140)}`
        );
      },
    }
  );

  if (!retryResult.success || !retryResult.result) {
    throw new Error(`Missing rule sweep failed: ${retryResult.error || 'Unknown error'}`);
  }

  const existing = new Set(args.existingQuestionIds.map((q) => normalizeQuestionId(q, q)));
  const surveySet = new Set(args.surveyQuestionIds.map((q) => normalizeQuestionId(q, q)));
  const seen = new Set<string>();

  const filtered: MissingSweepProposal[] = [];
  for (const proposal of retryResult.result.proposals) {
    const questionId = normalizeQuestionId(proposal.questionId, '');
    if (!questionId) continue;
    if (!surveySet.has(questionId)) continue;
    if (existing.has(questionId)) continue;
    if (seen.has(questionId)) continue;

    seen.add(questionId);
    filtered.push({
      questionId,
      inferredDimension: proposal.inferredDimension,
      rationale: proposal.rationale,
      evidenceSnippet: proposal.evidenceSnippet,
    });
  }

  return filtered.sort((a, b) => a.questionId.localeCompare(b.questionId));
}
