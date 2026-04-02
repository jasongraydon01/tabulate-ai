# WinCross Export — Feedback Triage

This note separates external tab-vendor feedback into implementation buckets rather than severity-only buckets:

1. Serializer correctness and denominator behavior.
2. Serializer durability and output hygiene.
3. Upstream labeling / content fidelity.
4. Explicitly deferred or vendor-clarification items.

The point is to avoid over-calling every delta a "WinCross bug" while also keeping work scoped to the layer that actually owns it.

---

## Bottom Line

### Current read
- Our `.job` is usable as a starting point, and the major serializer-owned durability / hygiene gaps from Buckets 1 and 2 are now addressed.
- Bucket 1 has now been addressed: summary-table denominator semantics are no longer emitted as a universal `TN^1`, and scale-label reconciliation now guards against code/anchor mismatches.
- Bucket 2 has now been addressed: eligible interim numeric tables use native `AF=` stat blocks, serializer-generated title pipes are gone, and escaped Unicode is normalized in final emitted display text.
- The next most actionable class of concern is fidelity: noisy stub labels, preferred rating-scale order, and the remaining Bucket 4 clarification items.
- OE theme duplication is real, but it is currently lower urgency than the items above because it is a low-risk extra row pattern and we do not yet have a clean dataset-general fix.

### Practical implication
- I would not frame the current output as blocked on every external comment.
- I would frame it as materially stronger on serializer correctness and durability, while still not claiming full authored parity with every tab-house convention.

---

## Decision Rule: Portable Defaults Vs Learned Preferences

Before implementing Bucket 2, we should separate three different classes of behavior:

### A. Portable cross-conventions we should apply by default
- These are serializer or content rules that improve correctness, durability, or baseline professionalism across jobs.
- They should not depend on one vendor's house style.
- They should usually be derivable from the current table semantics, not from a reference `.job`.

### B. Preferences that are valid only when the `.job` can teach them safely
- These are real style or authoring conventions, but we should only apply them when we can infer them from repeated, stable patterns in the uploaded `.job`.
- They belong in the parsed/org profile only if we can explain the signal clearly and fall back safely when the signal is mixed or absent.
- This is the right bucket for formatting or presentation choices that vary by tab house.

### C. Preferences that are not safely inferable from a `.job` alone
- These may be real client conventions, but they depend on analyst intent, email guidance, or local judgment that the file does not encode reliably.
- These should not be hard-coded as global defaults.
- These also should not be claimed as "learned from the reference job" unless we can point to a concrete, repeatable parse signal.

### Practical test
- If a rule changes whether the `.job` stays robust as new data arrives, it is usually Class A.
- If a rule changes how the same content is presented and the source `.job` shows a repeatable pattern, it is usually Class B.
- If we only know the rule because a human told us in email, or because one table happened to look that way once, it is Class C.

### Current implementation boundary
- The current parser already extracts some safe profile hints from uploaded `.job` files, such as value/reference alignment, stat-label caret alignment, header-row placement, and NET suffix style.
- It does not currently learn deeper semantic planning preferences from one uploaded `.job`.
- So Bucket 2 should default to Class A work first, then add Class B only where the parser can support it honestly.

---

## Bucket 1: Serializer Correctness

These are the items to treat as true export defects.

### Status
- **Addressed**
  - WinCross denominator behavior is now resolved per table rather than emitted from a single global default.
  - Stage-12 reconciliation now rejects survey-derived scale labels whose explicit numeric anchor conflicts with the coded value.
  - Regression coverage exists for serializer denominator behavior, canonical denominator metadata, and scale-label conflict handling.

### 1. Summary tables using `Total^TN^1` instead of `Total^TN^0`
- **Observed**:
  - Our export uses `Total^TN^1` everywhere.
  - The reference file uses `Total^TN^0` on summary tables such as Top 2 Box, Middle Box, Bottom Box, and Mean Summary outputs.
- **Why it matters**:
  - This changes the denominator. It is not a display preference.
  - Summary percentages can become self-referential if the base only includes respondents who selected the summarized codes.
- **Classification**: Export contract / correctness bug.
- **Likely fix owner**: WinCross serializer.
- **Implemented fix**:
  - Canonical tables now carry WinCross denominator metadata.
  - The serializer resolves `answering_base | sample_base | qualified_respondents | filtered_sample | response_level` per table.
  - Summary/derived table families now emit `TN^0`, `PO(...) + TN^1`, or `Total^<filter>^0` as appropriate instead of inheriting the profile default blindly.

