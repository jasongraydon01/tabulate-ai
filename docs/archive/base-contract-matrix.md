# TabulateAI Base Contract Matrix

## Purpose

This document defines the simplest deterministic base contract for TabulateAI.

The core rule is:

- the base shown in a table must be the base used for the displayed percentages

TabulateAI should prefer simple, auditable base behavior over more "helpful" inferred analysis behavior.

This contract should be resolved **before** `TableContextAgent`.

---

## Supported Base Modes

TabulateAI should support only these base modes for client-facing tables.

### 1. `total_base`

Use the total qualified respondent base for the study / run.

Example:

- `Base: Total respondents`

Use this when the table is not filtered and not routed to a narrower shared universe.

### 2. `table_universe_base`

Use the shared universe for the table.

This means:

- everyone who was eligible to see that question or table
- one shared base across the whole table

Examples:

- routed questions
- filtered questions
- item-detail tables after a genuine split
- cluster/detail tables where the final table still has one shared eligible universe

Example display text:

- `Base: Respondents shown this question`
- `Base: Respondents shown this table`

### 3. `model_base`

Use this only for model-derived families.

Examples:

- MaxDiff
- score-family modeled outputs

These tables must be disclosed as model-derived and should not look like ordinary sample-base frequency tables.

---

## Simplified Base Text Policy

Base text should be just as simple as the denominator contract.

TabulateAI should use only these default base-text patterns:

1. `Base: Total respondents`
2. `Base: Respondents shown this question`
3. `Base: Respondents shown this item`
4. `Base: Model-derived base`

That means TabulateAI should stop generating extra base-complexity language such as:

- `base varies`
- base ranges
- rebased-exclusion notes in normal base text
- hidden qualified/substantive wording

If a table genuinely has varying item bases:

- split it, or
- block it

Do not explain complexity in base text that should have been resolved structurally.

### What can still vary

`TableContextAgent` may still improve the human wording of **who** the base refers to.

Examples:

- `Respondents shown this question`
- `Pediatricians shown this question`
- `Respondents shown this item`

But the agent should still stay inside the resolved base contract:

- total respondents
- respondents shown this question/item
- model-derived base

It should not invent new denominator concepts in the wording.

---

## Unsupported Output Modes

These are out of scope for TabulateAI client-facing tables.

### Row-specific bases in one table

TabulateAI should **not** show one table where different rows use different denominators.

If bases genuinely vary by item:

- split the table, or
- do not render the combined table

### Hidden substantive rebasing

TabulateAI should **not** silently exclude non-substantive responses like `"Don't know"` from the denominator of a normal summary table.

If `"Don't know"` is present as an answer option, treat it as part of the ordinary table unless there is an explicitly requested analysis mode for qualified-only reporting.

For now:

- no implicit substantive-only base
- no hidden qualified-respondent denominator

This keeps the system simple and auditable.

---

## Pipeline Placement

This contract should be resolved after canonical assembly and before AI presentation refinement.

### Required placement

1. Stage `13d` canonical assembly builds:
   - `tableKind`
   - `basePolicy`
   - `baseContract`
   - `baseDisclosure`
   - WinCross denominator metadata
2. New deterministic step: **Base Contract Resolution**
3. Stage `13e` prefill uses the resolved base contract to produce default `baseText`
4. `TableContextAgent` may refine wording only

### AI is not allowed to decide

`TableContextAgent` may:

- improve phrasing
- improve subtitles
- improve notes

`TableContextAgent` may not:

- change denominator behavior
- decide whether a table is total vs table-universe
- preserve a combined table that should have been split
- introduce substantive rebasing

---

## Hard Rules

These should be treated as invariants.

1. If a table shows one base, all displayed percentages must use that same base.
2. If bases genuinely vary by item, the table must split or be blocked.
3. A normal summary table must not silently use a narrower denominator than the base it shows.
4. WinCross and Excel must use the same resolved base contract.
5. Export must fail validation if the contract cannot be enforced from available metadata.
6. Base text should not be used to explain denominator complexity that should have been resolved by splitting or blocking the table.

---

## Deterministic Inputs

The resolver should use only existing metadata:

- `tableKind`
- `basePolicy`
- `baseContract.classification.referenceUniverse`
- `baseContract.classification.comparabilityStatus`
- `baseContract.policy.effectiveBaseMode`
- `baseContract.policy.rebasePolicy`
- `baseViewRole`
- `wincrossDenominatorSemantic`
- `wincrossQualifiedCodes`
- `wincrossFilteredTotalExpr`

No AI is required.

---

## Resolved Outputs

Each canonical table should resolve these fields:

- `resolvedBaseMode`
- `resolvedSplitPolicy`
- `resolvedDisclosureTextPolicy`
- `resolvedBaseTextTemplate`

Recommended enums:

```ts
type ResolvedBaseMode =
  | 'total_base'
  | 'table_universe_base'
  | 'model_base';

type ResolvedSplitPolicy =
  | 'none'
  | 'required';

type ResolvedDisclosureTextPolicy =
  | 'show_total_base'
  | 'show_table_universe_base'
  | 'show_model_base';

type ResolvedBaseTextTemplate =
  | 'total_respondents'
  | 'shown_this_question'
  | 'shown_this_item'
  | 'model_derived';
```

Notes:

- there is no supported `row_specific_base`
- there is no supported implicit `substantive_base`

---

## Matrix

This matrix defines the default behavior by table family.

### 1. Overview families

Kinds:

- `standard_overview`
- `numeric_overview_mean`
- `scale_overview_full`
- `ranking_overview_rank`
- `ranking_overview_topk`
- `allocation_overview`

