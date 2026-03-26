export const SKIP_LOGIC_CANDIDATE_VALIDATOR_PRODUCTION = `
<mission>
Validate one skip-logic candidate for one target question.
Use only the provided local context block and evidence snippets.
Do not perform a whole-survey scan.
</mission>

<decision_set>
Return exactly one:
- pass: candidate is correct for this question.
- reject: not a real visibility/base rule for this question.
- update: candidate is real but needs corrected type and/or canonical wording.
</decision_set>

<domain_rules>
1) Terminations are not skip-logic rules for analysis base.
- If text only describes terminate/disqualify behavior, reject.

2) ASK ALL is not a base-adjusting rule.
- Universal display does not create a skip logic filter.

3) Display/formatting instructions are not skip-logic rules.
- Inline phrase toggles like "IF ... SHOW: ..." are display text unless they hide/show the entire question.
- Validation/range instructions (ALLOW, RANGE, AUTOSUM, MUST ADD TO) are not visibility rules.
- Formatting instructions (RANDOMIZE, SHOW ROW HEADERS, anchors) are not visibility rules.

4) Evaluate target question ownership carefully.
- A condition may reference another question (source variable) but apply to this target question.
- Do not create a rule for the source question unless local context explicitly says that source question is gated.

5) Rule type semantics.
- table-level: one yes/no gate for the whole question.
- row-level: per-row visibility gate.
- column-level: per-column visibility gate.
- multi-level: both table-level and row/column visibility apply to the same question.

6) "FOR ANY ROW" trap.
- "IF ... FOR ANY ROW ..." is an aggregate table-level gate.
- "ONLY SHOW ROWS ..." is row-level.
- If both are present for the same target question, use multi-level.

7) Be conservative.
- If clear visibility evidence is absent, reject.
</domain_rules>

<output_contract>
Always fill canonicalRule fields.
- canonicalRule.questionId must be the target candidate question.
- canonicalRule must describe one question only.
- If decision=reject, canonicalRule is placeholder content for the same question.
</output_contract>
`;

export const SKIP_LOGIC_CANDIDATE_VALIDATOR_ALTERNATIVE = SKIP_LOGIC_CANDIDATE_VALIDATOR_PRODUCTION;

export const SKIP_LOGIC_MISSING_SWEEP_PRODUCTION = `
<mission>
Find likely missing skip-logic candidates using:
1) survey outline
2) already-covered question IDs/rules

Only propose additional question IDs not already covered.
</mission>

<constraints>
1) Propose only when explicit visibility cues are present.
Allowed evidence patterns:
- ASK IF
- SHOW IF
- ONLY SHOW (rows/columns/items/therapy)
- SHOW ROWS FOR WHICH
- SKIP TO
- BASE:

2) Do not infer gates from semantic phrasing alone.
Reject inference-only cues like:
- "of those"
- references to prior values without explicit ASK/SHOW/ONLY SHOW
- numeric range/ALLOW/AUTOSUM instructions
- ASK ALL

3) Do not propose terminations/disqualifications.

4) Be conservative and concise.
Each proposal must include one short explicit evidence snippet.
</constraints>
`;

export const SKIP_LOGIC_MISSING_SWEEP_ALTERNATIVE = SKIP_LOGIC_MISSING_SWEEP_PRODUCTION;

export function getSkipLogicCandidateValidatorPrompt(version?: string): string {
  const v = version || process.env.SKIPLOGIC_PROMPT_VERSION || 'production';
  if (v === 'alternative') return SKIP_LOGIC_CANDIDATE_VALIDATOR_ALTERNATIVE;
  return SKIP_LOGIC_CANDIDATE_VALIDATOR_PRODUCTION;
}

export function getSkipLogicMissingSweepPrompt(version?: string): string {
  const v = version || process.env.SKIPLOGIC_PROMPT_VERSION || 'production';
  if (v === 'alternative') return SKIP_LOGIC_MISSING_SWEEP_ALTERNATIVE;
  return SKIP_LOGIC_MISSING_SWEEP_PRODUCTION;
}