### 2. Scale anchor / factor-code mismatch
- **Observed**:
  - In one of our anchored scale distributions, code `(7)` is labeled with a `1-...` prefix.
  - The reference correctly aligns the label prefix with the coded value.
- **Why it matters**:
  - This is a content bug, not a formatting preference.
  - A human can misread the table even if WinCross technically runs it.
- **Classification**: Data-labeling bug.
- **Likely fix owner**: Canonical row-label generation or scale-label mapping.
- **Implemented fix**:
  - Reconciliation now treats the coded value as authoritative for anchor consistency.
  - Survey-derived labels can still replace current labels when they are cleaner, but not when they explicitly claim the wrong numeric anchor.
  - On conflict, we keep the current non-conflicting label, or restore `savLabel` when the current label is already corrupted and `savLabel` is the best anchored match.

---

## Bucket 2: Serializer Durability And Output Hygiene

These are serializer-owned fixes that matter for practical vendor use, but are not the same class as denominator correctness.

### Status
- **Addressed**
  - Eligible single-variable interim numeric tables now collapse to native `AF=` stat blocks when the non-stat rows are simple observed values, while binned / filtered / indexed / multi-variable cases remain explicit.
  - Serializer-generated title wrapping pipes are no longer emitted; table titles now serialize as flat strings with the existing title-selection / truncation logic preserved.
  - Escaped Unicode such as `<U+2019>` now normalizes in final serializer-owned display text without rewriting WinCross syntax-bearing lines.
  - Regression coverage exists for the new mixed interim `AF=` path, the guard cases, flat-title behavior, and Unicode normalization boundaries.

### 3. Numeric interim tables should prefer native `AF=` stat blocks
- **Observed**:
  - Our export sometimes emits every observed numeric value as its own stub, then adds stats.
  - The reference uses `AF=S7^  ^OA` plus `^SM`, `^SD`, `^SV`, `^SR`.
- **Why it matters**:
  - For interim data, enumerating all current values is brittle. New values later will not automatically have stubs.
  - This is not just style. It affects durability of the `.job`.
  - This should be scoped to stat-style interim tables, not hard-coded as a rule for every numeric table.
- **Classification**: Portable serializer durability rule, not vendor-specific house style.
- **Decision rule**:
  - Treat this as a broad-based default whenever the table is truly a stat-only interim numeric table.
  - Do not treat this as a learned preference from one vendor profile.
  - Do not generalize it to analyst-authored binned numeric tables, where explicit ranges are part of the intended content.
- **Likely fix owner**: WinCross serializer, with planner input when analyst-defined ranges are intentional.
- **Implemented fix**:
  - The serializer still uses native `AF=` for pure stat-only single-variable tables.
  - It now also collapses conservative mixed interim numeric tables to native `AF=` when they are single-variable, include stat rows, and the non-stat rows are only simple value rows.
  - It explicitly does not collapse binned, filtered, indexed, NET-bearing, or multi-variable mixed tables.

### 4. Remove `|` from table titles
- **Observed**:
  - Our serializer intentionally inserts `|` line breaks in titles.
  - The reference style prefers a plain single-line title string with spaces only.
- **Why it matters**:
  - This is a style contract issue, not a calculation issue.
  - It likely does not prevent WinCross from loading the job, but it does break fidelity to their preferred authored style.
- **Classification**: Neutral serializer presentation default, with room for future profile override.
- **Decision rule**:
  - We should not hard-code a vendor-specific title style if different tab houses author titles differently.
  - But we also should not inject synthetic `|` wrapping unless we have a strong reason.
  - The safe default is plain-space titles; later we can allow a profile-driven override if we can truly infer authored title-wrap behavior from uploaded jobs.
- **Implemented fix**:
  - Serializer-generated title wrapping pipes have been removed.
  - Titles now serialize as flat strings, still using the existing candidate-priority logic and 1000-character truncation guard.
  - This pass did not add profile-level title-wrap settings or parser inference.

### 5. Unicode escape strings like `<U+2019>`
- **Observed**:
  - Example in our export: `I don<U+2019>t ...`
- **Why it matters**:
  - Ugly and unprofessional; may also signal incomplete text normalization.
  - Usually not a blocker to execution.