| Situation | Resolve to | Notes |
|---|---|---|
| Not filtered / not routed | `total_base` | Default overview behavior |
| Shared filtered or routed universe | `table_universe_base` | One shared eligible base across the table |
| Genuine varying item bases | `split required` | Do not keep combined table |
| Model-derived | `model_base` | Explicit model disclosure |

### 2. Detail / item families

Kinds:

- `standard_item_detail`
- `numeric_item_detail`
- `numeric_per_value_detail`
- `numeric_optimized_bin_detail`
- `scale_item_detail_full`
- `allocation_item_detail`
- `ranking_item_rank`

| Situation | Resolve to | Notes |
|---|---|---|
| Shared eligible universe for the table | `table_universe_base` | This is the normal item-detail behavior |
| Genuine varying item bases | already split | Detail tables are the split form |
| Split would be tautological / trivial | keep combined table | Revert to one meaningful shared-base table |
| Model-derived | `model_base` only when explicitly modeled | Otherwise not applicable |

### 3. Grid / cluster detail families

Kinds:

- `standard_cluster_detail`
- `grid_row_detail`
- `grid_col_detail`

| Situation | Resolve to | Notes |
|---|---|---|
| Shared eligible universe for final table | `table_universe_base` | Fine if truly shared |
| Genuine varying item bases | `split required` | Do not combine differing bases in one client-facing table |
| Split would be tautological / trivial | keep combined table | Use one meaningful shared base instead |

### 4. Scale summary rollup families

Kinds:

- `scale_overview_rollup_t2b`
- `scale_overview_rollup_middle`
- `scale_overview_rollup_b2b`
- `scale_overview_rollup_nps`
- `scale_overview_rollup_combined`
- `scale_overview_rollup_mean`
- `scale_dimension_compare`

| Situation | Resolve to | Notes |
|---|---|---|
| Parent question has one shared table universe | `table_universe_base` | Default summary-table behavior |
| Parent question is full-sample / unfiltered | `total_base` | Use shown full base |
| Non-substantive responses exist | same as above | Do not silently rebase denominator |
| Genuine varying item bases | `split required` | Do not show mixed-base summary tables |

Important rule:

- Top 2 Box / Middle / Bottom / Mean summary tables should use the same shown base logic as the rest of the question family.
- They should not silently switch to "substantive respondents only."

### 5. Model-derived families

Kinds:

- `maxdiff_api`
- `maxdiff_ap`
- `maxdiff_sharpref`
- any table with `basePolicy = score_family_model_base`

| Situation | Resolve to | Notes |
|---|---|---|
| Model-derived | `model_base` | Must be explicitly disclosed as model-derived |

---

## Default Deterministic Rules

These are the actual rules to implement.

### Rule A: If `referenceUniverse = model`

- resolve to `model_base`
- disclose as model-derived

### Rule B: If `comparabilityStatus = split_recommended`

- `resolvedSplitPolicy = required`
- do not render as one combined table
- unless the split would make the resulting table tautological or trivial

### Rule C: If table family is item/detail

- resolve to `table_universe_base`
- the shown base must match the actual denominator used
- use a simple base text like `Respondents shown this item` unless a clearer deterministic subject is available
- if the split would create trivial `100%` rows by construction, do not split; keep one meaningful shared-base table instead

### Rule D: If table family is overview

- use `total_base` when the table universe is the full qualified sample
- otherwise use `table_universe_base`
- base text should stay simple: either `Total respondents` or `Respondents shown this question`

### Rule E: If table family is scale summary rollup

- use the same shared base logic as the parent question family
- do not introduce substantive rebasing
- use the same simple base-text template as the parent question family

### Rule F: If a proposed split would be tautological

- do not split
- keep one combined table
- resolve that table to either `total_base` or `table_universe_base`
- choose the broader meaningful shared universe:
  - `total respondents`, or
  - `respondents shown this question`

### Rule G: If denominator metadata required to enforce the contract is missing

- fail validation
- do not fall back silently to default WinCross profile behavior

---

## What This Means For Non-Substantive Responses

Current implicit rebasing for non-substantive responses is too clever for the current product stage.

Updated rule:

- if `"Don't know"` or another non-substantive option exists, treat it like a normal answer option for denominator purposes
- do not silently remove it from the base
- if analysts want a qualified-only view later, that should be an explicit derived analysis mode, not a hidden denominator rule

This is the simplest and most auditable default.

---

## What This Means For Base Text Cleanup

Under this contract, old base-text patterns like:

- `base varies`
- `(n varies)`
- rebased-exclusion text in the default base line

should disappear from normal client-facing tables.

The system should prefer:

- splitting the table when bases genuinely vary
- or using one clean shared-base statement when they do not
- and avoiding splits that would create tautological `100%` tables

This keeps the base line readable and makes the actual denominator auditable.

---

## Validation Checks

Add a deterministic validation step before Excel and WinCross export.

Required checks:

1. If a table shows one base, every displayed row must use that same base.
2. If `resolvedSplitPolicy = required`, block single-table rendering.
3. If a scale summary rollup is using a narrower denominator than its shown base, fail validation.
4. If a proposed split would produce trivial `100%` rows by construction, reject the split and keep one combined shared-base table.
5. If export metadata needed to enforce the resolved base contract is missing, fail validation.
6. WinCross export must consume the resolved base contract directly rather than infer from partial fallback metadata.
7. Default base text must come from the resolved base-text template, not from legacy "base varies" or rebased wording.

---

## Immediate Implications For The Current Bug

For the `A100a` Top 2 Box issue:

- it is a normal scale summary rollup
- it should use the same shown shared base as the question family
- it should not silently switch to a substantive-only denominator

Under this simpler contract, the `42%` vs `48%` issue should not be possible.