- **Classification**: Portable output-hygiene default.
- **Implemented fix**:
  - Serializer-owned display text now decodes escaped Unicode into real characters in final emitted output.
  - This normalization is limited to human-readable serializer output and does not rewrite WinCross syntax-bearing lines or raw passthrough logic sections.

---

## Bucket 3: Upstream Labeling And Content Fidelity

These are real fidelity gaps, but they are not all serializer problems.

### 6. Rating scales should show the top anchor first
- **Observed**:
  - Our Top 2 Box children can appear `6` then `7-Extremely Positive`.
  - The reference prefers `7` first, then `6`.
- **Why it matters**:
  - This is mainly readability and house style.
  - It does not change calculations if the codes are correct.
- **Classification**: Potentially profile-inferable ordinal display convention, not a universal serializer default.
- **Decision rule**:
  - Do not hard-code "highest anchor first" across all ordinal tables.
  - Only promote this into reusable behavior if we can detect a stable pattern across many anchored scale tables in uploaded `.job` files, or derive it from a clearer canonical display-order rule.
  - If the signal is mixed, keep the neutral canonical ordering.
- **Implemented fix**:
  - Canonical assembly now owns this behavior upstream rather than the WinCross serializer.
  - For clearly favorable-high anchored scales, Top 2 Box child rows are emitted top-anchor-first.
  - Bottom-box child rows keep bottom-anchor order, the overall row order stays `T2B -> Middle -> B2B`, and ambiguous scales keep the previous neutral ordering.

### 7. Stub rows should contain only the attribute text
- **Observed**:
  - Some summary-table stubs repeat the full question wording after each message fragment.
  - The reference keeps only the attribute text itself.
- **Why it matters**:
  - This is much noisier and makes OE summary tables hard to read.
  - It is more a row-labeling problem than a WinCross problem.
- **Classification**: Portable upstream content-fidelity rule, not a job-profile preference.
- **Decision rule**:
  - If we can deterministically separate question stem from attribute text, we should clean this up across the board.
  - This should live in survey cleanup / canonical labeling, not in a vendor-specific WinCross profile.
- **Implemented fix**:
  - Added one shared deterministic stem-stripping helper and applied it in question-context label extraction, canonical item-label fallback, and conservative post-processing cleanup.
  - The cleanup only fires when the question stem match is explicit after normalization and the remaining suffix is meaningful.
  - No fuzzy matching or WinCross profile inference was added.

---

## Bucket 4: Deferred Or Needs Clarification

These are worth documenting, but should not drive immediate implementation unless we can solve them cleanly.

### 8. OE theme duplication
- **Observed**:
  - Our coded OE tables include a NET row and then a child like `T1.<same concept>`, creating visible duplication.
  - Reference OE tables keep the NET row and then the more specific `T1.ST1`, `T1.ST2`, etc., without repeating the theme as another value row.
- **Current read**:
  - This is a real deliverable-quality issue, but it is not urgent enough to justify a fragile heuristic.
  - Today this duplication is effectively a low-risk extra row pattern the tab house can delete.
  - We should not implement a rule like "if you see `T1.` then suppress the NET" unless we can tie it to stable, dataset-general structure rather than pattern guessing.
- **Likely fix owner**: OE coding output design / NET enrichment behavior upstream of the serializer.

### 9. "OI2 already set at the job level; no need to specify at the stub level"
- **Why it needs clarification**:
  - The vendor is clearly asking for some redundant stub-level intent markup to be removed.
  - What is unclear is the exact emitter rule that corresponds to that request in our export logic.
- **Current read**:
  - Treat this as a real comment that needs an implementation mapping, not as a blocker we should guess at.
  - Until we can map the emitted pattern deterministically, this stays out of both the global default bucket and the learned-profile bucket.

### 10. Exact NET row suffix styling (`^SX` vs `^SX,GX`)
- **Why it needs clarification**:
  - The reference uses `^SX,GX` broadly.
  - Our export sometimes emits only `^SX`.
  - This is a comparison-derived hypothesis, not an explicit vendor comment.
- **Current read**:
  - Keep this documented as a follow-up question, but do not treat it as confirmed feedback until Antares says it matters.
  - If this becomes a real requirement, it belongs in the profile-inferable bucket because suffix style is the kind of repeated serializer signal a `.job` can plausibly teach.

---

## Ownership By Pipeline Layer

### WinCross serializer (`src/lib/exportData/wincross/serializer.ts`)
- Summary-table total line selection (`TN^0` vs `TN^1`)
- Title wrapping behavior (`|`)
- Unicode text normalization on final emitted strings
- Native `AF=` emission for stat-only interim numeric tables

### Canonical / table-planning / label-generation
- Wrong scale-anchor numbering like `1-Extremely Positive` on code `(7)`
- Preferred ordinal ordering within scale tables
- Deciding when a table is a summary versus full distribution if serializer cannot infer it cleanly

### Survey-cleanup / label-generation
- Removing question text from attribute stubs

### OE coding / NET enrichment output
- Potential future fix for duplicated OE umbrella rows where NET and `T1` say the same thing
- Do not implement this via dataset-specific heuristics

---

## Implementation Guardrail For Bucket 2

When we pick up Bucket 2, each item should be tagged one of these ways before we code it:

- `portable_default`
  - Safe to apply across exports without any uploaded reference job.
- `profile_inferable`
  - Only apply when the uploaded `.job` shows a stable pattern we can parse and store explicitly.
- `not_job_inferable`
  - Do not hard-code globally and do not pretend the `.job` taught it to us.

### Current tagging
- 3. Numeric interim `AF=` stat blocks: `portable_default`
- 4. Title `|` removal: `portable_default` now, with possible future `profile_inferable` override
- 5. Unicode cleanup: `portable_default`
- 6. Top-anchor-first scale order: `profile_inferable` or upstream canonical rule, not `portable_default`
- 7. Attribute-only stub labels: `portable_default` upstream cleanup
- 8. OE umbrella duplication suppression: `not_job_inferable` for now
- 9. Stub-level `OI2` redundancy: `not_job_inferable` until we map the emitted rule precisely
- 10. NET suffix styling: `profile_inferable` if validated

---

## What I Would Ask The Tab Vendor

If we want sharper feedback from them, the most useful question is not "are these all blockers?" It is:

- Which of these issues prevented direct use of the `.job`?
- Which were quick cleanup edits versus structural rebuilds?
- Did you have to recalculate tables, or mainly restyle titles/stubs/base lines?
- Which issue classes must be fixed before your team can use our export at all?

That will tell us whether we are dealing with:
- a true export-contract gap,
- a style-fidelity gap,
- or just the normal last-mile cleanup an external tab house expects.

---

## Concrete Roadmap

This roadmap assumes we invest in Buckets 1-3 now where the fixes are clean, and explicitly defer Bucket 4 unless we get a deterministic path.

### Phase 1: Correctness And Durability

Goal: make the exported `.job` reliable enough that we can defend "good starting point" without hand-waving around incorrect bases or obviously wrong labels.

#### 1. Summary-table base logic
- **Work**:
  - Detect summary/derived tables and emit the correct table-level denominator syntax instead of relying on a universal `TN^1`.
  - Preserve support for explicit filtered totals like `Total^VariableName (codes)^0` where needed.
- **Owner**: WinCross serializer.
- **Why first**: This is the most important correctness issue.
- **Acceptance**:
  - Top 2 Box, Bottom Box, Middle Box, and Mean Summary tables export with the intended total-line behavior.
  - Summary percentages align with corresponding detail tables.
- **Status**: Done.

#### 2. Numeric stat-table durability
- **Work**:
  - Expand native `AF=` handling for stat-only interim numeric tables.
  - Distinguish true analyst-defined bins from interim-value enumeration.
- **Owner**: WinCross serializer, with planner guardrails if needed.
- **Why first**: Avoid fragile jobs that break as interim values expand.
- **Acceptance**:
  - Interim numeric tables no longer require enumerating every currently observed value.
  - Uploaded reference styles that use native `AF=` continue to round-trip cleanly.

#### 3. Scale-label correctness
- **Work**:
  - Fix code-to-label alignment so the anchor prefix matches the actual code.
  - Add regression tests for 7-point scales and similar anchored ordinal questions.
- **Owner**: Canonical row-label generation / scale handling.
- **Why first**: Wrong anchor text is visibly incorrect even if the table technically runs.
- **Acceptance**:
  - `(7)` never receives a `1-...` label.
  - High and low anchors consistently match their coded values.
- **Status**: Done.

#### 4. Stub-label cleanup for OE/message summaries
- **Work**:
  - Strip repeated question wording from attribute stubs like D700.
  - Preserve only the attribute text needed to read the row cleanly.
- **Owner**: Survey-cleanup / canonical row generation.
- **Why first**: This is a tractable fidelity issue with clear evidence from the reference job.
- **Acceptance**:
  - Summary-table stubs no longer append the full source question text.
  - D700-style message rows read as clean attributes rather than question-plus-attribute mashups.

### Phase 2: Generalizable Fidelity Improvements

Goal: improve visible match to uploaded reference jobs in ways that are portable and worth productizing.

#### 5. Title-style normalization
- **Work**:
  - Stop emitting `|` line-wrap markers in serialized table titles.
  - Normalize title text to plain spaces.
- **Owner**: WinCross serializer.
- **Acceptance**:
  - Exported titles no longer contain synthetic `|` breaks.
  - Long titles remain readable without looking unlike authored reference jobs.

#### 6. Unicode cleanup
- **Work**:
  - Normalize escaped Unicode artifacts like `<U+2019>` into real characters or approved ASCII equivalents.
- **Owner**: WinCross serializer text-output path.
- **Acceptance**:
  - Escaped Unicode artifacts do not appear in exported job text.

#### 7. Ordinal display-order conventions
- **Work**:
  - Standardize scale presentation so fully anchored positive scales show highest anchor first where appropriate.
  - Preserve logical order for other scale types rather than hard-coding one rule everywhere.
- **Owner**: Canonical ordering rules, not the profile parser alone.
- **Acceptance**:
  - 7-point positive scales read `7, 6, ...` in the style expected by reference jobs when relevant.
  - Order changes do not break NET grouping or mean/stat rows.

#### 8. Expand what a reference upload can actually teach us
- **Work**:
  - Extend profile extraction beyond alignment hints to lightweight style preferences that are safely inferable.
  - Candidate learnable preferences:
    - preferred NET suffix token when clearly detectable
    - whether title line-break markers should be preserved or flattened, if source evidence is clear
    - stable row alignment conventions
    - maybe ordinal anchor order when strongly evidenced across many tables
- **Owner**: WinCross profile parser plus serializer application layer.
- **Important constraint**:
  - Do not pretend a single uploaded `.job` can teach semantic planning rules that it cannot reliably encode.
  - Only promote preferences that have a repeatable parse signal, an explicit profile field, and a safe fallback when absent.
- **Acceptance**:
  - Uploaded references produce measurable style adaptation beyond spacing/alignment only.
  - We can explain exactly which preferences are learnable from the profile and which are not.

### Deferred Phase 3: Last-Mile Cleanup

Goal: explicitly defer work that is useful but not necessary for the current "80% fidelity" claim.

#### Defer for now
- OE umbrella-row suppression where the only current approach would rely on fragile theme-pattern heuristics
- Local house-style wording and casing choices that do not affect meaning
- Exact stub-level intent / NET suffix conventions until Antares clarifies the intended rule
- Highly bespoke analyst preferences that are difficult to infer safely from a reference job

This is the work we can reasonably leave to the tab house or treat as later product polish.

---

## Product Positioning

### What we should claim now
- Uploading a WinCross reference helps us match many structural and formatting conventions.
- The output is intended to be a strong starting point for a tab team, not a claim of perfect authored parity.
- We are targeting reliable and portable WinCross exports first, then reference-informed fidelity improvements.

### What we should not claim yet
- That any uploaded `.job` teaches us all of a team's semantic table-planning preferences
- That we reproduce every local house style automatically
- That export parity is complete enough to remove all tab-house cleanup

### Simple positioning language
- "We aim to produce a usable WinCross-ready starting point that reflects your house conventions where they can be learned safely from your reference file."
- "We do not yet claim perfect one-to-one authored parity with every tab vendor's last-mile style choices."

---

## Vendor Conversation Plan

### What to ask about this version
- Was the export usable as a working starting point?
- Which fixes were mandatory before your team could use it?
- Which fixes were quick cleanup versus true rebuilds?
- Did any issue create incorrect percentages or materially wrong table interpretation?

### What to show after Phases 1 and 2
- Corrected summary-table denominator behavior
- Cleaner numeric stat handling
- Corrected scale anchors
- Cleaner title output and Unicode normalization
- Improved visible fidelity where the uploaded reference can teach stable conventions

### What to clarify in the pitch
- The reference upload is for style adaptation and serialization alignment, not for learning every analyst judgment implicitly.
- The product goal is "high-quality starting point with meaningful house-style adaptation", not "perfect recreation of every handcrafted `.job`".
